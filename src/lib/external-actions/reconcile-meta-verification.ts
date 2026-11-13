import 'server-only'

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { assertSupabaseSuccess } from '@/lib/supabase/require-success'
import { getPublishedMetaPostPermalink } from '@/lib/providers/meta-api'
import { loadChannelCredentialByChannel } from '@/features/channels/credential-repository'
import type { MetaOAuthChannel } from '@/features/channels/oauth/meta-oauth'

export interface OrphanVerificationRow {
  id: string
  workspace_id: string
  channel: string
  verification_code: string
  status: string
  action_request_id: string | null
  external_post_id: string | null
  external_permalink: string | null
  created_at: string
}

export interface ReconcileResultItem {
  verificationRunId: string
  workspaceId: string
  channel: string
  actionRequestId: string | null
  disposition: 'RECONCILED' | 'DATA_INTEGRITY_ERROR'
  reason: string
}

export interface ReconcileMetaVerificationSummary {
  totalOrphansFound: number
  reconciledCount: number
  integrityIncidentCount: number
  items: ReconcileResultItem[]
}

/**
 * Reconciles historical orphan channel_verification_runs.
 *
 * INVARIANT: NEVER calls provider POST. GET-only verification against
 * official Meta Graph API permalink/status.
 */
export async function reconcileMetaVerifications(
  targetWorkspaceId?: string,
  readbackFn: typeof getPublishedMetaPostPermalink = getPublishedMetaPostPermalink,
): Promise<ReconcileMetaVerificationSummary> {
  const adminClient = createAdminSupabaseClient() as any

  // 1. Fetch all channel_verification_runs
  let query = adminClient
    .from('channel_verification_runs')
    .select('*')
    .eq('status', 'VERIFIED')

  if (targetWorkspaceId) {
    query = query.eq('workspace_id', targetWorkspaceId)
  }

  const { data: runs, error: runsErr } = await query
  if (runsErr) {
    throw new Error(`Failed to query channel_verification_runs: ${runsErr.message}`)
  }

  const verificationRuns: OrphanVerificationRow[] = runs || []

  // 2. Filter for orphans: action_request_id is null OR does not exist in external_action_requests
  const orphanRuns: OrphanVerificationRow[] = []

  for (const run of verificationRuns) {
    if (!run.action_request_id) {
      orphanRuns.push(run)
      continue
    }

    const { data: existingReq } = await adminClient
      .from('external_action_requests')
      .select('id')
      .eq('id', run.action_request_id)
      .maybeSingle()

    if (!existingReq) {
      orphanRuns.push(run)
    }
  }

  const results: ReconcileResultItem[] = []

  // 3. Reconcile each orphan without making any provider POST calls
  for (const orphan of orphanRuns) {
    const channelKey = orphan.channel.toLowerCase()
    if (channelKey !== 'instagram' && channelKey !== 'threads') {
      results.push({
        verificationRunId: orphan.id,
        workspaceId: orphan.workspace_id,
        channel: orphan.channel,
        actionRequestId: orphan.action_request_id,
        disposition: 'DATA_INTEGRITY_ERROR',
        reason: `Unsupported channel '${orphan.channel}' for Meta reconciliation`,
      })
      continue
    }

    const metaChannel = channelKey as MetaOAuthChannel

    // Try loading channel credential for provider GET
    let accessToken: string | null = null
    try {
      const cred = await loadChannelCredentialByChannel(orphan.workspace_id, metaChannel)
      accessToken = cred.accessToken
    } catch {
      accessToken = null
    }

    let verified = false
    let confirmedPermalink: string | null = orphan.external_permalink

    if (accessToken && orphan.external_post_id) {
      try {
        const livePermalink = await readbackFn({
          channel: metaChannel,
          providerPostId: orphan.external_post_id,
          accessToken,
        })
        if (livePermalink) {
          verified = true
          confirmedPermalink = livePermalink
        }
      } catch (err) {
        console.warn(`[reconcileMetaVerifications] Readback failed for ${orphan.id}:`, err)
      }
    }

    // If verified via provider GET, construct canonical lineage
    if (verified && orphan.external_post_id) {
      const canonicalRequestId = orphan.action_request_id || crypto.randomUUID()
      const canonicalAttemptId = crypto.randomUUID()
      const now = new Date().toISOString()

      // Backfill external_action_requests
      const reqRes = await adminClient
        .from('external_action_requests')
        .insert({
          id: canonicalRequestId,
          workspace_id: orphan.workspace_id,
          channel: channelKey,
          action_kind: channelKey === 'instagram' ? 'feed_publish' : 'thread_publish',
          target_external_id: orphan.external_post_id,
          target_label: `Reconciled ${orphan.channel}`,
          exact_payload: {
            verification_code: orphan.verification_code,
            external_post_id: orphan.external_post_id,
            permalink: confirmedPermalink,
            reconciled: true,
            provenance: 'RECONCILED_HISTORICAL_VERIFICATION',
          },
          idempotency_key: `reconcile-${orphan.id}`,
          status: 'succeeded',
          created_by: (orphan as any).verified_by || '00000000-0000-0000-0000-000000000000',
          created_at: orphan.created_at || now,
          updated_at: now,
        })
        .select('id')
        .single()

      assertSupabaseSuccess(reqRes, 'reconcile backfill request')

      // Backfill external_action_attempts
      const attRes = await adminClient
        .from('external_action_attempts')
        .insert({
          id: canonicalAttemptId,
          workspace_id: orphan.workspace_id,
          action_request_id: canonicalRequestId,
          attempt_number: 1,
          status: 'succeeded',
          provider_request_id: orphan.external_post_id,
          provider_reference: orphan.external_post_id,
          started_at: orphan.created_at || now,
          finished_at: now,
          created_by: (orphan as any).verified_by || '00000000-0000-0000-0000-000000000000',
        })
        .select('id')
        .single()

      assertSupabaseSuccess(attRes, 'reconcile backfill attempt')

      // Backfill external_action_receipts
      const rcptRes = await adminClient
        .from('external_action_receipts')
        .insert({
          id: crypto.randomUUID(),
          workspace_id: orphan.workspace_id,
          action_request_id: canonicalRequestId,
          attempt_id: canonicalAttemptId,
          receipt_kind: 'observed_result',
          provider_reference: orphan.external_post_id,
          result_url: confirmedPermalink,
          observed_payload: {
            reconciled: true,
            verified: true,
            read_after_write: true,
            external_post_id: orphan.external_post_id,
            permalink: confirmedPermalink,
            verification_code: orphan.verification_code,
            verification_method: 'META_GRAPH_API_RECONCILE_GET',
          },
          recorded_by: (orphan as any).verified_by || '00000000-0000-0000-0000-000000000000',
          recorded_at: now,
        })
        .select('id')
        .single()

      assertSupabaseSuccess(rcptRes, 'reconcile backfill receipt')

      // Link canonicalRequestId to channel_verification_runs if it was missing
      if (!orphan.action_request_id) {
        await adminClient
          .from('channel_verification_runs')
          .update({ action_request_id: canonicalRequestId })
          .eq('id', orphan.id)
      }

      results.push({
        verificationRunId: orphan.id,
        workspaceId: orphan.workspace_id,
        channel: orphan.channel,
        actionRequestId: canonicalRequestId,
        disposition: 'RECONCILED',
        reason: 'Successfully reconciled canonical request/attempt/receipt via independent provider GET readback',
      })
    } else {
      // Insufficient proof: mark as DATA_INTEGRITY_ERROR incident, NEVER auto-republish
      await adminClient
        .from('channel_verification_runs')
        .update({
          status: 'FAILED',
          error_message: 'DATA_INTEGRITY_ERROR: Historical orphan verification could not be proven via provider GET',
        })
        .eq('id', orphan.id)

      results.push({
        verificationRunId: orphan.id,
        workspaceId: orphan.workspace_id,
        channel: orphan.channel,
        actionRequestId: orphan.action_request_id,
        disposition: 'DATA_INTEGRITY_ERROR',
        reason: 'Provider GET readback returned 404 or credentials unavailable; preserved as integrity incident',
      })
    }
  }

  const reconciledCount = results.filter((r) => r.disposition === 'RECONCILED').length
  const integrityIncidentCount = results.filter((r) => r.disposition === 'DATA_INTEGRITY_ERROR').length

  return {
    totalOrphansFound: orphanRuns.length,
    reconciledCount,
    integrityIncidentCount,
    items: results,
  }
}
