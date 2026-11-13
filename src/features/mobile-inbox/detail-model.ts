import { replyPath, type InboxThreadDto, type ReplyPath } from './inbox-model'

export type DeliveryState = 'none' | 'accepted' | 'verified' | 'unknown'

/**
 * 경로 세그먼트가 인코딩된 채로 올 수 있다(`dm%3A…`). 잘못된 이스케이프는 원문 그대로 둔다.
 * 여기서 던지면 500 이 되고, 400(잘못된 키)이어야 할 요청이 조회 실패로 보인다.
 */
export function safeDecodeThreadKey(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export interface ThreadMessageDto {
  id: string
  fromCustomer: boolean
  text: string
  at: string
}

/**
 * 대화 상세 DTO. fingerprint 는 서버가 (대상 계정·고객·원문·제안 문안)에서 계산해 내려준다.
 * 화면은 값을 만들지 않고 '열었을 때 값'과 '지금 서버 값'이 같은지만 비교한다. 사용자에게는 노출하지 않는다.
 */
export interface ConversationDetailDto {
  thread: InboxThreadDto
  messages: ThreadMessageDto[]
  /** 보낼 대상(계정/고객) 확인용 문구. */
  targetLabel: string | null
  fingerprint: string | null
  version: number
  /** Server-issued exact timestamp token; never generated from the client clock. */
  draftUpdatedAt?: string | null
  delivery: DeliveryState
  /**
   * 서버가 이 대화의 원문을 빠짐없이 읽었는지. 절단(200건 초과)·글자 없는 행 건너뛰기가 있으면 false.
   * false 를 '대화 없음'이나 '완전한 대화'로 그리지 않는다 — 화면은 '일부만'으로 알린다.
   */
  complete: boolean
}

export type ReviewBlock =
  | 'NO_DRAFT' | 'NO_TARGET' | 'NO_FINGERPRINT' | 'CHANGED' | 'SEND_BLOCKED' | 'ALREADY_SENT' | 'NO_SOURCE'

export const REVIEW_BLOCK_LABEL: Record<ReviewBlock, string> = {
  NO_DRAFT: '소희 답안이 아직 없어요',
  NO_TARGET: '보낼 대상을 확인하지 못했어요',
  NO_FINGERPRINT: '답안 확인 정보가 없어 진행할 수 없어요',
  CHANGED: '고객이나 답안 내용이 바뀌었어요. 다시 확인해 주세요',
  SEND_BLOCKED: '지금은 보낼 수 없어요',
  ALREADY_SENT: '이미 보낸 답장이에요',
  NO_SOURCE: '아직 확인 중이에요',
}

export interface ReviewGate {
  canProceed: boolean
  block: ReviewBlock | null
  path: ReplyPath
  message: string | null
}

/**
 * '최종 검토로 넘어가기' 가능 여부. 이 단계는 발송이 아니라 최종 검토 화면(승인 게이트)으로의 이동뿐이다.
 * `openedFingerprint` 는 사용자가 화면을 열었을 때 서버가 준 값. 달라졌다면 재검토(409 상당)로 막는다.
 */
export function reviewGate(detail: ConversationDetailDto, openedFingerprint: string | null): ReviewGate {
  const path = replyPath(detail.thread)
  const fail = (block: ReviewBlock, message?: string): ReviewGate => ({
    canProceed: false, block, path, message: message ?? REVIEW_BLOCK_LABEL[block],
  })
  if (detail.delivery === 'verified' || detail.delivery === 'accepted') return fail('ALREADY_SENT')
  if (!detail.thread.draft) return fail('NO_DRAFT')
  if (!detail.targetLabel) return fail('NO_TARGET')
  if (!detail.fingerprint || !openedFingerprint) return fail('NO_FINGERPRINT')
  if (detail.fingerprint !== openedFingerprint) return fail('CHANGED')
  if (path.kind !== 'review') return fail('SEND_BLOCKED', path.reason ?? undefined)
  if (detail.thread.draft.sources.length === 0) return fail('NO_SOURCE')
  return { canProceed: true, block: null, path, message: null }
}

/** 보냈다는 말은 플랫폼 readback 으로 확인된 경우에만 쓴다. */
export function deliveryChip(state: DeliveryState): { label: string; tone: 'ok' | 'pending' | 'warn' | 'neutral' } {
  switch (state) {
    case 'verified': return { label: '전달 확인됨', tone: 'ok' }
    case 'accepted': return { label: '전송 접수됨 · 도착 확인 전', tone: 'pending' }
    case 'unknown': return { label: '전달 여부를 확인하지 못했어요', tone: 'warn' }
    default: return { label: '아직 보내지 않았어요', tone: 'neutral' }
  }
}
