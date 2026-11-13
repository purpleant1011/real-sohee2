import type { CurrentOperatorContext } from '@/features/operator-auth/schemas'

/** Only allowlisted operational facts may leave the server; never serialize raw provider payloads. */
export type RequestRow = { id: string; workspace_id: string; channel: string; status: string; failure_code: string | null; created_at: string; updated_at: string }
export type AttemptRow = { id: string; action_request_id: string; workspace_id: string; status: string; provider_request_id: string | null; provider_reference: string | null; started_at: string; finished_at: string | null }
export type ReceiptRow = { id: string; action_request_id: string; workspace_id: string; receipt_kind: string; provider_reference: string | null; result_url: string | null; observed_payload: Record<string, unknown>; recorded_at: string }
export type QueueKind = 'RESULT_UNKNOWN' | 'PENDING_READBACK' | 'RECEIPT_DB_MISMATCH' | 'EXECUTING_STALLED'
export type QueueItem = { id: string; workspaceId: string; channelLabel: string; kind: QueueKind; kindLabel: string; occurredAt: string; requestSummary: string; responseSummary: string; receiptSummary: string; readbackSummary: string; verified: false }
export interface ReconcileStore {
  listRequests(scopes: 'all' | readonly string[]): Promise<RequestRow[]>
  listAttempts(workspaceIds: readonly string[], requestIds: readonly string[]): Promise<AttemptRow[]>
  listReceipts(workspaceIds: readonly string[], requestIds: readonly string[]): Promise<ReceiptRow[]>
  loadRequest(workspaceId: string, requestId: string): Promise<RequestRow | null>
  loadProviderReference(workspaceId: string, requestId: string): Promise<string | null>
  appendAudit(record: { workspace_id: string; actor_id: string; entity_id: string; entity_type: string; event_type: string; metadata: { decision: string; reason: string } }): Promise<void>
}

const kinds: Record<QueueKind, string> = {
  RESULT_UNKNOWN: '결과 확인 필요', PENDING_READBACK: '게시 확인 대기',
  RECEIPT_DB_MISMATCH: '증거와 기록 불일치', EXECUTING_STALLED: '실행 정체',
}
const channels: Record<string, string> = { instagram: '인스타그램', threads: '스레드', naver_blog: '네이버 블로그', daangn_business: '당근 비즈니스' }
function proof(receipt: ReceiptRow): boolean {
  return receipt.receipt_kind === 'observed_result' && receipt.observed_payload?.verified === true
    && receipt.observed_payload?.read_after_write === true && !!receipt.provider_reference && !!receipt.result_url
    && /^https:\/\//u.test(receipt.result_url)
}
export function countVerified(requests: readonly RequestRow[], receipts: readonly ReceiptRow[]): number {
  return requests.filter(row => row.status === 'succeeded' && receipts.some(receipt => receipt.workspace_id === row.workspace_id && receipt.action_request_id === row.id && proof(receipt))).length
}
export function classifyQueue(row: RequestRow, attempt: AttemptRow | undefined, receipts: readonly ReceiptRow[], now = Date.now()): QueueItem | null {
  const observed = receipts.find(receipt => proof(receipt))
  const mismatch = (row.status === 'succeeded' && !observed) || (!!observed && row.status !== 'succeeded')
    || (!!observed && !!attempt && attempt.status !== 'succeeded')
    || (!!observed && !!attempt?.provider_reference && observed.provider_reference !== attempt.provider_reference)
  const stalled = row.status === 'executing' && Number.isFinite(Date.parse(row.updated_at)) && now - Date.parse(row.updated_at) >= 15 * 60_000
  const pending = ['submitted', 'provider_review'].includes(row.status) || attempt?.status === 'submitted'
  const kind: QueueKind | null = mismatch ? 'RECEIPT_DB_MISMATCH'
    : row.status === 'unknown_result' || row.failure_code === 'UNKNOWN_RESULT' || attempt?.status === 'unknown_result' ? 'RESULT_UNKNOWN'
    : stalled ? 'EXECUTING_STALLED' : pending ? 'PENDING_READBACK' : null
  if (!kind) return null
  return {
    id: row.id, workspaceId: row.workspace_id, channelLabel: channels[row.channel] ?? '외부 채널',
    kind, kindLabel: kinds[kind], occurredAt: row.updated_at,
    requestSummary: `요청 기록: ${row.created_at} · ${channels[row.channel] ?? '외부 채널'}`,
    responseSummary: attempt ? `제공자 응답: ${attempt.provider_reference ? '참조 있음' : '참조 없음'} · ${attempt.finished_at ?? attempt.started_at}` : '제공자 응답 기록 없음',
    receiptSummary: receipts.length ? `영수증 ${receipts.length}건 · ${observed ? '독립 확인 근거 있음' : '독립 확인 근거 없음'}` : '영수증 없음',
    readbackSummary: observed ? `독립 조회 근거 기록됨 · ${observed.recorded_at}` : '독립 조회로 게시 확인되지 않음',
    verified: false,
  }
}
export async function loadReconcileQueue({ scopes }: { scopes: 'all' | readonly string[] }, store: ReconcileStore, now = Date.now()): Promise<{ items: QueueItem[]; verifiedCount: number }> {
  if (scopes !== 'all' && scopes.length === 0) return { items: [], verifiedCount: 0 }
  const requests = await store.listRequests(scopes)
  if (!requests.length) return { items: [], verifiedCount: 0 }
  const workspaceIds = [...new Set(requests.map(row => row.workspace_id))]
  const ids = requests.map(row => row.id)
  const [attempts, receipts] = await Promise.all([store.listAttempts(workspaceIds, ids), store.listReceipts(workspaceIds, ids)])
  const items = requests.flatMap(row => {
    const attempt = attempts.filter(item => item.workspace_id === row.workspace_id && item.action_request_id === row.id).sort((a, b) => b.started_at.localeCompare(a.started_at))[0]
    const candidate = classifyQueue(row, attempt, receipts.filter(item => item.workspace_id === row.workspace_id && item.action_request_id === row.id), now)
    return candidate ? [candidate] : []
  })
  return { items, verifiedCount: countVerified(requests, receipts) }
}

export interface ReadbackPort {
  /** GET/probe only. Must never submit, publish, retry, or update a provider object. */
  lookup(input: { workspaceId: string; requestId: string; channel: string; providerPostId: string | null }): Promise<{ state: 'FOUND' | 'NOT_FOUND' | 'UNKNOWN'; observedAt: string }>
}
export async function recheckReadback(input: { workspaceId: string; requestId: string; operatorId: string }, store: ReconcileStore, port: ReadbackPort) {
  const row = await store.loadRequest(input.workspaceId, input.requestId)
  if (!row) throw new Error('대사 항목을 찾지 못했습니다.')
  // A probe result alone cannot create a verified receipt or authorize another publish.
  const providerPostId = await store.loadProviderReference(input.workspaceId, input.requestId)
  const result = await port.lookup({ workspaceId: input.workspaceId, requestId: input.requestId, channel: row.channel, providerPostId })
  if (!['FOUND', 'NOT_FOUND', 'UNKNOWN'].includes(result.state)) throw new Error('조회 결과를 확인할 수 없습니다.')
  return result
}
export async function manualConfirm(input: { workspaceId: string; requestId: string; operatorId: string; reason: string; decision: 'POST_PRESENT' | 'POST_ABSENT' }, store: ReconcileStore) {
  const reason = input.reason.trim()
  if (!reason || reason.length > 500) throw new Error('수동 확정 사유를 입력해 주세요.')
  const row = await store.loadRequest(input.workspaceId, input.requestId)
  if (!row) throw new Error('대사 항목을 찾지 못했습니다.')
  await store.appendAudit({ workspace_id: row.workspace_id, actor_id: input.operatorId, entity_id: row.id, entity_type: 'external_action_request', event_type: 'admin.reconcile.manual_confirm', metadata: { decision: input.decision, reason } })
  // Manual opinion is an audit fact, not a provider readback receipt. Never promote status.
  return { recorded: true as const }
}
export async function guardExternalRetry(input: { workspaceId: string; requestId: string }, store: ReconcileStore): Promise<never> {
  const row = await store.loadRequest(input.workspaceId, input.requestId)
  if (!row) throw new Error('대사 항목을 찾지 못했습니다.')
  throw new Error('독립 조회와 증거 대사로 게시 여부를 확인하기 전에는 재게시할 수 없습니다. 이 화면에서는 재게시를 지원하지 않습니다.')
}

/** Scope follows publish.read grants, not the unrelated aggregate operator scope. */
export function readableScopes(operator: CurrentOperatorContext): 'all' | readonly string[] {
  const grants = operator.permissionScopes.filter(item => item.permission === 'publish.read')
  if (grants.some(item => item.workspaceScope === 'all')) return 'all'
  return [...new Set(grants.flatMap(item => item.workspaceScope === 'all' ? [] : item.workspaceScope))]
}
