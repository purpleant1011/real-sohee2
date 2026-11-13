import crypto from 'node:crypto'
import type { GroundedBusinessContext, GroundedFact } from '@/features/channel-studio/types'
import type { InstagramDmDirectionOption } from './types'

import { DM_POLICY_WINDOW_HOURS, DM_MAX_TEXT_LENGTH, DM_EXPIRED_KOREAN_MESSAGE } from './constants'

export { DM_POLICY_WINDOW_HOURS, DM_MAX_TEXT_LENGTH, DM_EXPIRED_KOREAN_MESSAGE }

const PRICE_FACT_PATTERNS = [/가격/i, /메뉴/i, /비용/i, /단가/i, /금액/i]
const HOURS_FACT_PATTERNS = [/영업/i, /운영/i, /시간/i, /휴무/i, /라스트오더/i, /브레이크타임/i]
const PARKING_LOCATION_FACT_PATTERNS = [/주차/i, /위치/i, /오시는길/i, /주소/i, /길찾기/i, /발렛/i]
const RESERVATION_FACT_PATTERNS = [/예약/i, /룸/i, /콜키지/i, /테이블/i, /이용안내/i, /규정/i, /FAQ/i, /자주 묻는 질문/i]

/**
 * Searches grounded facts for a fact matching any of the specified regex patterns.
 */
export function findMatchingFact(
  facts: GroundedFact[] | undefined,
  patterns: RegExp[]
): GroundedFact | undefined {
  if (!facts || facts.length === 0) return undefined
  return facts.find((fact) => {
    const label = fact.label || ''
    const value = fact.value || ''
    return patterns.some((pattern) => pattern.test(label) || pattern.test(value))
  })
}

/**
 * Computes sha256(workspaceId:threadId:finalDraftText) for DM draft approval binding.
 */
export function computeDmApprovalFingerprint(
  workspaceId: string,
  threadId: string,
  draftText: string
): string {
  return crypto
    .createHash('sha256')
    .update(`${workspaceId}:${threadId}:${draftText}`, 'utf8')
    .digest('hex')
}

/**
 * Checks whether a DM thread has passed the 24-hour response window.
 */
export function checkIsDmExpired(
  expiresAt: string | Date,
  now: Date = new Date()
): boolean {
  const expiryTime = new Date(expiresAt).getTime()
  if (Number.isNaN(expiryTime)) return true
  return now.getTime() >= expiryTime
}

/**
 * Returns remaining time and Korean countdown label for 24-hour DM window.
 */
export function getDmCountdownInfo(
  expiresAt: string | Date,
  now: Date = new Date()
): { isExpired: boolean; remainingSeconds: number; label: string } {
  const expiryTime = new Date(expiresAt).getTime()
  if (Number.isNaN(expiryTime)) {
    return { isExpired: true, remainingSeconds: 0, label: '만료됨' }
  }

  const diffMs = expiryTime - now.getTime()
  if (diffMs <= 0) {
    return { isExpired: true, remainingSeconds: 0, label: '만료됨' }
  }

  const remainingSeconds = Math.floor(diffMs / 1000)
  const remainingHours = Math.floor(remainingSeconds / 3600)
  const remainingMinutes = Math.floor((remainingSeconds % 3600) / 60)

  let label: string
  if (remainingHours > 0) {
    label = `${remainingHours}시간 남음`
  } else if (remainingMinutes > 0) {
    label = `${remainingMinutes}분 남음`
  } else {
    label = '1분 미만 남음'
  }

  return {
    isExpired: false,
    remainingSeconds,
    label,
  }
}

/**
 * Sanitizes customer input to prevent prompt injection and delimit input data safely.
 */
export function sanitizeCustomerDmInput(rawText: string): string {
  return rawText
    .replace(/<\/customer_message>/gi, '')
    .replace(/<customer_message>/gi, '')
    .trim()
}

/**
 * Sanitizes drafted DM reply text for Instagram policy.
 */
export function sanitizeDmReplyText(text: string): string {
  let cleaned = text
    .replace(/https?:\/\/[^\s]+/gi, '')
    .replace(/www\.[^\s]+/gi, '')
    .replace(/@[A-Za-z0-9._-]+/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim()

  if (cleaned.length > DM_MAX_TEXT_LENGTH) {
    cleaned = cleaned.slice(0, DM_MAX_TEXT_LENGTH).trim()
  }

  return cleaned
}

export interface GenerateDmOptionsParams {
  customerMessage: string
  customerHandle?: string
  context?: Partial<GroundedBusinessContext> | null
}

/**
 * Generates 2~3 distinct reply directions and full Korean draft texts.
 * Pure function: deterministic, prompt-injection guarded, Korean-only copy.
 */
export function generateDmDirectionOptions(
  params: GenerateDmOptionsParams
): InstagramDmDirectionOption[] {
  const sanitizedInput = sanitizeCustomerDmInput(params.customerMessage || '')
  const businessName = params.context?.businessName?.trim() || '저희 매장'
  const location = params.context?.location?.trim()
  const industry = params.context?.industry?.trim()

  const hasPriceQuery = /가격|얼마|비용|단가|금액/i.test(sanitizedInput)
  const hasDurationQuery = /시간|소요|얼마나/i.test(sanitizedInput)
  const hasScheduleMention = /\d+월|\d+일|오늘|내일|주말|토요일|일요일|오후|오전|\d+시/i.test(sanitizedInput)
  const hasParkingLocationQuery = /주차|위치|오시는길|어디|주소|길찾기/i.test(sanitizedInput)
  const hasReservationQuery = /예약|룸|콜키지|테이블/i.test(sanitizedInput)

  let factSentence = ''
  if (hasPriceQuery) {
    const matchedFact = findMatchingFact(params.context?.facts, PRICE_FACT_PATTERNS)
    if (matchedFact) {
      factSentence = ` 저희 매장의 가격 및 메뉴는 ${matchedFact.value}으로 안내해 드리고 있어요.`
    }
  }

  if (!factSentence && hasParkingLocationQuery) {
    const matchedFact = findMatchingFact(params.context?.facts, PARKING_LOCATION_FACT_PATTERNS)
    if (matchedFact) {
      factSentence = ` 저희 영업시간 및 주차 안내는 ${matchedFact.value}을 참고해 주시면 감사하겠습니다.`
    }
  }

  if (!factSentence && (hasDurationQuery || hasScheduleMention)) {
    const matchedFact = findMatchingFact(params.context?.facts, HOURS_FACT_PATTERNS)
    if (matchedFact) {
      factSentence = ` 저희 영업시간 및 주차 안내는 ${matchedFact.value}을 참고해 주시면 감사하겠습니다.`
    }
  }

  if (!factSentence && hasReservationQuery) {
    const matchedFact = findMatchingFact(params.context?.facts, RESERVATION_FACT_PATTERNS)
    if (matchedFact) {
      factSentence = ` 저희 매장 예약 및 이용 안내는 ${matchedFact.value}을 참고해 주시면 감사하겠습니다.`
    }
  }

  // Direction 1: 방문 및 예약 안내
  const scheduleText = hasScheduleMention
    ? '말씀해 주신 일정으로 방문 및 예약 안내 도와드릴게요.'
    : '말씀해 주신 내용 확인하였으며, 편하신 일정으로 방문 및 예약 안내 도와드릴게요.'
  const draft1 = sanitizeDmReplyText(
    `안녕하세요! ${businessName}을 찾아주셔서 진심으로 감사드려요.${factSentence} ${scheduleText} 원하시는 날짜와 시간대를 남겨주시면 확인 후 빠르게 안내해 드리겠습니다.`
  )

  // Direction 2: 영업시간 및 위치 안내 (가격 및 시간 문의 시 맞춤 안내 문구 반영)
  const locationSentence = location ? ` 위치는 ${location}에 위치해 있습니다.` : ''
  let draft2 = ''
  if (hasPriceQuery || hasDurationQuery) {
    draft2 = sanitizeDmReplyText(
      `안녕하세요! ${businessName}입니다. 문의해 주신 소요 시간과 가격 및 운영 시간 안내 도와드릴게요.${factSentence}${locationSentence} 시술은 고객님 맞춤으로 정성껏 진행되며, 상세한 비용과 일정 확인 도와드리겠습니다. 궁금하신 점 편하게 말씀해 주세요.`
    )
  } else {
    draft2 = sanitizeDmReplyText(
      `안녕하세요! ${businessName}입니다. 문의해 주셔서 감사드려요. 운영 시간과 위치 안내 도와드릴게요.${factSentence}${locationSentence} 매장 방문 시 더 편안하게 이용하실 수 있도록 정성을 다해 준비해 두겠습니다. 궁금한 점이 있으시면 편하게 말씀해 주세요.`
    )
  }

  // Direction 3: 상세 유선 상담 안내
  const draft3 = sanitizeDmReplyText(
    `안녕하세요! ${businessName}입니다. 문의 남겨주셔서 감사드립니다.${factSentence} 남겨주신 내용에 대해 더 정확하고 상세한 상담을 도와드리고자 해요. 매장 영업시간 중 언제든 편하게 유선으로 문의해 주시면 친절하고 꼼꼼하게 안내해 드리겠습니다.`
  )

  return [
    {
      id: 'opt_reservation',
      label: '방문 및 예약 안내',
      draftText: draft1,
    },
    {
      id: 'opt_hours_location',
      label: hasPriceQuery || hasDurationQuery ? '영업시간 및 가격·소요시간 안내' : '영업시간 및 위치 안내',
      draftText: draft2,
    },
    {
      id: 'opt_consultation',
      label: '상세 유선 상담 안내',
      draftText: draft3,
    },
  ]
}
