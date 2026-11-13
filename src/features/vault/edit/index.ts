import { createHash } from 'node:crypto'
import { evaluateChannelSpec } from '../channel-spec'
import { calculateVaultFingerprintV3 } from '../fingerprint/fingerprint'
import type { VaultChannel, VaultHoldReason, VaultItem, VaultJson, VaultReleaseGate, VaultVariantPayload } from '../types'
import { canWriteVault, VAULT_WRITE_FORBIDDEN_MESSAGE } from '../permissions'

export type EditOperation = 'edit' | 'replace_shared_image' | 'reapprove' | 'hold' | 'resume' | 'delete' | 'restore'
type Image = { position: number; type: 'image'; mimeType: string; sizeBytes: number; renditionContentDigest: string }
export interface EditChanges { title?: string; text?: string; hashtags?: string[]; settings?: { category: string | null; visibility: string; coupon: string | null }; targetDate?: string | null; image?: { oldDigest: string; replacement: Image } }
export interface EditInput { workspaceId: string; actorId: string; /** 라우트는 반드시 전달. 값이 있으면 대표/관리자만 허용(서비스 이중 방어). 생략은 서버 내부 호출 전용. */ actorRole?: string; itemRef: string; operation: EditOperation; changes?: EditChanges; expectedVersion: string; now: Date }
export interface EditEvent { eventType: string; payload: Record<string, VaultJson> }
export interface EditMutation { item: VaultItem; expectedVersion: string; actorId: string; changes: Partial<VaultItem>; payload: Record<string, VaultJson> | null; event: EditEvent }
export interface VaultEditRepository {
  getItem(workspaceId: string, id: string): Promise<VaultItem | null>
  getPayload(workspaceId: string, id: string): Promise<VaultVariantPayload | null>
  listImageCandidates(workspaceId: string): Promise<readonly VaultItem[]>
  /** Atomic compare-and-swap: item, payload and audit event commit together. */
  changeMany(workspaceId: string, mutations: readonly EditMutation[]): Promise<Record<string, string> | null>
}
export interface VaultEditDependencies {
  recordFunnelEvent?: (input: {
    workspaceId: string
    userId: string
    event: 'vault_edited' | 'reapproved'
    channel: VaultChannel
    properties?: {
      vaultItemId?: string
      contentId?: string
      versionId?: string
      fingerprint?: string
      previousFingerprint?: string
    }
  }) => Promise<unknown>
}
export class VaultEditError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}
const fail = (status: number, message: string): never => { throw new VaultEditError(status, message) }
const conflict = '보관 항목이 다른 곳에서 변경됐어요. 최신 내용을 불러온 뒤 다시 저장해 주세요.'
/** Compare timestamps as instants: PostgREST and the RPC render the same microsecond value differently (+00:00 vs Z, trailing zeros). */
export const versionKey = (v: string): string => {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]00(?::?00)?)$/.exec(v.trim())
  return m ? `${m[1]}T${m[2]}.${(m[3] ?? '').padEnd(6, '0')}Z` : v
}
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const date = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s

/** Inverse of query/formatters.ts' 16-byte UUID base64url encoding; accepts canonical refs only. */
export function decodeItemRef(ref: string): string {
  if (!/^[A-Za-z0-9_-]{22}$/.test(ref)) return fail(422, '보관 항목을 확인해 주세요.')
  const bytes = Buffer.from(ref, 'base64url')
  if (bytes.length !== 16 || bytes.toString('base64url') !== ref) return fail(422, '보관 항목을 확인해 주세요.')
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
export function isReleaseCandidate(item: VaultItem): boolean {
  return item.deletedAt === null && item.approvalState === 'APPROVED' && !!item.approvedFingerprint && item.releaseGate !== null && item.releaseGate !== 'RELEASE_REQUESTED'
}
export function restorationDeadline(deletedAt: string): string { return new Date(Date.parse(deletedAt) + 30 * 86_400_000).toISOString() }
export function eligibleForHardDeletion(item: VaultItem, now: Date): boolean {
  return item.deletedAt !== null && Number.isFinite(Date.parse(item.deletedAt)) && now.getTime() >= Date.parse(restorationDeadline(item.deletedAt))
}

type Media = { position: number; type: string; mimeType: string | null; sizeBytes: number | null; renditionContentDigest: string | null }
function object(value: VaultJson | undefined): Record<string, VaultJson> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(409, '보관 내용을 확인할 수 없어요. 다시 시도해 주세요.')
  return value
}
function mediaOf(payload: Record<string, VaultJson>): Media[] {
  if (!Array.isArray(payload.media)) return fail(409, '이미지 정보를 확인할 수 없어요.')
  return payload.media.map(m => {
    const row = object(m)
    if (!Number.isSafeInteger(row.position) || (row.type !== 'image' && row.type !== 'video')) return fail(409, '이미지 정보를 확인할 수 없어요.')
    return row as unknown as Media
  })
}
export function affectedImageChannels(items: readonly VaultItem[], payload: (id: string) => Record<string, VaultJson>, oldDigest: string): VaultChannel[] {
  return [...new Set(items.filter(item => !item.deletedAt && mediaOf(payload(item.id)).some(m => m.type === 'image' && m.renditionContentDigest === oldDigest)).map(item => item.channel))]
}
function fingerprint(item: VaultItem, payload: Record<string, VaultJson>): string {
  const settings = object(payload.settings)
  const spec = object(payload.textBlockRenderSpec)
  const title = payload.title, text = payload.text, tags = payload.hashtags
  if (typeof title !== 'string' || !title.trim() || typeof text !== 'string' || !text.trim() || !Array.isArray(tags) || !tags.every(t => typeof t === 'string') || typeof payload.targetAccountId !== 'string' || !payload.targetAccountId) return fail(422, '제목과 본문, 승인 정보를 확인해 주세요.')
  const media = mediaOf(payload)
  if (media.some(m => m.type === 'image' && (!m.mimeType || !m.renditionContentDigest))) return fail(422, '이미지 확인 정보가 부족해요.')
  const blocks = spec.blocks
  if (!Array.isArray(blocks) || typeof spec.digest !== 'string') return fail(409, '본문 승인 정보를 확인할 수 없어요.')
  return calculateVaultFingerprintV3({ workspaceId: item.workspaceId, contentId: item.contentId, versionId: item.versionId, channel: item.channel, targetAccountId: payload.targetAccountId,
    title, textBlockRenderSpec: { channel: item.channel, blocks: blocks as { type: string; text: string }[], digest: spec.digest }, tags: tags as string[],
    // The save service stores no category/visibility/coupon (it fingerprints these defaults), so a missing
    // value must resolve to the same defaults or every saved item would be uneditable and unapprovable.
    settings: {
      category: typeof settings.category === 'string' ? settings.category : null,
      visibility: typeof settings.visibility === 'string' && settings.visibility ? settings.visibility : 'PUBLIC',
      coupon: typeof settings.coupon === 'string' ? settings.coupon : null,
    },
    images: media.filter(m => m.type === 'image').map(m => ({ position: m.position, renditionContentDigest: m.renditionContentDigest! })) })
}
function updatedPayload(payload: Record<string, VaultJson>, changes: EditChanges, channel: VaultChannel): Record<string, VaultJson> {
  const next = { ...payload }
  if (changes.title !== undefined) next.title = changes.title
  if (changes.text !== undefined) {
    next.text = changes.text
    next.textBlockRenderSpec = { channel, blocks: [{ type: 'body', text: changes.text }], digest: hash(JSON.stringify(['body', channel, changes.text])) }
  }
  if (changes.hashtags !== undefined) next.hashtags = changes.hashtags
  if (changes.settings !== undefined) next.settings = { ...object(payload.settings), ...changes.settings }
  if (changes.image !== undefined) {
    const { oldDigest, replacement } = changes.image
    if (!/^[a-f0-9]{64}$/.test(oldDigest) || !/^[a-f0-9]{64}$/.test(replacement.renditionContentDigest) || replacement.position < 0 || !Number.isSafeInteger(replacement.position) || !replacement.mimeType.startsWith('image/') || !Number.isSafeInteger(replacement.sizeBytes) || replacement.sizeBytes < 0) return fail(422, '교체할 이미지 정보를 확인해 주세요.')
    const before = mediaOf(payload)
    if (!before.some(m => m.type === 'image' && m.renditionContentDigest === oldDigest)) return fail(422, '교체할 이미지를 찾을 수 없어요.')
    next.media = before.map(m => m.type === 'image' && m.renditionContentDigest === oldDigest ? { ...replacement, position: m.position } : m) as unknown as VaultJson
  }
  return next
}
function checkSpec(item: VaultItem, payload: Record<string, VaultJson>) {
  const media = mediaOf(payload)
  const result = evaluateChannelSpec(item.channel, { title: payload.title as string, text: payload.text as string, caption: payload.text as string, hashtags: payload.hashtags as string[], media: media.map(m => ({ type: m.type as 'image' | 'video', mimeType: m.mimeType ?? undefined, fileSizeBytes: m.sizeBytes ?? undefined })) })
  if (result.blocksVault || result.checks.some(c => c.status === 'UNKNOWN')) fail(422, result.checks.find(c => c.status === 'FAIL' || c.status === 'UNKNOWN')?.userMessage ?? '채널 규격을 확인해 주세요.')
  return result.specVersion
}
async function commitMany(repo: VaultEditRepository, workspaceId: string, mutations: EditMutation[]): Promise<Record<string, string>> {
  const versions = await repo.changeMany(workspaceId, mutations)
  if (!versions || mutations.some(({ item }) => typeof versions[item.id] !== 'string' || !versions[item.id])) return fail(409, conflict)
  return versions
}
async function commit(repo: VaultEditRepository, item: VaultItem, expectedVersion: string, actorId: string, changes: Partial<VaultItem>, payload: Record<string, VaultJson> | null, event: EditEvent): Promise<string> {
  const versions = await commitMany(repo, item.workspaceId, [{ item, expectedVersion, actorId, changes, payload, event }])
  return versions[item.id]
}
export async function applyVaultEdit(repo: VaultEditRepository, input: EditInput, deps?: VaultEditDependencies): Promise<{ status_label: string; message: string; item_ref: string; updated_at: string }> {
  if (input.actorRole !== undefined && !canWriteVault(input.actorRole)) fail(403, VAULT_WRITE_FORBIDDEN_MESSAGE)
  let committedVersion: string
  const committed = (result: { status_label: string; message: string; item_ref: string }) => ({ ...result, updated_at: committedVersion })
  if (!Number.isFinite(input.now.getTime())) fail(422, '요청 시간을 확인해 주세요.')
  const id = decodeItemRef(input.itemRef)
  const item = await repo.getItem(input.workspaceId, id)
  if (!item || item.workspaceId !== input.workspaceId) throw new VaultEditError(404, '보관 항목을 찾을 수 없어요.')
  if (typeof input.expectedVersion !== 'string' || !input.expectedVersion.trim()) fail(400, '최신 내용을 불러온 뒤 다시 시도해 주세요.')
  if (versionKey(item.updatedAt) !== versionKey(input.expectedVersion)) fail(409, conflict)
  const isDeleted = item.deletedAt !== null
  if (isDeleted && input.operation !== 'restore') fail(409, '삭제된 항목은 복구한 뒤 변경할 수 있어요.')
  if (!isDeleted && input.operation === 'restore') fail(409, '삭제되지 않은 항목이에요.')
  const event = (eventType: string, payload: Record<string, VaultJson> = {}): EditEvent => ({ eventType, payload })
  if (input.operation === 'delete' || input.operation === 'restore') {
    if (input.operation === 'restore' && eligibleForHardDeletion(item, input.now)) fail(409, '복구 기간이 지났어요.')
    committedVersion = await commit(repo, item, input.expectedVersion, input.actorId, { deletedAt: input.operation === 'delete' ? input.now.toISOString() : null }, null, event(input.operation === 'delete' ? 'vault.deleted' : 'vault.restored'))
    return committed({ item_ref: input.itemRef, status_label: input.operation === 'delete' ? '삭제됨 · 30일 안에 복구 가능' : '복구됨', message: input.operation === 'delete' ? '보관 항목을 삭제했어요.' : '보관 항목을 복구했어요.' })
  }
  if (input.operation === 'hold' || input.operation === 'resume') {
    if (input.operation === 'resume' && item.releaseGate !== 'HELD_USER') fail(409, '사용자가 보류한 항목만 재개할 수 있어요.')
    const restoredGate: VaultReleaseGate =
      item.holdReason === 'META_REVIEW_PENDING' ? 'HELD_PROVIDER_PENDING' :
      item.holdReason === 'CHANNEL_NOT_CONNECTED' ? 'HELD_CONNECTION_PENDING' :
      'HELD_USER'
    const restoredReason: VaultHoldReason =
      restoredGate === 'HELD_PROVIDER_PENDING' ? 'META_REVIEW_PENDING' :
      restoredGate === 'HELD_CONNECTION_PENDING' ? 'CHANNEL_NOT_CONNECTED' :
      'USER_HELD'
    committedVersion = await commit(
      repo,
      item,
      input.expectedVersion,
      input.actorId,
      input.operation === 'hold'
        ? { releaseGate: 'HELD_USER', holdReason: 'USER_HELD', heldAt: input.now.toISOString(), heldBy: input.actorId }
        : { releaseGate: restoredGate, holdReason: restoredReason, heldAt: item.heldAt ?? input.now.toISOString(), heldBy: item.heldBy ?? input.actorId },
      null,
      event(input.operation === 'hold' ? 'vault.held' : 'vault.resumed')
    )
    return committed({ item_ref: input.itemRef, status_label: input.operation === 'hold' ? '사용자 보류' : '보류 해제', message: input.operation === 'hold' ? '발행을 보류했어요.' : '보류를 해제했어요. 게시 전 다시 확인해 주세요.' })
  }
  const sidecar = await repo.getPayload(input.workspaceId, item.id)
  if (!sidecar || sidecar.workspaceId !== item.workspaceId) throw new VaultEditError(409, '보관 내용을 확인할 수 없어요.')
  if (input.operation === 'reapprove') {
    const specVersion = checkSpec(item, sidecar.payload)
    const currentSettings = object(sidecar.payload.settings)
    const refreshedPayload: Record<string, VaultJson> = {
      ...sidecar.payload,
      settings: {
        ...currentSettings,
        approved_policy_versions: {
          ...((currentSettings.approved_policy_versions as Record<string, string>) ?? {}),
          'channel-spec': specVersion,
          'vault-save': 'vault-save-v1',
        },
      },
    }
    let next: string
    try { next = fingerprint(item, refreshedPayload) } catch { return fail(422, '승인 정보를 확인할 수 없어요.') }
    committedVersion = await commit(
      repo,
      item,
      input.expectedVersion,
      input.actorId,
      { approvedFingerprint: next, fingerprintSchemaVersion: 3, approvalState: 'APPROVED', approvedBy: input.actorId, specVersion, policyVersion: 'vault-save-v1' },
      refreshedPayload,
      event('vault.reapproved', { previousApprovedFingerprint: item.approvedFingerprint, fingerprint: next })
    )
    try {
      await deps?.recordFunnelEvent?.({
        workspaceId: input.workspaceId,
        userId: input.actorId,
        event: 'reapproved',
        channel: item.channel,
        properties: {
          vaultItemId: item.id,
          contentId: item.contentId,
          versionId: item.versionId,
          fingerprint: next,
          previousFingerprint: item.approvedFingerprint ?? undefined,
        },
      })
    } catch { /* best-effort telemetry */ }
    return committed({ item_ref: input.itemRef, status_label: '발행 준비 완료 · 외부 게시 전', message: '변경 내용을 다시 승인하고 보관했어요.' })
  }
  const changes = input.changes
  if (!changes || !Object.keys(changes).length) throw new VaultEditError(422, '수정할 내용을 입력해 주세요.')
  if (input.operation === 'edit' && changes.image !== undefined || input.operation === 'replace_shared_image' && (changes.image === undefined || Object.keys(changes).some(k => k !== 'image'))) fail(422, '수정할 내용을 확인해 주세요.')
  if (changes.title !== undefined && (typeof changes.title !== 'string' || !changes.title.trim()) || changes.text !== undefined && (typeof changes.text !== 'string' || !changes.text.trim()) || changes.hashtags !== undefined && (!Array.isArray(changes.hashtags) || !changes.hashtags.every(t => typeof t === 'string')) || changes.settings !== undefined && (typeof changes.settings.visibility !== 'string' || !changes.settings.visibility)) fail(422, '제목, 본문 또는 설정을 확인해 주세요.')
  if (changes.targetDate !== undefined && changes.targetDate !== null && !date(changes.targetDate)) fail(422, '예정일을 확인해 주세요.')
  if (input.operation === 'replace_shared_image') {
    const siblings = await repo.listImageCandidates(input.workspaceId)
    const mutations: EditMutation[] = []
    for (const sibling of siblings) {
      if (sibling.deletedAt) continue
      const variant = await repo.getPayload(input.workspaceId, sibling.id)
      if (!variant) throw new VaultEditError(409, '공통 이미지를 사용하는 항목을 확인할 수 없어요.')
      if (!mediaOf(variant.payload).some(m => m.type === 'image' && m.renditionContentDigest === changes.image!.oldDigest)) continue
      mutations.push(makeEditMutation(sibling, sibling.id === item.id ? input.expectedVersion : sibling.updatedAt, input.actorId, variant.payload, updatedPayload(variant.payload, changes, sibling.channel)))
    }
    if (!mutations.some(m => m.item.id === item.id)) fail(422, '선택한 항목에서 교체할 이미지를 찾을 수 없어요.')
    if (mutations.length > 4) fail(409, '공통 이미지가 연결된 항목이 너무 많아요. 다시 확인해 주세요.')
    committedVersion = (await commitMany(repo, input.workspaceId, mutations))[item.id]
    for (const m of mutations) {
      if (m.changes.approvalState === 'INVALIDATED') {
        try {
          await deps?.recordFunnelEvent?.({
            workspaceId: input.workspaceId,
            userId: input.actorId,
            event: 'vault_edited',
            channel: m.item.channel,
            properties: {
              vaultItemId: m.item.id,
              contentId: m.item.contentId,
              versionId: m.item.versionId,
            },
          })
        } catch { /* best-effort telemetry */ }
      }
    }
    return committed({ item_ref: input.itemRef, status_label: '재승인 필요', message: '공통 이미지를 사용하는 보관 글의 승인이 무효가 됐어요.' })
  }
  const singleMutation = makeEditMutation(item, input.expectedVersion, input.actorId, sidecar.payload, updatedPayload(sidecar.payload, changes, item.channel), changes.targetDate)
  committedVersion = (await commitMany(repo, input.workspaceId, [singleMutation]))[item.id]
  if (singleMutation.changes.approvalState === 'INVALIDATED') {
    try {
      await deps?.recordFunnelEvent?.({
        workspaceId: input.workspaceId,
        userId: input.actorId,
        event: 'vault_edited',
        channel: item.channel,
        properties: {
          vaultItemId: item.id,
          contentId: item.contentId,
          versionId: item.versionId,
        },
      })
    } catch { /* best-effort telemetry */ }
  }
  return committed({ item_ref: input.itemRef, status_label: changes.targetDate !== undefined && Object.keys(changes).length === 1 ? '예정일 변경됨' : '재승인 필요', message: '보관 글의 변경 내용을 저장했어요.' })
}
function makeEditMutation(item: VaultItem, expectedVersion: string, actorId: string, before: Record<string, VaultJson>, payload: Record<string, VaultJson>, targetDate?: string | null): EditMutation {
  let next: string, old: string
  try { next = fingerprint(item, payload) } catch { return fail(422, '제목, 본문 또는 이미지 정보를 확인해 주세요.') }
  try { old = fingerprint(item, before) } catch { return fail(409, '기존 승인 정보를 확인할 수 없어요.') }
  const invalidated = old !== next
  return { item, expectedVersion, actorId, changes: { ...(targetDate !== undefined ? { targetDate } : {}), ...(invalidated ? { approvalState: 'INVALIDATED' as const, approvedFingerprint: null, approvedBy: null } : {}) }, payload, event: eventForEdit(invalidated, item, old, next) }
}
function eventForEdit(invalidated: boolean, item: VaultItem, old: string, next: string): EditEvent {
  return invalidated ? { eventType: 'approval_invalidated', payload: { previousApprovedFingerprint: item.approvedFingerprint, previousContentFingerprint: old, currentContentFingerprint: next } } : { eventType: 'vault.edited', payload: { approvalRetained: true } }
}
