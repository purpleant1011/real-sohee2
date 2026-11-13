import type { VaultChannel, VaultItem } from '../types'
import type { PreflightResult } from '../preflight'

export type BatchPublishStatus = 'published' | 'blocked' | 'failed' | 'needs_check' | 'skipped_preview_only'
export interface BatchPublishItemResult { item_ref: string; status: BatchPublishStatus; message: string }
export interface BatchPublishResult { results: BatchPublishItemResult[]; published: number; blocked: number; failed: number; needs_check: number }
export interface BatchPublishInput { workspaceId: string; actorId: string; itemIds?: string[]; now: Date }
export interface BatchPublishDeps {
  listItems(workspaceId: string, ids?: readonly string[]): Promise<readonly VaultItem[]>
  claim(workspaceId: string, id: string): Promise<boolean>
  hold(workspaceId: string, id: string, reason: 'USER_HELD' | 'CHANNEL_NOT_CONNECTED' | 'META_REVIEW_PENDING' | 'REAPPROVAL_REQUIRED', gate: 'HELD_USER' | 'HELD_CONNECTION_PENDING' | 'HELD_PROVIDER_PENDING'): Promise<void>
  complete(workspaceId: string, id: string): Promise<void>
  preflight(workspaceId: string, id: string, actorId: string, now: Date): Promise<PreflightResult>
  publish(item: VaultItem, actorId: string): Promise<{ success: boolean; verified: boolean; stage: string; publishedUrl?: string }>
  recordPublished(item: VaultItem, actorId: string, url: string): Promise<void>
  recordEvent(item: VaultItem, actorId: string, event: 'vault.publish_failed' | 'vault.publish_uncertain', message: string): Promise<void>
  reevaluate(workspaceId: string): Promise<void>
  enabled(workspaceId?: string): boolean
  ref(id: string): string
  now(): Date
}

const previewMessage = '네이버 블로그와 당근은 소희에서 미리보기까지만 지원해요'
const disabledMessage = '아직 실제 발행이 켜지지 않았어요'
const checkMessage = '게시 여부를 확인해 주세요'
const failedMessage = '게시하지 못했어요'
const blockedMessage = '발행 조건을 다시 확인해 주세요'
const isMeta = (channel: VaultChannel) => channel === 'instagram' || channel === 'threads'

export async function publishReleasedItems(input: BatchPublishInput, deps: BatchPublishDeps): Promise<BatchPublishResult> {
  const results: BatchPublishItemResult[] = []
  const add = (id: string, status: BatchPublishStatus, message: string) => results.push({ item_ref: deps.ref(id), status, message })
  const ids = input.itemIds?.slice(0, 10)
  if (!deps.enabled(input.workspaceId)) {
    if (ids) ids.forEach(id => add(id, 'blocked', disabledMessage))
    else {
      const items = await deps.listItems(input.workspaceId)
      items.slice(0, 10).forEach(item => add(item.id, 'blocked', disabledMessage))
    }
  } else {
    try { await deps.reevaluate(input.workspaceId) } catch {
      // An unavailable review source must never permit publication.
      const items = ids ?? (await deps.listItems(input.workspaceId)).slice(0, 10).map(item => item.id)
      items.forEach(id => add(id, 'blocked', blockedMessage))
      return { results, published: 0, blocked: results.length, failed: 0, needs_check: 0 }
    }
    const loaded = await deps.listItems(input.workspaceId, ids)
    const items = ids ? ids.map(id => loaded.find(item => item.id === id)) : loaded.slice(0, 10)
    for (const entry of items) {
      if (!entry || entry.workspaceId !== input.workspaceId || entry.deletedAt) {
        add(entry?.id ?? ids?.[results.length] ?? '', 'blocked', '보관 항목을 찾을 수 없어요')
        continue
      }
      const item = entry
      if (!isMeta(item.channel)) { add(item.id, 'skipped_preview_only', previewMessage); continue }
      if (item.releaseGate !== 'RELEASE_REQUESTED' || item.approvalState !== 'APPROVED') {
        add(item.id, 'blocked', '발행 요청 상태를 다시 확인해 주세요'); continue
      }
      let claimed = false
      let sent = false
      try {
        claimed = await deps.claim(input.workspaceId, item.id)
        if (!claimed) { add(item.id, 'blocked', '보관 상태가 변경됐어요. 다시 확인해 주세요'); continue }
        const verdict = await deps.preflight(input.workspaceId, item.id, input.actorId, input.now)
        if (!verdict.canRelease || verdict.overall !== 'PASS') {
          const connection = verdict.items.find(check => check.code === 'CONNECTION' && check.status !== 'PASS')
          const account = verdict.items.find(check => check.code === 'ACCOUNT' && check.status !== 'PASS')
          const reason = account ? 'REAPPROVAL_REQUIRED' : connection ? 'CHANNEL_NOT_CONNECTED' : 'USER_HELD'
          await deps.hold(input.workspaceId, item.id, reason, connection && !account ? 'HELD_CONNECTION_PENDING' : 'HELD_USER')
          add(item.id, 'blocked', verdict.blockedReasons[0] ?? blockedMessage)
          continue
        }
        sent = true
        const outcome = await deps.publish(item, input.actorId)
        if (outcome.success && outcome.verified && outcome.stage === 'EXTERNAL_VERIFIED' && outcome.publishedUrl) {
          await deps.recordPublished(item, input.actorId, outcome.publishedUrl)
          await deps.complete(input.workspaceId, item.id)
          add(item.id, 'published', '게시 완료')
        } else if (outcome.stage === 'RESULT_UNKNOWN' || outcome.stage === 'VERIFYING' || (outcome.success && !outcome.verified)) {
          await deps.hold(input.workspaceId, item.id, 'USER_HELD', 'HELD_USER')
          await deps.recordEvent(item, input.actorId, 'vault.publish_uncertain', checkMessage)
          add(item.id, 'needs_check', checkMessage)
        } else {
          await deps.hold(input.workspaceId, item.id, 'USER_HELD', 'HELD_USER')
          await deps.recordEvent(item, input.actorId, 'vault.publish_failed', failedMessage)
          add(item.id, 'failed', failedMessage)
        }
      } catch {
        if (claimed) {
          try {
            await deps.hold(input.workspaceId, item.id, 'USER_HELD', 'HELD_USER')
            await deps.recordEvent(item, input.actorId, sent ? 'vault.publish_uncertain' : 'vault.publish_failed', sent ? checkMessage : failedMessage)
          } catch { /* Claim remains non-requested; operator reconciliation is required. */ }
        }
        add(item.id, sent ? 'needs_check' : 'failed', sent ? checkMessage : failedMessage)
      }
    }
  }
  return { results, published: results.filter(r => r.status === 'published').length, blocked: results.filter(r => r.status === 'blocked' || r.status === 'skipped_preview_only').length, failed: results.filter(r => r.status === 'failed').length, needs_check: results.filter(r => r.status === 'needs_check').length }
}
