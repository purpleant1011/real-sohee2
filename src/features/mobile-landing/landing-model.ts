import type { LoadState } from '@/features/mobile-decision/contracts'

/** 첫 CTA 목적지. 가입 후 첫 만남 흐름(/start)으로 돌아온다. */
export const LANDING_SIGNUP_HREF = '/signup?next=/start'

/**
 * 선택한 업종 예시를 가입 이후 흐름에서 재사용하도록 쿼리로 싣는다.
 * 알려진 예시 키가 아니면 기본 주소를 그대로 쓴다.
 */
export function landingSignupHref(selectedKey: string | null, examples: readonly IndustryExample[] | null): string {
  if (!selectedKey || !examples?.some(e => e.key === selectedKey)) return LANDING_SIGNUP_HREF
  return `${LANDING_SIGNUP_HREF}&industry=${encodeURIComponent(selectedKey)}`
}

/**
 * 업종별 예시. 실제 고객 사례·성과 수치가 아니라 "이런 일을 도와드려요" 설명용 예시다.
 * 숫자(매출·증가율·후기)는 담지 않는다.
 */
export interface IndustryExample {
  key: string
  industry: string
  /** 사장님이 맡기는 일 한 줄. */
  task: string
  /** 소희가 준비하는 결과물 한 줄. 외부 게시 완료를 암시하지 않는다. */
  draft: string
}

export interface LandingViewSnapshot {
  loadState: LoadState
  examples: readonly IndustryExample[] | null
  checkedAt: string | null
}

export const LANDING_EXAMPLES: readonly IndustryExample[] = [
  {
    key: 'beauty',
    industry: '뷰티',
    task: '이번 주 신규 시술 사진을 홍보하고 싶어요',
    draft: '사진에 맞는 소개 글과 해시태그 초안',
  },
  {
    key: 'cafe',
    industry: '카페·식당',
    task: '새 메뉴를 알리고 싶어요',
    draft: '메뉴 소개 문구와 올릴 채널별 글 초안',
  },
  {
    key: 'fitness',
    industry: '운동·교습',
    task: '신규 수강생을 모집하고 싶어요',
    draft: '수업 안내 글과 문의 답변 초안',
  },
  {
    key: 'shop',
    industry: '소매·공방',
    task: '새로 들어온 상품을 소개하고 싶어요',
    draft: '상품 설명과 안내 문구 초안',
  },
]

export type LandingExamplesKind = 'loading' | 'error' | 'partial' | 'stale' | 'ready'

/**
 * 예시 영역 상태 판정. 첫 CTA는 예시 조회와 무관하게 항상 보인다(가입을 막지 않는다).
 * 조회 실패·형식 불일치는 error — 빈 예시로 위장하지 않는다. 목록이 비어 있으면 partial.
 */
export function resolveLandingExamples(snapshot: LandingViewSnapshot): LandingExamplesKind {
  if (snapshot.loadState === 'loading') return 'loading'
  if (snapshot.loadState === 'error' || snapshot.loadState === 'unknown') return 'error'
  if (!snapshot.examples || snapshot.examples.length === 0) return 'partial'
  return snapshot.loadState === 'stale' ? 'stale' : 'ready'
}
