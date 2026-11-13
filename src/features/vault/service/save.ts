import { createHash } from 'node:crypto'
import { evaluateApprovalActions, VAULT_APPROVAL_LABEL } from '../approval-policy'
import { evaluateChannelSpec } from '../channel-spec'
import { calculateVaultFingerprintV3, FINGERPRINT_SCHEMA_VERSION } from '../fingerprint/fingerprint'
import type { VaultChannel, VaultHoldReason, VaultReleaseGate, VaultItem, VaultJson } from '../types'
import type { VaultSaveRepository, ChannelTruth, VaultDraft } from '../model/save-repository'
import type { OnChannelVerified } from '@/features/readiness'
import { canWriteVault, VAULT_WRITE_FORBIDDEN_MESSAGE } from '../permissions'

const POLICY_VERSION = 'vault-save-v1'
const CHANNELS: readonly VaultChannel[] = ['instagram', 'threads', 'naver_blog', 'daangn_business']
const META_CHANNELS: readonly VaultChannel[] = ['instagram', 'threads']

export class VaultSaveError extends Error {
  constructor(public readonly status: number, public readonly reason: string, message: string) {
    super(message)
    this.name = 'VaultSaveError'
  }
}
export interface VaultSaveRequest {
  workspaceId: string
  actorId: string
  /** 서비스 계층 이중 검사용. 사용자 요청 경로(라우트)는 반드시 전달하며, 값이 있으면 대표/관리자만 허용한다. 생략은 서버 내부 호출 전용. */
  actorRole?: string
  contentId: string
  versionId: string
  channels: readonly string[]
  targetDate: string | null
  idempotencyKey: string
}
export interface VaultSaveResult {
  saved: { channel: VaultChannel; release_gate_label: string; status_label: string }[]
  rejected: { channel: VaultChannel; reason_label: string }[]
  external_posts: 0
}
export interface VaultSaveDependencies {
  repository: VaultSaveRepository
  /** Best-effort analytics, never a condition of saving. No secrets or internal codes in user responses. */
  recordEvent?: (event: { event: 'vault.saved' | 'vault.save_failed'; workspaceId: string; userId: string; properties: { reason?: string; channel?: VaultChannel }; dedupeKey: string }) => Promise<void>
}

function sha(input: string): string { return createHash('sha256').update(input).digest('hex') }
function channelKey(key: string, channel: VaultChannel): string { return sha(JSON.stringify([key, channel])) }
function requestSignature(input: VaultSaveRequest): string {
  return sha(JSON.stringify([input.contentId, input.versionId, [...input.channels].sort(), input.targetDate]))
}
function label(gate: VaultReleaseGate): string {
  if (gate === 'HELD_PROVIDER_PENDING') return '앱 심사를 기다리는 중 · 외부 게시 전'
  if (gate === 'HELD_CONNECTION_PENDING') return '채널 연결을 기다리는 중 · 외부 게시 전'
  return '발행 준비 완료 · 외부 게시 전'
}
function gateFor(channel: VaultChannel, truth: ChannelTruth, review: string): { gate: VaultReleaseGate; reason: VaultHoldReason } {
  if (META_CHANNELS.includes(channel) && review !== 'APPROVED') return { gate: 'HELD_PROVIDER_PENDING', reason: 'META_REVIEW_PENDING' }
  if (!truth[channel]?.verified) return { gate: 'HELD_CONNECTION_PENDING', reason: 'CHANNEL_NOT_CONNECTED' }
  return { gate: 'HELD_USER', reason: 'USER_HELD' }
}
async function telemetry(deps: VaultSaveDependencies, input: VaultSaveRequest, event: 'vault.saved' | 'vault.save_failed', channel: VaultChannel, reason?: string) {
  try { await deps.recordEvent?.({ event, workspaceId: input.workspaceId, userId: input.actorId, properties: { channel, ...(reason ? { reason } : {}) }, dedupeKey: `${event}:${channelKey(input.idempotencyKey, channel)}:${reason ?? 'saved'}` }) }
  catch { /* analytics must never undo a successful save */ }
}
function validate(input: VaultSaveRequest) {
  if (input.actorRole !== undefined && !canWriteVault(input.actorRole)) throw new VaultSaveError(403, 'FORBIDDEN', VAULT_WRITE_FORBIDDEN_MESSAGE)
  if (!input.channels.length || new Set(input.channels).size !== input.channels.length || input.channels.some(c => !CHANNELS.includes(c as VaultChannel))) throw new VaultSaveError(422, 'INVALID_INPUT', '보관할 채널을 확인해 주세요.')
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 200) throw new VaultSaveError(422, 'INVALID_INPUT', '요청 식별자를 확인해 주세요.')
  if (input.targetDate !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(input.targetDate) || Number.isNaN(Date.parse(`${input.targetDate}T00:00:00Z`)) || new Date(`${input.targetDate}T00:00:00Z`).toISOString().slice(0, 10) !== input.targetDate)) throw new VaultSaveError(422, 'INVALID_INPUT', '예정일을 확인해 주세요.')
}
function variantOf(draft: VaultDraft) {
  return { title: draft.title, text: draft.caption, caption: draft.caption, hashtags: draft.hashtags, media: draft.media.map(m => ({ type: m.type, mimeType: m.mimeType ?? undefined, fileSizeBytes: m.sizeBytes ?? undefined })) }
}
async function assureSavedSidecars(repo: VaultSaveRepository, item: VaultItem, payload: Record<string, VaultJson>, actorId: string, signature: string): Promise<void> {
  await repo.putVariantPayload({ workspaceId: item.workspaceId, vaultItemId: item.id, payload, previewArtifacts: {} })
  const events = await repo.listEvents(item.workspaceId, item.id)
  if (!events.some(event => event.eventType === 'vault.saved')) {
    await repo.appendEvent({ workspaceId: item.workspaceId, vaultItemId: item.id, actorId, eventType: 'vault.saved', payload: { requestSignature: signature, fingerprintSchemaVersion: FINGERPRINT_SCHEMA_VERSION, policyVersion: item.policyVersion, specVersion: item.specVersion } })
  }
}

/** Explicit save action only: no schedules, publish requests, OAuth clients or provider invocations. */
export async function saveToVault(input: VaultSaveRequest, deps: VaultSaveDependencies): Promise<VaultSaveResult> {
  validate(input)
  const repository = deps.repository
  const signature = requestSignature(input)
  // A replay must not re-fingerprint against a changed connection or policy snapshot.
  const previous = await Promise.all((input.channels as VaultChannel[]).map(async channel => ({ channel, item: await repository.findByIdempotencyKey(input.workspaceId, channelKey(input.idempotencyKey, channel)) })))
  if (previous.some(entry => entry.item?.deletedAt)) throw new VaultSaveError(409, 'IDEMPOTENCY_CONFLICT', '이미 다른 내용에 사용한 요청 식별자예요.')
  if (previous.every(entry => entry.item)) {
    const saved: VaultSaveResult['saved'] = []
    for (const { channel, item } of previous) {
      if (!item || item.contentId !== input.contentId || item.versionId !== input.versionId || item.channel !== channel || item.targetDate !== input.targetDate) throw new VaultSaveError(409, 'IDEMPOTENCY_CONFLICT', '이미 다른 내용에 사용한 요청 식별자예요.')
      const events = await repository.listEvents(input.workspaceId, item.id)
      if (!events.some(e => e.eventType === 'vault.saved' && e.payload.requestSignature === signature)) throw new VaultSaveError(409, 'INCOMPLETE_SAVE', '저장이 완료되지 않았어요. 잠시 후 다시 시도해 주세요.')
      saved.push({ channel, release_gate_label: label(item.releaseGate), status_label: VAULT_APPROVAL_LABEL })
    }
    return { saved, rejected: [], external_posts: 0 }
  }
  // Read the selected immutable version scoped to workspace before touching service-role writes.
  const draft = await repository.getDraft(input.workspaceId, input.contentId, input.versionId)
  if (!draft) throw new VaultSaveError(404, 'CONTENT_NOT_FOUND', '콘텐츠를 찾을 수 없어요.')
  let truth: ChannelTruth
  let review: 'APPROVED' | 'PENDING' | 'REJECTED' | 'UNKNOWN'
  try { [truth, review] = await Promise.all([repository.getChannelTruth(input.workspaceId), repository.getProviderReviewStatus()]) }
  catch { truth = { instagram: { verified: false, accountId: null }, threads: { verified: false, accountId: null }, naver_blog: { verified: false, accountId: null }, daangn_business: { verified: false, accountId: null } }; review = 'UNKNOWN' }
  const saved: VaultSaveResult['saved'] = []
  const rejected: VaultSaveResult['rejected'] = []
  for (const channel of input.channels as VaultChannel[]) {
    const key = channelKey(input.idempotencyKey, channel)
    const existing = previous.find(entry => entry.channel === channel)?.item ?? null
    if (existing) {
      const priorEvents = await repository.listEvents(input.workspaceId, existing.id)
      const matching = existing.contentId === input.contentId && existing.versionId === input.versionId && existing.channel === channel && existing.targetDate === input.targetDate
        && priorEvents.some(e => e.eventType === 'vault.saved' && e.payload.requestSignature === signature)
      if (!matching && priorEvents.length > 0) throw new VaultSaveError(409, 'IDEMPOTENCY_CONFLICT', '이미 다른 내용에 사용한 요청 식별자예요.')
      if (existing.contentId !== input.contentId || existing.versionId !== input.versionId || existing.channel !== channel || existing.deletedAt) throw new VaultSaveError(409, 'IDEMPOTENCY_CONFLICT', '이미 다른 내용에 사용한 요청 식별자예요.')
      if (priorEvents.length === 0) throw new VaultSaveError(409, 'INCOMPLETE_SAVE', '저장이 완료되지 않았어요. 잠시 후 다시 시도해 주세요.')
      saved.push({ channel, release_gate_label: label(existing.releaseGate), status_label: VAULT_APPROVAL_LABEL })
      continue
    }
    const variant = variantOf(draft)
    const spec = evaluateChannelSpec(channel, variant)
    const verdict = evaluateApprovalActions({ channel, readiness: 'PREPARE_ONLY', connection: truth[channel]?.verified ? 'VERIFIED' : 'UNKNOWN', providerReviewStatus: review, specResult: spec, targetTime: null })
    if (!verdict.VAULT.allowed) {
      rejected.push({ channel, reason_label: channel === 'naver_blog' ? '네이버 블로그는 제목과 이미지가 필요해요' : spec.checks.find(check => check.status === 'FAIL')?.userMessage ?? '채널 규격을 수정한 뒤 보관할 수 있어요' })
      await telemetry(deps, input, 'vault.save_failed', channel, 'SPEC_FAILED')
      continue
    }
    if (!draft.title.trim() || !draft.caption.trim() || draft.media.some(m => m.type === 'image' && (!m.renditionContentDigest || !m.mimeType))) {
      rejected.push({ channel, reason_label: '내용이나 이미지 확인 정보가 부족해요. 원고를 확인해 주세요.' })
      await telemetry(deps, input, 'vault.save_failed', channel, 'FINGERPRINT_INPUT_MISSING')
      continue
    }
    const textBlockRenderSpec = { channel, blocks: [{ type: 'body', text: draft.caption }], digest: sha(JSON.stringify(['body', channel, draft.caption])) }
    const accountId = truth[channel]?.accountId ?? `unconnected:${input.workspaceId}:${channel}`
    let fingerprint: string
    try {
      fingerprint = calculateVaultFingerprintV3({ workspaceId: input.workspaceId, contentId: input.contentId, versionId: input.versionId, channel, targetAccountId: accountId, title: draft.title, textBlockRenderSpec, tags: draft.hashtags, settings: { category: null, visibility: 'PUBLIC', coupon: null }, images: draft.media.filter(m => m.type === 'image').map(m => ({ position: m.position, renditionContentDigest: m.renditionContentDigest! })) })
    } catch {
      rejected.push({ channel, reason_label: '승인 정보를 확인할 수 없어요. 원고를 확인해 주세요.' })
      await telemetry(deps, input, 'vault.save_failed', channel, 'FINGERPRINT_INVALID')
      continue
    }
    const { gate, reason } = gateFor(channel, truth, review)
    const payload: Record<string, VaultJson> = { title: draft.title, text: draft.caption, hashtags: draft.hashtags, media: draft.media.map(m => ({ position: m.position, type: m.type, mimeType: m.mimeType, sizeBytes: m.sizeBytes, renditionContentDigest: m.renditionContentDigest })), settings: { approved_target_account_id: accountId, approved_policy_versions: { 'vault-save': POLICY_VERSION, 'channel-spec': spec.specVersion }, valid_until: draft.validUntil }, targetAccountId: accountId, textBlockRenderSpec }
    try {
      const { item, created } = await repository.createItem({ workspaceId: input.workspaceId, contentId: input.contentId, versionId: input.versionId, channel, bundleId: null, releaseGate: gate, holdReason: reason, heldAt: new Date().toISOString(), heldBy: input.actorId, targetDate: input.targetDate, approvedFingerprint: fingerprint, fingerprintSchemaVersion: FINGERPRINT_SCHEMA_VERSION, policyVersion: POLICY_VERSION, specVersion: spec.specVersion, approvalState: 'APPROVED', approvedBy: input.actorId, idempotencyKey: key, deletedAt: null })
      if (!created) {
        const events = await repository.listEvents(input.workspaceId, item.id)
        if (item.contentId !== input.contentId || item.versionId !== input.versionId || item.channel !== channel || item.targetDate !== input.targetDate || !events.some(e => e.eventType === 'vault.saved' && e.payload.requestSignature === signature)) throw new VaultSaveError(409, 'IDEMPOTENCY_CONFLICT', '이미 다른 내용에 사용한 요청 식별자예요.')
      }
      await assureSavedSidecars(repository, item, payload, input.actorId, signature)
      saved.push({ channel, release_gate_label: label(item.releaseGate), status_label: VAULT_APPROVAL_LABEL })
      if (created) await telemetry(deps, input, 'vault.saved', channel)
    } catch (error) {
      await telemetry(deps, input, 'vault.save_failed', channel, error instanceof VaultSaveError ? error.reason : 'PERSISTENCE_ERROR')
      if (error instanceof VaultSaveError) throw error
      console.error('[vault.save] persistence error', error)
      throw new VaultSaveError(500, 'PERSISTENCE_ERROR', '보관하지 못했어요. 잠시 후 다시 시도해 주세요.')
    }
  }
  return { saved, rejected, external_posts: 0 }
}

/** OnChannelVerified listener contract: read-only connection truth, only held vault rows may change. */
export function onChannelVerified(deps: Pick<VaultSaveDependencies, 'repository'>): OnChannelVerified {
  return async (workspaceId, channel) => {
    if (channel !== 'instagram' && channel !== 'threads') return
    await reevaluateReleaseGates(workspaceId, deps)
  }
}
export async function reevaluateReleaseGates(workspaceId: string, deps: Pick<VaultSaveDependencies, 'repository'>): Promise<void> {
  const repository = deps.repository
  const [truth, review, items] = await Promise.all([repository.getChannelTruth(workspaceId), repository.getProviderReviewStatus(), repository.listItems(workspaceId)])
  for (const item of items) {
    if (item.deletedAt || item.approvalState !== 'APPROVED' || !['HELD_PROVIDER_PENDING', 'HELD_CONNECTION_PENDING'].includes(item.releaseGate ?? '')) continue
    const next = gateFor(item.channel, truth, review)
    const payload = await repository.getVariantPayload(workspaceId, item.id)
    const settings = payload?.payload.settings
    const approvedAccount = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings.approved_target_account_id : null
    const identityChanged = truth[item.channel]?.verified && approvedAccount !== truth[item.channel].accountId
    if (next.gate === item.releaseGate && !identityChanged) continue
    await repository.updateItem(workspaceId, item.id, { releaseGate: next.gate, holdReason: next.reason, approvalState: identityChanged ? 'NEEDS_REAPPROVAL' : item.approvalState })
    await repository.appendEvent({ workspaceId, vaultItemId: item.id, actorId: null, eventType: 'vault.release_gate_reevaluated', payload: { releaseGate: next.gate, reapprovalRequired: Boolean(identityChanged) } })
  }
}
