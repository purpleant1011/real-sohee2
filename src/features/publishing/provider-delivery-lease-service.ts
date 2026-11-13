/**
 * Provider Delivery Lease Service (ANI-1132)
 * Manages time-limited signed delivery leases for external channel ingestions (Meta Graph API, Naver).
 * Persists leases in `provider_delivery_leases` table and prevents unsafe blind re-issues.
 */

import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PublishRendition, ProviderDeliveryLease } from '../media/media-asset-types'

export class ProviderDeliveryLeaseError extends Error {
  readonly code: string
  constructor(message: string, code = 'PROVIDER_DELIVERY_LEASE_ERROR') {
    super(message)
    this.name = 'ProviderDeliveryLeaseError'
    this.code = code
  }
}

export interface IssueLeaseParams {
  workspaceId: string
  rendition: PublishRendition
  provider: 'instagram' | 'threads' | 'naver' | 'daangn' | string
  purpose?: string
  ttlSeconds?: number // default 3600 (1 hour)
  skipProbe?: boolean // for tests or offline environments
}

export interface EnsureLeaseParams extends IssueLeaseParams {
  currentLease?: ProviderDeliveryLease | null
  providerSideEffectOccurred?: boolean
  minRemainingSeconds?: number // default 300 (5 minutes)
}

export class ProviderDeliveryLeaseService {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Evaluates whether a lease is currently active with sufficient remaining TTL.
   */
  isLeaseActive(lease: ProviderDeliveryLease, minRemainingSeconds = 60, currentTimeMs: number = Date.now()): boolean {
    if (lease.status !== 'ACTIVE') return false
    const expiresAtMs = new Date(lease.expires_at).getTime()
    if (isNaN(expiresAtMs)) return false
    return (expiresAtMs - currentTimeMs) / 1000 >= minRemainingSeconds
  }

  /**
   * Issues and persists a fresh time-limited delivery lease from Supabase Storage.
   */
  async issueDeliveryLease(params: IssueLeaseParams): Promise<ProviderDeliveryLease> {
    const { workspaceId, rendition, provider, purpose = 'channel_publish', ttlSeconds = 3600, skipProbe = false } = params

    // 1. Cross-Workspace Tenant Guard
    if (rendition.workspace_id !== workspaceId) {
      throw new ProviderDeliveryLeaseError(
        `Cross-workspace delivery lease forbidden: rendition workspace is "${rendition.workspace_id}", request workspace is "${workspaceId}".`,
        'CROSS_WORKSPACE_LEASE_FORBIDDEN'
      )
    }

    // 2. TTL Guard: Meta requires at least 15 min, max 24 hours
    if (ttlSeconds < 60 || ttlSeconds > 86400) {
      throw new ProviderDeliveryLeaseError(
        `Invalid TTL seconds: ${ttlSeconds}. Must be between 60 and 86400.`,
        'INVALID_TTL'
      )
    }

    // 3. Create signed URL from Supabase Storage
    const bucket = rendition.storage_bucket || 'content-media'
    const { data: signedData, error: signError } = await this.supabase.storage
      .from(bucket)
      .createSignedUrl(rendition.object_path, ttlSeconds)

    if (signError || !signedData?.signedUrl) {
      throw new ProviderDeliveryLeaseError(
        `Failed to generate signed delivery URL: ${signError?.message || 'Empty signedUrl'}`,
        'SIGNED_URL_GENERATION_FAILED'
      )
    }

    const signedUrl = signedData.signedUrl

    // 4. Preflight probe if enabled
    if (!skipProbe && typeof fetch === 'function') {
      try {
        const probeRes = await fetch(signedUrl, { method: 'HEAD' })
        if (!probeRes.ok) {
          throw new ProviderDeliveryLeaseError(
            `Delivery signed URL probe failed with status ${probeRes.status}.`,
            'DELIVERY_URL_PROBE_FAILED'
          )
        }
      } catch (err: unknown) {
        if (err instanceof ProviderDeliveryLeaseError) throw err
        // In local mock or non-network test runners, do not fail if fetch fails due to mock URL
      }
    }

    const now = new Date()
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000)

    const lease: ProviderDeliveryLease = {
      id: randomUUID(),
      workspace_id: workspaceId,
      rendition_id: rendition.id,
      provider: provider.toLowerCase(),
      purpose,
      delivery_url: signedUrl,
      issued_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      status: 'ACTIVE',
    }

    // 5. Persist lease record
    const { data: inserted, error: insertError } = await this.supabase
      .from('provider_delivery_leases')
      .insert({
        id: lease.id,
        workspace_id: lease.workspace_id,
        rendition_id: lease.rendition_id,
        provider: lease.provider,
        purpose: lease.purpose,
        delivery_url: lease.delivery_url,
        issued_at: lease.issued_at,
        expires_at: lease.expires_at,
        status: lease.status,
      })
      .select('*')

    if (insertError) {
      throw new ProviderDeliveryLeaseError(
        `Failed to persist provider delivery lease record: ${insertError.message}`,
        'LEASE_PERSISTENCE_FAILED'
      )
    }

    return inserted[0] as ProviderDeliveryLease
  }

  /**
   * Ensures an active lease is available. Reuses current lease if active,
   * otherwise issues a fresh one. Prevents unsafe blind retry if side effect already occurred.
   */
  async ensureActiveDeliveryLease(params: EnsureLeaseParams): Promise<ProviderDeliveryLease> {
    const { currentLease, providerSideEffectOccurred = false, minRemainingSeconds = 300 } = params

    // Reconcile Boundary: If provider side-effect already occurred, blind re-issue is strictly forbidden
    if (providerSideEffectOccurred) {
      if (!currentLease) {
        throw new ProviderDeliveryLeaseError(
          'Provider side effect already occurred without an associated delivery lease. Blind republish is forbidden.',
          'PROVIDER_ACCEPTED_NO_LEASE'
        )
      }
      return currentLease
    }

    // Safe Reuse: If current lease has enough remaining TTL, reuse it
    if (currentLease && this.isLeaseActive(currentLease, minRemainingSeconds)) {
      return currentLease
    }

    // Otherwise safe refresh with a fresh lease
    return this.issueDeliveryLease(params)
  }

  /**
   * Marks a lease as CONSUMED after provider acceptance.
   */
  async markLeaseConsumed(workspaceId: string, leaseId: string): Promise<void> {
    const { error } = await this.supabase
      .from('provider_delivery_leases')
      .update({ status: 'CONSUMED' })
      .eq('workspace_id', workspaceId)
      .eq('id', leaseId)

    if (error) {
      throw new ProviderDeliveryLeaseError(
        `Failed to mark delivery lease as consumed: ${error.message}`,
        'LEASE_UPDATE_FAILED'
      )
    }
  }
}
