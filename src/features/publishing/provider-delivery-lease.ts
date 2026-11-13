/**
 * ProviderDeliveryLease & PublishRendition Management (Wave 5: ANI-1095)
 * Handles ephemeral delivery leases for Meta ingestion from private Supabase Storage.
 */

import { createHash } from 'node:crypto'
import type { PublishRendition, ProviderDeliveryLease } from '../media/media-asset-types'

export interface IssueDeliveryLeaseInput {
  workspaceId: string
  renditionId: string
  provider: 'instagram' | 'threads'
  purpose?: string
  ttlSeconds?: number // default 900 (15 minutes)
}

export interface DeliveryLeaseGateway {
  createSignedUrl(
    bucket: string,
    objectPath: string,
    expiresInSeconds: number
  ): Promise<{ signedUrl: string | null; error: unknown }>
  probeUrl(url: string): Promise<{ ok: boolean; status: number; contentType: string | null }>
  insertLeaseRecord?(lease: ProviderDeliveryLease): Promise<{ error: unknown }>
}

export class DeliveryLeaseError extends Error {
  readonly code: string
  constructor(message: string, code = 'DELIVERY_LEASE_ERROR') {
    super(message)
    this.name = 'DeliveryLeaseError'
    this.code = code
  }
}

export function isLeaseTtlSufficient(
  lease: ProviderDeliveryLease,
  minRemainingSeconds = 60,
  currentTimeMs: number = Date.now()
): boolean {
  const expiresAtMs = new Date(lease.expires_at).getTime()
  if (isNaN(expiresAtMs)) return false
  const remainingSeconds = (expiresAtMs - currentTimeMs) / 1000
  return remainingSeconds >= minRemainingSeconds
}

export async function issueProviderDeliveryLease(
  rendition: PublishRendition,
  input: IssueDeliveryLeaseInput,
  gateway: DeliveryLeaseGateway
): Promise<ProviderDeliveryLease> {
  if (rendition.workspace_id !== input.workspaceId) {
    throw new DeliveryLeaseError(
      'Cross-workspace delivery lease issuance is strictly forbidden',
      'CROSS_WORKSPACE_LEASE_FORBIDDEN'
    )
  }

  const ttlSeconds = input.ttlSeconds ?? 900
  if (ttlSeconds < 60 || ttlSeconds > 86400) {
    throw new DeliveryLeaseError(
      `Invalid TTL seconds: ${ttlSeconds}. Must be between 60 and 86400.`,
      'INVALID_TTL'
    )
  }

  const { signedUrl, error } = await gateway.createSignedUrl(
    rendition.storage_bucket,
    rendition.object_path,
    ttlSeconds
  )

  if (error || !signedUrl || !signedUrl.startsWith('https://')) {
    throw new DeliveryLeaseError(
      'Failed to generate secure signed URL for delivery',
      'SIGNED_URL_GENERATION_FAILED'
    )
  }

  // Pre-flight probe to guarantee Meta will be able to fetch the image bytes
  const probe = await gateway.probeUrl(signedUrl)
  if (!probe.ok) {
    throw new DeliveryLeaseError(
      `Delivery URL probe failed with HTTP status ${probe.status}`,
      'DELIVERY_URL_PROBE_FAILED'
    )
  }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000)

  const lease: ProviderDeliveryLease = {
    id: crypto.randomUUID(),
    workspace_id: input.workspaceId,
    rendition_id: rendition.id,
    provider: input.provider,
    purpose: input.purpose ?? 'meta_publish',
    delivery_url: signedUrl,
    issued_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    status: 'ACTIVE',
  }

  if (gateway.insertLeaseRecord) {
    const insertResult = await gateway.insertLeaseRecord(lease)
    if (insertResult.error) {
      throw new DeliveryLeaseError(
        'Failed to persist provider delivery lease record',
        'LEASE_PERSISTENCE_FAILED'
      )
    }
  }

  return lease
}

export async function ensureActiveDeliveryLease(
  currentLease: ProviderDeliveryLease | null,
  rendition: PublishRendition,
  input: IssueDeliveryLeaseInput,
  gateway: DeliveryLeaseGateway,
  providerSideEffectOccurred = false
): Promise<ProviderDeliveryLease> {
  // If provider has already accepted/processed, we must NEVER blind re-issue to create a duplicate post
  if (providerSideEffectOccurred) {
    if (!currentLease) {
      throw new DeliveryLeaseError(
        'Provider side effect already occurred with no lease recorded',
        'POST_ACCEPTED_NO_LEASE'
      )
    }
    return currentLease
  }

  // If current lease is valid and has sufficient TTL, reuse it
  if (currentLease && currentLease.status === 'ACTIVE' && isLeaseTtlSufficient(currentLease, 60)) {
    return currentLease
  }

  // Otherwise issue a fresh delivery lease
  return issueProviderDeliveryLease(rendition, input, gateway)
}
