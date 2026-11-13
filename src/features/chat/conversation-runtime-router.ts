export type ConversationCapabilityId =
  | 'credit.status'
  | 'interaction.list'
  | 'reservation.list'
  | 'knowledge.search'

export type ConversationRuntimeDecision =
  | Readonly<{ kind: 'answer' | 'existing_flow' }>
  | Readonly<{
      kind: 'capability'
      capabilityId: ConversationCapabilityId
      allowedCapabilityIds: readonly string[]
    }>

export const CONVERSATION_CAPABILITY_ALLOWED_MAP: Record<ConversationCapabilityId, readonly string[]> = {
  'credit.status': ['credit.status'],
  'interaction.list': ['interaction.list', 'comment.reply_draft', 'dm.reply_draft'],
  'reservation.list': ['reservation.list', 'customer.search'],
  'knowledge.search': ['knowledge.search'],
}

/** First rollout is a deterministic read, not permission to execute natural-language writes. */
export function routeConversationRequest(message: string): ConversationRuntimeDecision {
  if (/(?:만들|생성|작성|써\s*줘|게시|발행|보내|수정|바꿔|변경|편집|고쳐|줄여|짧게|다듬|삭제|복원|승인|결제|환불|취소|중지|회수|예약\s*확정)/u.test(message)) return { kind: 'existing_flow' }
  if (/(?:크레딧|잔액)/u.test(message) && /(?:조회|확인|알려|얼마|남[은았]|잔여)/u.test(message)) {
    return { kind: 'capability', capabilityId: 'credit.status', allowedCapabilityIds: CONVERSATION_CAPABILITY_ALLOWED_MAP['credit.status'] }
  }
  if (/(?:인스타\s*댓글|댓글|디엠|DM|수신(?:된)?\s*DM|소통|피드백)/ui.test(message) && /(?:확인|알려|조회|제안|문의|답변)/ui.test(message)) {
    return { kind: 'capability', capabilityId: 'interaction.list', allowedCapabilityIds: CONVERSATION_CAPABILITY_ALLOWED_MAP['interaction.list'] }
  }
  if (/(?:예약\s*장부|예약\s*일정|예약\s*현황|예약\s*내역)/ui.test(message) || (/(?:예약)/ui.test(message) && /(?:장부|일정|현황|내역|확인|알려|조회)/ui.test(message))) {
    return { kind: 'capability', capabilityId: 'reservation.list', allowedCapabilityIds: CONVERSATION_CAPABILITY_ALLOWED_MAP['reservation.list'] }
  }
  if (/(?:가게\s*지식|매장\s*운영\s*정보|가게\s*운영\s*정보|매장\s*지식)/ui.test(message) || (/(?:가게|매장)/ui.test(message) && /(?:지식|운영\s*정보)/ui.test(message))) {
    return { kind: 'capability', capabilityId: 'knowledge.search', allowedCapabilityIds: CONVERSATION_CAPABILITY_ALLOWED_MAP['knowledge.search'] }
  }
  return { kind: 'answer' }
}

export function conversationReadRuntimeEnabled(flag: string | undefined, raw: string | undefined, workspaceId: string): boolean {
  if (!workspaceId) return false
  if (flag === 'all') return true
  const allowed = (raw ?? '').split(',').map(id => id.trim()).filter(Boolean)
  return flag === '1' && Boolean(workspaceId) && !allowed.includes('*') && allowed.includes(workspaceId)
}
