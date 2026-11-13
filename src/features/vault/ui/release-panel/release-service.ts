import { evaluateApprovalActions } from '../../approval-policy'
import type { PreflightConnectionHealth, PreflightResult } from '../../preflight'
import type { VaultItem } from '../../types'
import type { ReadinessStage } from '@/features/readiness'

export interface ReleaseDependencies {
  listItems(workspaceId: string): Promise<readonly VaultItem[]>
  readConnectionHealth(workspaceId: string, channel: VaultItem['channel']): Promise<PreflightConnectionHealth | null>
  readiness(workspaceId: string): Promise<ReadinessStage>
  runPreflight(workspaceId: string, itemId: string, actorId: string | null): Promise<PreflightResult>
  /** Conditional DB update: only an approved, still held item in this workspace may transition. */
  markRequested(workspaceId: string, itemId: string): Promise<boolean>
  recordReleaseRequested?(workspaceId: string, item: VaultItem, actorId: string | null): Promise<void>
  readInterventionState?(workspaceId: string, channel?: VaultItem['channel']): Promise<{ blocked: boolean; label: string | null }>
  reevaluate?(workspaceId: string): Promise<void>
}

export class ReleaseError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
const names: Record<VaultItem['channel'], string> = { instagram: '인스타그램', threads: '스레드', naver_blog: '네이버 블로그', daangn_business: '당근 비즈니스' }
const channels = Object.keys(names) as VaultItem['channel'][]
const enabled = (item: VaultItem) => item.deletedAt === null && item.releaseGate !== null && item.releaseGate !== 'RELEASE_REQUESTED'

export function formatAccountLabel(raw?: string | null): string {
  if (!raw) return '연결된 계정'
  const trimmed = raw.trim()
  if (!trimmed || trimmed === '연결된 계정') return '연결된 계정'
  if (/^\d{6,}$/.test(trimmed) || /^(act-|token-|eaab|ig-|th-)/i.test(trimmed)) {
    return '연결된 계정'
  }
  if (trimmed.startsWith('@')) return trimmed
  if (/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    return `@${trimmed}`
  }
  return trimmed
}

async function channelStatus(workspaceId: string, channel: VaultItem['channel'], deps: ReleaseDependencies, readiness: ReadinessStage) {
  const health = await deps.readConnectionHealth(workspaceId, channel).catch(() => null)
  const verdict = evaluateApprovalActions({ channel, readiness, connection: health?.connection ?? 'UNKNOWN', providerReviewStatus: health?.providerReview ?? 'UNKNOWN', specResult: { blocksVault: false }, targetTime: null }).PUBLISH
  const expired = health?.tokenExpiresAt && (!Number.isFinite(Date.parse(health.tokenExpiresAt)) || Date.parse(health.tokenExpiresAt) <= Date.now())
  const tokenUnknown = (channel === 'instagram' || channel === 'threads') && !health?.tokenExpiresAt
  const account_label = formatAccountLabel(health?.accountLabel)
  return { channel, label: names[channel], open: verdict.allowed && !expired && !tokenUnknown, reason_label: expired ? '인증 시간이 지났어요. 채널을 다시 연결해 주세요' : tokenUnknown ? '인증 유효기간을 확인할 수 없어요. 채널을 다시 연결해 주세요' : verdict.message, review_label: channel === 'instagram' || channel === 'threads' ? health?.providerReview === 'APPROVED' ? 'Meta 앱 심사 완료' : health?.providerReview === 'PENDING' ? 'Meta 앱 심사 대기 중' : 'Meta 앱 심사를 확인할 수 없어요' : '연동 준비 중', account_label }
}
export async function releaseStatus(workspaceId: string, deps: ReleaseDependencies) {
  await deps.reevaluate?.(workspaceId)
  if (deps.readInterventionState) {
    const safety = await deps.readInterventionState(workspaceId)
    if (safety.blocked) return { open: false, reason_label: safety.label ?? '소희가 잠시 멈췄어요', connections: [], count: (await deps.listItems(workspaceId)).filter(enabled).length }
  }
  const [items, readiness] = await Promise.all([deps.listItems(workspaceId), deps.readiness(workspaceId)])
  const connections = await Promise.all(channels.map(channel => channelStatus(workspaceId, channel, deps, readiness)))
  const available = items.filter(enabled)
  const active = connections.filter(row => available.some(item => item.channel === row.channel))
  const open = active.some(row => row.open)
  return { open, reason_label: !open ? active.find(row => !row.open)?.reason_label ?? '발행할 보관 글이 없어요' : null, connections, count: available.length }
}
export interface ReleaseRow { item_ref: string; channel_label: string; channel: VaultItem['channel']; account_label: string; status_label: string; reason_label: string | null; action_label: string | null; checks: { status_label: string; message: string; action: string | null }[]; can_release: boolean }
export function releaseRef(id: string): string {
  try {
    const hex = id.replace(/-/g, '')
    if (hex.length === 32 && /^[0-9a-fA-F]{32}$/.test(hex)) {
      return Buffer.from(hex, 'hex').toString('base64url')
    }
  } catch {}
  return Buffer.from(id).toString('base64url')
}

export function decodeReleaseRef(ref: string): string {
  try {
    const bytes = Buffer.from(ref, 'base64url')
    if (bytes.length === 16) {
      const hex = bytes.toString('hex')
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    }
    return bytes.toString('utf8')
  } catch {
    return ref
  }
}
const rowOf = (item: VaultItem, result: PreflightResult, account_label = '연결된 계정'): ReleaseRow => ({ item_ref: releaseRef(item.id), channel: item.channel, channel_label: names[item.channel], account_label, status_label: result.canRelease ? '통과' : '재확인 필요', reason_label: result.blockedReasons[0] ?? null, action_label: result.items.find(check => check.action && (check.status === 'FAIL' || check.status === 'UNKNOWN' || check.status === 'NOT_APPLICABLE'))?.action ?? null, checks: result.items.map(check => ({ status_label: check.status === 'PASS' ? '통과' : check.status === 'FAIL' ? '실패' : check.status === 'UNKNOWN' ? '확인 필요' : '해당 없음', message: check.message, action: check.action })), can_release: result.canRelease })
function select(items: readonly VaultItem[], ids: readonly string[]) {
  if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !items.some(item => releaseRef(item.id) === id && enabled(item)))) throw new ReleaseError(422, '보관 항목을 다시 선택해 주세요')
  return ids.map(id => items.find(item => releaseRef(item.id) === id)!)
}
async function requireOpen(workspaceId: string, selected: readonly VaultItem[], deps: ReleaseDependencies) {
  if (deps.readInterventionState) {
    for (const channel of new Set(selected.map(item => item.channel))) {
      const safety = await deps.readInterventionState(workspaceId, channel)
      if (safety.blocked) throw new ReleaseError(423, safety.label ?? '소희가 잠시 멈췄어요')
    }
  }
  const readiness = await deps.readiness(workspaceId)
  for (const channel of new Set(selected.map(item => item.channel))) {
    const status = await channelStatus(workspaceId, channel, deps, readiness)
    if (!status.open) throw new ReleaseError(423, `지금은 열 수 없어요 · ${status.reason_label ?? '연결 상태를 확인해 주세요'}`)
  }
}
export async function preflightRelease(workspaceId: string, actorId: string, deps: ReleaseDependencies) {
  await deps.reevaluate?.(workspaceId)
  if (deps.readInterventionState) {
    const safety = await deps.readInterventionState(workspaceId)
    if (safety.blocked) throw new ReleaseError(423, safety.label ?? '소희가 잠시 멈췄어요')
  }
  const items = (await deps.listItems(workspaceId)).filter(enabled)
  if (!items.length) return { passed: 0, needs_review: 0, items: [] as ReleaseRow[] }
  const readiness = await deps.readiness(workspaceId)
  const statuses = await Promise.all([...new Set(items.map(item => item.channel))].map(channel => channelStatus(workspaceId, channel, deps, readiness)))
  if (!statuses.some(status => status.open)) throw new ReleaseError(423, `지금은 열 수 없어요 · ${statuses[0]?.reason_label ?? '연결 상태를 확인해 주세요'}`)
  const rows: ReleaseRow[] = []
  for (const item of items) {
    const status = statuses.find(entry => entry.channel === item.channel)!
    rows.push(status.open ? rowOf(item, await deps.runPreflight(workspaceId, item.id, actorId), status.account_label) : {
      item_ref: releaseRef(item.id), channel: item.channel, channel_label: names[item.channel], account_label: status.account_label, status_label: '재확인 필요', reason_label: status.reason_label,
      action_label: '채널 연결과 심사 상태를 확인해 주세요', checks: [{ status_label: '확인 필요', message: status.reason_label ?? '연결 상태를 확인해 주세요', action: '채널 연결과 심사 상태를 확인해 주세요' }], can_release: false,
    })
  }
  return { passed: rows.filter(row => row.can_release).length, needs_review: rows.filter(row => !row.can_release).length, items: rows }
}
export async function requestRelease(workspaceId: string, ids: readonly string[], deps: ReleaseDependencies, actorId: string | null = null) {
  if (deps.readInterventionState) {
    const safety = await deps.readInterventionState(workspaceId)
    if (safety.blocked) throw new ReleaseError(423, safety.label ?? '소희가 잠시 멈췄어요')
  }
  const selected = select(await deps.listItems(workspaceId), ids)
  await requireOpen(workspaceId, selected, deps)
  const readiness = await deps.readiness(workspaceId)
  const statuses = await Promise.all([...new Set(selected.map(item => item.channel))].map(channel => channelStatus(workspaceId, channel, deps, readiness)))
  const rows: ReleaseRow[] = []
  let requested = 0
  for (const item of selected) {
    const status = statuses.find(entry => entry.channel === item.channel)
    const result = await deps.runPreflight(workspaceId, item.id, actorId)
    const row = rowOf(item, result, status?.account_label ?? '연결된 계정')
    if (row.can_release) {
      await requireOpen(workspaceId, [item], deps)
      if (await deps.markRequested(workspaceId, item.id)) {
        requested++
        await deps.recordReleaseRequested?.(workspaceId, item, actorId)
      } else { row.can_release = false; row.status_label = '재확인 필요'; row.reason_label = '보관 상태가 변경됐어요. 다시 확인해 주세요'; row.action_label = '재검사를 다시 진행해 주세요' }
    }
    rows.push(row)
  }
  return { requested, items: rows, external_posts: 0 }
}
