import { parseConversationImageRequest } from './conversation-image-intent'
import { parseConversationPostRequest } from './conversation-post-intent'

export function isConversationAgentRuntimeEnabled(workspaceId: string, env: Record<string, string | undefined> = process.env): boolean {
  if (!workspaceId || env.CONVERSATION_AGENT_RUNTIME_ENABLED !== '1') return false
  if (env.CONVERSATION_AGENT_RUNTIME_ROLLOUT === 'all') return true
  const allowed = (env.CONVERSATION_AGENT_RUNTIME_WORKSPACE_ALLOWLIST ?? '').split(',').map(id => id.trim()).filter(Boolean)
  return !allowed.includes('*') && allowed.includes(workspaceId)
}

function isExplicitReadFollowUp(message: string): boolean {
  return /그\s*(?:자료|내용|거|것)|방금|이어서/u.test(message) && /확인|조회|근거|자세히|다시/u.test(message)
    && !/보내|발송|게시|수정|삭제|승인|결제|환불|생성|작성/u.test(message)
}

export function getPreparedConversationReadRequirements(message: string, previousUserMessage?: string): readonly string[] {
  const text = message.replace(/\s+/gu, '')
  const reads: string[] = []
  const automationExcluded = /(?:자동화|루틴)(?:설정)?(?:은|는|을|를)?(?:절대)?(?:조회하지|확인하지|읽지|보지)/u.test(text)
  if (!automationExcluded && /자동화|루틴/u.test(text) && /조회|확인|설정|목록|내역|알려/u.test(text)) reads.push('automation.list')
  const ledger = /예약장부|예약내역|예약현황|등록된예약|확정된예약|예약.{0,4}(?:몇|건수|일정)/u.test(text)
  const bookingRead = /예약(?!금|문의)/u.test(text) && /조회|확인|등록된건수|있는지/u.test(text)
  const inquiryOnly = /예약(?:문의|상담)/u.test(text) && !ledger
  const bookingExcluded = /예약(?:장부|내역|현황)?(?:은|는|을|를)?(?:절대)?(?:조회하지|확인하지|읽지|보지)/u.test(text)
  if (!bookingExcluded && (ledger || (bookingRead && !inquiryOnly))) reads.push('reservation.list')
  const inboxExcluded = /(?:댓글|DM|디엠)(?:은|는|을|를)?(?:절대)?(?:조회하지|확인하지|읽지|보지)/iu.test(text)
  if (!inboxExcluded && /댓글|DM|디엠|수신|받은문의/iu.test(text) && /조회|확인|받은|목록|내역|응답|답변|초안/u.test(text)) reads.push('interaction.list')
  if (!reads.length && !bookingExcluded && !inboxExcluded && !automationExcluded && previousUserMessage && isExplicitReadFollowUp(message)) return getPreparedConversationReadRequirements(previousUserMessage)
  return reads
}

export function requestsConversationInteractionDraft(message: string): boolean {
  return /댓글|답글|DM|디엠|답변|답장/iu.test(message)
    && /초안/u.test(message)
    && /제안해|준비해|작성해|만들어/u.test(message)
    && !/초안.{0,20}(?:작성하지|생성하지|준비하지|만들지|저장하지)/u.test(message)
}

export function requestsConversationKnowledgeProposal(message: string): boolean {
  return /기억해|기억해둬|기억해\s*둬|지식.{0,10}(?:저장해|등록해)|운영\s*규칙.{0,10}(?:제안해|저장해)/u.test(message)
    && !/기억하지|저장하지|등록하지|기억해.{0,5}(?:말|않)/u.test(message)
}

export const TEACH_CONVERSATION_MARKERS = [
  '저장하기 전에',
  '가르쳐주고 싶어',
  '가르치고 싶어',
  '소희 가르치기',
  '승인하기 전까지는 어떤 정보도 저장되지 않으니',
  '확인한 사실을 먼저 되짚어서',
  '한 번에 하나씩 차근차근 질문',
  '궁금한 것부터 하나씩 질문',
] as const

export function isTeachConversationMarker(text?: string | null): boolean {
  if (!text) return false
  if (TEACH_CONVERSATION_MARKERS.some(marker => text.includes(marker))) return true
  return /(?:저장하기\s*전에|가르쳐\s*주고\s*싶어|가르치고\s*싶어|소희\s*가르치기|하나씩\s*(?:차근차근\s*)?질문)/u.test(text)
}

export type ConversationMessageLike = {
  role?: string
  content?: string | null
}

export type PreparedConversationRoutingOptions = Readonly<{
  recentMessages?: readonly ConversationMessageLike[]
  teachingActive?: boolean
}>

/** 가르치기 시작 문구(허브·주제 칩이 만든 사용자 메시지)만 연속성의 시작점으로 본다. 소희 답변의 흔한 문구는 제외. */
function isTeachStarter(text?: string | null): boolean {
  return Boolean(text) && /승인하기\s*전까지는\s*어떤\s*정보도\s*저장되지\s*않|가르치고\s*싶어.{0,30}(?:질문해줘|물어봐줘)|가르쳐주고\s*싶어.{0,60}질문해줘/u.test(text as string)
}

const TEACHING_LOOKBACK = 8

export function hasActiveTeachingInterview(
  recentMessages?: readonly ConversationMessageLike[] | null,
  previousUserMessage?: string,
): boolean {
  if (previousUserMessage && isTeachStarter(previousUserMessage)) return true
  if (!recentMessages || recentMessages.length === 0) return false
  const window = recentMessages.slice(-TEACHING_LOOKBACK)
  for (let i = window.length - 1; i >= 0; i--) {
    const msg = window[i]
    if (!msg?.content || msg.role !== 'user') continue
    if (parseConversationPostRequest(msg.content) || parseConversationImageRequest(msg.content)) return false
    if (isTeachStarter(msg.content)) return true
  }
  return false
}

/** Keep existing creation/recovery owners; business reads and grounded planning use the shared loop. */
export function shouldUsePreparedConversationAgent(
  message: string,
  previousUserMessage?: string,
  options?: PreparedConversationRoutingOptions | readonly ConversationMessageLike[] | boolean,
): boolean {
  if (parseConversationPostRequest(message) || parseConversationImageRequest(message)) return false
  if (/(?:예약|문의)/u.test(message) && /(?:회수|회복|복구)/u.test(message)) return false
  if (requestsConversationKnowledgeProposal(message)) return true
  if (isTeachConversationMarker(message)) return true

  let recentMessages: readonly ConversationMessageLike[] | undefined
  let teachingExplicit: boolean | undefined
  if (Array.isArray(options)) {
    recentMessages = options
  } else if (typeof options === 'boolean') {
    teachingExplicit = options
  } else if (options && typeof options === 'object') {
    recentMessages = 'recentMessages' in options ? options.recentMessages : undefined
    teachingExplicit = 'teachingActive' in options ? options.teachingActive : undefined
  }

  if (teachingExplicit || hasActiveTeachingInterview(recentMessages, previousUserMessage)) {
    return true
  }

  if (previousUserMessage && isExplicitReadFollowUp(message) && shouldUsePreparedConversationAgent(previousUserMessage)) return true
  return /(?:고객|문의|댓글|답글|답장|응대|DM|디엠|예약|지식|가게\s*정보|우리\s*(?:가게|매장)|사업장|브랜드|프로모션|기획|계획|성과|보고|자동화|루틴|매출|크레딧|잔액|홍보|게시|발송|전송)/iu.test(message)
}
