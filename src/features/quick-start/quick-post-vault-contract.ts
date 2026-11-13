import 'server-only'
import { createHash } from 'node:crypto'
import { evaluateApprovalActions, type ApprovalActionVerdicts } from '@/features/vault/approval-policy'
import { evaluateChannelSpec } from '@/features/vault/channel-spec'
import { SupabaseVaultSaveRepository } from '@/features/vault/model/supabase-save-repository'
import type { ReadinessView } from '@/features/readiness'
import {
  CONNECTION_IDENTITY_MISSING,
  CONNECTION_IDENTITY_MISSING_MESSAGE,
} from '@/features/channels/constants'
export class QuickPostVaultError extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number) { super(message) }
}

type Channel = 'instagram' | 'threads'
type Row = Record<string, any>
export type QuickPostApprovalTarget = {
  channel: Channel
  contentId: string
  versionId: string
  handle: string | null
  specLabel: string
  actions: ApprovalActionVerdicts
  reasonCode?: string | null
}
export type QuickPostApprovalOptions = { missionId: string; revision: number; targets: QuickPostApprovalTarget[] }
const channels: Channel[] = ['instagram', 'threads']

function stableId(parts: (string | number)[]): string {
  const hash = createHash('sha256').update(JSON.stringify(parts)).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}
function identity(workspaceId: string, missionId: string, revision: number, channel: Channel) {
  return { contentId: stableId([workspaceId, missionId, channel, 'content']), versionId: stableId([workspaceId, missionId, channel, revision, 'version']) }
}
async function missionFor(admin: any, workspaceId: string, missionId: string): Promise<Row> {
  const { data, error } = await admin.from('marketing_missions').select('id,workspace_id,status,content_id,content_version_id,metadata').eq('workspace_id', workspaceId).eq('id', missionId).maybeSingle()
  if (error) throw new QuickPostVaultError('초안을 확인하지 못했어요.', 'DB_READ_ERROR', 500)
  if (!data || data.metadata?.lane !== 'QUICK_POST' || !data.metadata?.payload?.copies) throw new QuickPostVaultError('초안을 찾을 수 없어요.', 'MISSION_NOT_FOUND', 404)
  return data
}
function assertResult(error: unknown): void {
  if (error) { console.error('[quick-post] canonical draft write failed', error); throw new QuickPostVaultError('보관할 원고를 준비하지 못했어요. 잠시 후 다시 시도해 주세요.', 'VAULT_DRAFT_ERROR', 500) }
}

/** Idempotently materializes channel-specific immutable versions; never changes the first-post approval payload. */
export async function ensureQuickPostVaultVersions(admin: any, workspaceId: string, actorId: string, missionId: string) {
  const mission = await missionFor(admin, workspaceId, missionId)
  if (mission.status !== 'AWAITING_APPROVAL') throw new QuickPostVaultError('승인 대기 중인 원고만 보관할 수 있어요.', 'INVALID_MISSION_STATE', 409)
  const md = mission.metadata
  const revision = md.quick?.revision ?? 1
  const imageIds: string[] = md.payload.imageIds ?? []
  for (const channel of channels) {
    const { contentId, versionId } = identity(workspaceId, missionId, revision, channel)
    const caption = channel === 'instagram' ? md.payload.copies.instagram?.caption : md.payload.copies.threads?.content
    if (!caption?.trim()) throw new QuickPostVaultError('원고 내용을 확인해 주세요.', 'VAULT_DRAFT_ERROR', 422)
    const title = (md.quick?.topic?.trim() || '우리 가게 소식').slice(0, 200)
    const content = await admin.from('content_items').upsert({ id: contentId, workspace_id: workspaceId, channel, title, created_by: actorId }, { onConflict: 'id', ignoreDuplicates: true })
    assertResult(content.error)
    const version = await admin.from('content_versions').upsert({ id: versionId, workspace_id: workspaceId, content_id: contentId, version_number: revision, caption, hashtags: channel === 'instagram' ? md.payload.copies.instagram?.hashtags ?? [] : [], fingerprint: createHash('sha256').update(JSON.stringify([workspaceId, missionId, channel, revision, caption, imageIds])).digest('hex'), created_by: actorId }, { onConflict: 'id', ignoreDuplicates: true })
    assertResult(version.error)
    for (const [position, assetId] of imageIds.entries()) {
      const link = await admin.from('content_version_media').upsert({ workspace_id: workspaceId, version_id: versionId, media_asset_id: assetId, position }, { onConflict: 'version_id,media_asset_id', ignoreDuplicates: true })
      assertResult(link.error)
    }
  }
  // A stale options read is rejected before advertising a different revision.
  const current = await missionFor(admin, workspaceId, missionId)
  if (current.status !== 'AWAITING_APPROVAL' || (current.metadata.quick?.revision ?? 1) !== revision) throw new QuickPostVaultError('초안이 변경됐어요. 다시 불러와 주세요.', 'STALE_DRAFT', 409)
  return { revision }
}

/** Read-only policy evaluation; the repository reads saved connection receipts and media, never probes a provider. */
export async function getQuickPostApprovalOptions(admin: any, workspaceId: string, missionId: string, readiness: Pick<ReadinessView, 'stage' | 'verifiedChannels'>): Promise<QuickPostApprovalOptions> {
  const mission = await missionFor(admin, workspaceId, missionId)
  if (mission.status !== 'AWAITING_APPROVAL') throw new QuickPostVaultError('승인 대기 중인 원고만 보관할 수 있어요.', 'INVALID_MISSION_STATE', 409)
  const revision = mission.metadata.quick?.revision ?? 1
  const repo = new SupabaseVaultSaveRepository(admin)
  const [truth, review, connections] = await Promise.all([
    repo.getChannelTruth(workspaceId), repo.getProviderReviewStatus(),
    admin.from('channel_connections').select('channel,account_label,status,external_account_id').eq('workspace_id', workspaceId),
  ])
  if (connections.error) throw new QuickPostVaultError('채널 연결 상태를 확인하지 못했어요.', 'CONNECTION_READ_ERROR', 503)
  const targets: QuickPostApprovalTarget[] = []
  for (const channel of channels) {
    const { contentId, versionId } = identity(workspaceId, missionId, revision, channel)
    const draft = await repo.getDraft(workspaceId, contentId, versionId)
    if (!draft) throw new QuickPostVaultError('보관할 원고가 아직 준비되지 않았어요. 다시 불러와 주세요.', 'VAULT_DRAFT_NOT_FOUND', 409)
    const spec = evaluateChannelSpec(channel, { text: draft.caption, hashtags: draft.hashtags, media: draft.media.map(m => ({ type: m.type, mimeType: m.mimeType ?? undefined, fileSizeBytes: m.sizeBytes ?? undefined })) })
    const issue = spec.checks.find(c => c.status === 'FAIL' || c.status === 'UNKNOWN' || c.status === 'WARN')
    if (connections.error || !Array.isArray(connections.data)) throw new QuickPostVaultError('채널 연결 상태를 확인하지 못했어요.', 'VAULT_CONNECTION_READ_FAILED', 503)
    const connRow = connections.data.find((c: Row) => c.channel === channel)
    const isIdentityMissing = Boolean(
      connRow &&
      ['connected', 'verified'].includes(connRow.status?.toLowerCase()) &&
      !connRow.external_account_id
    )
    const verdicts = evaluateApprovalActions({ channel, readiness: readiness.stage, connection: truth[channel]?.verified && readiness.verifiedChannels.includes(channel) ? 'VERIFIED' : 'UNKNOWN', providerReviewStatus: review, specResult: spec, targetTime: null })
    if (isIdentityMissing) {
      verdicts.PUBLISH = {
        allowed: false,
        message: CONNECTION_IDENTITY_MISSING_MESSAGE,
      }
    }
    // The vault repository also rejects missing title/text/digests: don't advertise an unusable button.
    if (!draft.title?.trim() || !draft.caption?.trim() || draft.media.some(m => m.type === 'image' && (!m.mimeType || !m.renditionContentDigest))) verdicts.VAULT = { allowed: false, message: '내용이나 이미지 확인 정보가 부족해요. 원고를 확인해 주세요.' }
    const handle = connRow?.account_label
    targets.push({
      channel,
      contentId,
      versionId,
      handle: typeof handle === 'string' ? handle : null,
      specLabel: issue ? `규격 확인 필요 · ${issue.userMessage}` : '규격 확인 완료',
      actions: verdicts,
      reasonCode: isIdentityMissing ? CONNECTION_IDENTITY_MISSING : null,
    })
  }
  return { missionId, revision, targets }
}
