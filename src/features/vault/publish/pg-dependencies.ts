import 'server-only'
import { PgVaultPreflightPorts } from '../preflight/pg-ports'
import { runPreflight } from '../preflight'
import { reevaluateReleaseGates } from '../service/save'
import { SupabaseVaultSaveRepository } from '../model/supabase-save-repository'
import { releaseRef } from '../ui/release-panel/release-service'
import { PublishingExecutor } from '@/lib/agent-os/executors/publishing-executor'
import { isMetaLiveAllowed } from '@/lib/safety/meta-live-allowlist'
import { recordVaultFunnelEvent } from '../funnel'
import type { VaultItem } from '../types'
import type { BatchPublishDeps } from './batch-publish'

export function createBatchPublishDependencies(admin: any): BatchPublishDeps {
  const ports = new PgVaultPreflightPorts(admin)
  const repository = new SupabaseVaultSaveRepository(admin)
  const fail = (error: { message?: string } | null, message: string) => { if (error) throw new Error(message) }
  const rowToItem = (row: any): VaultItem => ({ id: row.id, workspaceId: row.workspace_id, contentId: row.content_id, versionId: row.version_id, channel: row.channel, releaseGate: row.release_gate, holdReason: row.hold_reason, heldAt: row.held_at, heldBy: row.held_by, targetDate: row.target_date, approvedFingerprint: row.approved_fingerprint, fingerprintSchemaVersion: row.fingerprint_schema_version, policyVersion: row.policy_version, specVersion: row.spec_version, approvalState: row.approval_state, approvedBy: row.approved_by, bundleId: row.bundle_id, idempotencyKey: row.idempotency_key, deletedAt: row.deleted_at, createdAt: row.created_at, updatedAt: row.updated_at })
  return {
    enabled: (workspaceId?: string) => process.env.VAULT_PUBLISH_ENABLED === '1' && isMetaLiveAllowed(workspaceId),
    ref: releaseRef,
    now: () => new Date(),
    reevaluate: workspaceId => reevaluateReleaseGates(workspaceId, { repository }),
    async listItems(workspaceId, ids) {
      if (ids?.length === 0) return []
      let query = admin.from('vault_items').select('*').eq('workspace_id', workspaceId).is('deleted_at', null)
      query = ids ? query.in('id', [...ids]) : query.eq('release_gate', 'RELEASE_REQUESTED').limit(10)
      const { data, error } = await query
      fail(error, '보관 항목을 확인하지 못했어요')
      if (!Array.isArray(data)) throw new Error('보관 항목을 확인하지 못했어요')
      return data.map(rowToItem)
    },
    async claim(workspaceId, id) {
      const { data, error } = await admin.from('vault_items').update({ release_gate: 'HELD_USER', hold_reason: 'USER_HELD' })
        .eq('workspace_id', workspaceId).eq('id', id).eq('release_gate', 'RELEASE_REQUESTED')
        .eq('approval_state', 'APPROVED').is('deleted_at', null).select('id').maybeSingle()
      fail(error, '보관 상태를 저장하지 못했어요')
      return Boolean(data)
    },
    async hold(workspaceId, id, reason, gate) {
      const { data, error } = await admin.from('vault_items').update({ release_gate: gate, hold_reason: reason })
        .eq('workspace_id', workspaceId).eq('id', id).eq('release_gate', 'HELD_USER')
        .is('deleted_at', null).select('id').maybeSingle()
      if (error || !data) throw new Error('보관 상태를 저장하지 못했어요')
    },
    async complete(workspaceId, id) {
      const { data, error } = await admin.from('vault_items').update({ release_gate: null, hold_reason: null, held_at: null, held_by: null })
        .eq('workspace_id', workspaceId).eq('id', id).eq('release_gate', 'HELD_USER').is('deleted_at', null).select('id').maybeSingle()
      if (error || !data) throw new Error('게시 결과를 저장하지 못했어요')
    },
    async preflight(workspaceId, id, actorId, now) {
      return runPreflight(ports, { workspaceId, itemId: id, triggeredBy: actorId, now })
    },
    async publish(item, actorId) {
      const { data: variant, error: variantError } = await admin.from('vault_variant_payloads').select('payload')
        .eq('workspace_id', item.workspaceId).eq('vault_item_id', item.id).maybeSingle()
      if (variantError || !variant?.payload || typeof variant.payload.text !== 'string') throw new Error('보관 내용을 확인할 수 없어요')
      const { data: renditions, error: renditionError } = await admin.from('vault_image_renditions')
        .select('storage_bucket,object_path').eq('workspace_id', item.workspaceId).eq('vault_item_id', item.id)
      let imageUrl: string | undefined
      if (item.channel === 'instagram') {
        if (renditionError || !renditions?.length || !renditions[0]?.storage_bucket || !renditions[0]?.object_path) {
          throw new Error('게시 이미지를 확인할 수 없어요')
        }
        const { data: signed, error: signError } = await admin.storage.from(renditions[0].storage_bucket).createSignedUrl(renditions[0].object_path, 600)
        if (signError || !signed?.signedUrl) throw new Error('게시 이미지를 확인할 수 없어요')
        imageUrl = signed.signedUrl
      } else {
        if (renditionError) throw new Error('보관 내용을 확인할 수 없어요')
        if (renditions?.length && renditions[0]?.storage_bucket && renditions[0]?.object_path) {
          const { data: signed, error: signError } = await admin.storage.from(renditions[0].storage_bucket).createSignedUrl(renditions[0].object_path, 600)
          if (signError || !signed?.signedUrl) throw new Error('게시 이미지를 확인할 수 없어요')
          imageUrl = signed.signedUrl
        }
      }
      return PublishingExecutor.executePublish({
        workspaceId: item.workspaceId,
        channel: item.channel === 'instagram' ? 'INSTAGRAM' : 'THREADS',
        caption: variant.payload.text,
        imageUrl,
        actorUserId: actorId,
        contentVersionId: item.versionId,
        expectedFingerprint: item.approvedFingerprint ?? undefined,
      })
    },
    async recordPublished(item, actorId, url) {
      const { error } = await admin.from('vault_published_urls').upsert({
        workspace_id: item.workspaceId, vault_item_id: item.id, channel: item.channel,
        published_url: url, verification_status: 'UNVERIFIED', registered_by: actorId,
      }, { onConflict: 'workspace_id,vault_item_id', ignoreDuplicates: true })
      fail(error, '게시 주소를 저장하지 못했어요')
      const { error: eventError } = await admin.from('vault_events').insert({
        workspace_id: item.workspaceId, vault_item_id: item.id, actor_id: actorId,
        event_type: 'vault.published', payload: { message: '게시 완료' },
      })
      fail(eventError, '게시 기록을 저장하지 못했어요')
      const funnel = await recordVaultFunnelEvent({ workspaceId: item.workspaceId, userId: actorId,
        event: 'publish_verified', channel: item.channel, properties: { vaultItemId: item.id },
        dedupeKey: `publish_verified:${item.id}` }, { admin })
      if (!funnel.success) throw new Error('게시 기록을 저장하지 못했어요')
    },
    async recordEvent(item, actorId, event, message) {
      const { error } = await admin.from('vault_events').insert({ workspace_id: item.workspaceId,
        vault_item_id: item.id, actor_id: actorId, event_type: event, payload: { message } })
      fail(error, '게시 기록을 저장하지 못했어요')
    },
  }
}
