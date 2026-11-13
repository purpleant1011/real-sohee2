import type { ConversationDetailDto, DeliveryState } from './detail-model'

const DELIVERY: readonly DeliveryState[] = ['none', 'accepted', 'verified', 'unknown']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * 서버가 내려준 상세 계약을 그대로 확인한다. 어긋나면 '대화 없음'이 아니라 실패로 다룬다.
 * 다른 가게(workspaceId 불일치)·다른 스레드 응답은 그리지 않는다.
 */
export function isConversationDetail(
  value: unknown,
  workspaceId: string,
  threadKey: string,
): value is ConversationDetailDto {
  if (!isRecord(value)) return false
  const thread = value.thread
  if (!isRecord(thread)) return false
  if (thread.id !== threadKey || thread.workspaceId !== workspaceId) return false
  if (typeof thread.customerName !== 'string' || typeof thread.channel !== 'string') return false
  if (!Array.isArray(thread.sendBlockers)) return false
  const draft = thread.draft
  const draftOk =
    draft === null ||
    (isRecord(draft) && typeof draft.text === 'string' && Array.isArray(draft.sources))
  if (!draftOk) return false
  if (!Array.isArray(value.messages)) return false
  if (
    !value.messages.every(
      (m) =>
        isRecord(m) &&
        typeof m.id === 'string' &&
        typeof m.fromCustomer === 'boolean' &&
        typeof m.text === 'string' &&
        typeof m.at === 'string',
    )
  ) {
    return false
  }
  if (!DELIVERY.includes(value.delivery as DeliveryState)) return false
  if (typeof value.version !== 'number') return false
  // 절단 여부는 계약의 일부다. 없으면 '완전한 대화'로 단정하지 않고 실패로 둔다.
  if (typeof value.complete !== 'boolean') return false
  if (value.fingerprint !== null && typeof value.fingerprint !== 'string') return false
  if (value.targetLabel !== null && typeof value.targetLabel !== 'string') return false
  return true
}
