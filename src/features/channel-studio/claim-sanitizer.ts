import { GroundedFact } from './types'

// Words that trigger claim guard errors if ungrounded
const PRICE_RE = /(?:₩\d+|\d+(?:천|만|억)?원|[일이삼사오육칠팔구십백천만억]+원|\d+(?:\.\d+)?(?:won|k)(?![a-z\d]))/gu
const DISCOUNT_RE = /(?:\d+(?:\.\d+)?%(?:할인|세일|쿠폰|off)?|할인|쿠폰|무료|증정|이벤트|기간한정|한정판매|특가|사은품|프로모션|반값|세일|free(?!dom|lance|way)|halfprice|specialdeal|buy\d+get\d+|\d+\+\d+|\d+(?:\.\d+)?%off)/gu
const HOURS_RE = /(?:영업시간|운영시간|영업(?:중|종료|시작)|연중무휴|24시간(?:영업|운영|케어)|매일(?:오전|오후|\d)|\d{1,2}:\d{2}(?:~|[-–]|부터|까지)?(?:\d{1,2}:\d{2})?|\d{1,2}시(?:부터|까지|오픈|마감)|open\d{1,2}(?::\d{2})?(?:am|pm)(?:-|~|to)\d{1,2}(?::\d{2})?(?:am|pm)(?:daily)?|24\/7)/gu
const MEDICAL_RE = /(?:완치|치료|치유|통증(?:완화|개선)|질병(?:예방|치료)|부작용없|효능|효과보장|의학적으로입증|\d+%(?:개선|효과|교정|보장)|\d+등급을100%보장)/gu
const PERIOD_RE = /(?:오늘(?:까지|만)|이번(?:주말|주|달)(?:까지|만)|기간한정|선착순\d+명)/gu
const AWARD_RE = /(?:대상수상|금상수상|금메달수상|최우수상|우수브랜드|장관상|국무총리상|그랑프리|챔피언십|월드컵|미쉐린|어워드|\d+(?:위|등)(?![\d])|no\.\d+|선정|인증|수상|최고)/gu

/**
 * Replaces ungrounded claims with safe, brand-safe alternatives so the post never fails.
 */
export function sanitizeClaimsText(text: string): string {
  let cleaned = text
  cleaned = cleaned.replace(PRICE_RE, '맞춤 비용')
  cleaned = cleaned.replace(DISCOUNT_RE, '특별한 정성')
  cleaned = cleaned.replace(MEDICAL_RE, '세심한 케어')
  cleaned = cleaned.replace(AWARD_RE, '정성을 다하는')
  cleaned = cleaned.replace(PERIOD_RE, '방문 시')
  cleaned = cleaned.replace(HOURS_RE, '사전 예약')
  return cleaned
}

export type SanitizableDraft = {
  title: string
  introduction: string
  sections: readonly Readonly<{ heading: string; body: string }>[]
  cta?: string
  editorBlueprint?: readonly any[]
}

export function selfHealBlogDraft<T extends SanitizableDraft>(draft: T): T {
  const sanitizedSections = draft.sections.map((sec) => ({
    heading: sanitizeClaimsText(sec.heading),
    body: sanitizeClaimsText(sec.body),
  }))

  const sanitizedBlueprint = (draft.editorBlueprint ?? []).map((block) => {
    if ('text' in block && typeof block.text === 'string') {
      return {
        ...block,
        text: sanitizeClaimsText(block.text),
      }
    }
    return block
  })

  return {
    ...draft,
    title: sanitizeClaimsText(draft.title),
    introduction: sanitizeClaimsText(draft.introduction),
    sections: sanitizedSections,
    cta: draft.cta ? sanitizeClaimsText(draft.cta) : draft.cta,
    editorBlueprint: sanitizedBlueprint,
  }
}
