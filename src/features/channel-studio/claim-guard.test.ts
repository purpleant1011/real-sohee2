import { describe, expect, it } from 'vitest'
import { checkBusinessClaims } from './claim-guard'
import type { GroundedBusinessContext } from './types'

const context = (facts: GroundedBusinessContext['facts'] = []): GroundedBusinessContext => ({
  businessName: '작은 카페', industry: '카페', location: '망원동', facts,
  tone: { presetKey: null, brandVoice: '' }, knowledgeVersion: 1, warnings: [],
})

describe('business claims guard', () => {
  it('blocks invented coupons and prices without confirmed evidence', () => {
    expect(checkBusinessClaims('daangn_business', { coupon: '첫 방문 10% 할인 쿠폰', text: '아메리카노 1,000원' }, context([
      { kind: 'offering', label: '메뉴', value: '아메리카노' },
    ]))).toMatchObject({ status: 'UNKNOWN' })
    expect(checkBusinessClaims('threads', { text: '커피 5,000원' }, context()).issues).toContain('확인된 가격 정보가 없어 가격 문구를 사용할 수 없어요.')
  })

  it('accepts the same verified benefit but not a different discount amount', () => {
    const ctx = context([{ kind: 'offering', label: '첫 방문 혜택', value: '첫 방문 10% 할인 쿠폰' }])
    expect(checkBusinessClaims('daangn_business', { coupon: '첫 방문 10% 할인 쿠폰' }, ctx)).toEqual({ status: 'OK', issues: [] })
    expect(checkBusinessClaims('daangn_business', { coupon: '첫 방문 20% 할인 쿠폰' }, ctx).status).toBe('UNKNOWN')
  })

  it('blocks unsupported awards, rankings, certifications, inflected prices and round-the-clock claims', () => {
    for (const text of [
      '2024 전국 대회 대상 수상', '미쉐린 가이드 선정 맛집', '소비자 만족도 1위 인증',
      '아메리카노 1,000원에 판매', '염색 3만 원에 시술', '연중무휴 24시간 영업합니다',
    ]) expect(checkBusinessClaims('threads', { text }, context()).status, text).toBe('UNKNOWN')
  })

  it('allows verified hours even when marketing wording adds an ordinary verb', () => {
    const ctx = context([{ kind: 'profile', label: '운영시간', value: '화-일 11:00~20:00 영업 (매주 월요일 정기휴무)' }])
    expect(checkBusinessClaims('threads', { text: '화-일 11:00~20:00 영업합니다.' }, ctx).status).toBe('OK')
  })

  it('checks nested strings (including hashtags), hour assertions and medical guarantees', () => {
    const payload = {
      blocks: [{ text: '매일 09:00~20:00 영업, 통증을 완치합니다' }], hashtags: ['#무료증정'],
    }
    const result = checkBusinessClaims('naver_blog', payload, context())
    expect(result.status).toBe('UNKNOWN')
    expect(result.issues.join(' ')).toContain('영업시간')
    expect(result.issues.join(' ')).toContain('효능')
    expect(result.issues.join(' ')).toContain('혜택')
  })

  it('does not let a verified price for one product support another product at the same price', () => {
    const ctx = context([{ kind: 'offering', label: '아메리카노', value: '아메리카노 3,000원' }])
    expect(checkBusinessClaims('threads', { text: '라떼 3,000원' }, ctx).status).toBe('UNKNOWN')
    expect(checkBusinessClaims('threads', { text: '아메리카노 3,000원' }, ctx).status).toBe('OK')
  })

  it('ignores null coupon and does not let an unrelated verified price license new prices', () => {
    expect(checkBusinessClaims('daangn_business', { text: '안녕하세요', coupon: null }, context()).status).toBe('OK')
    const ctx = context([{ kind: 'offering', label: '아메리카노', value: '아메리카노 3,000원' }])
    expect(checkBusinessClaims('threads', { text: '라떼 5,000원' }, ctx).status).toBe('UNKNOWN')
  })

  it.each([
    ['전각 가격', '커트 １５，０００원', '가격'],
    ['한글 숫자 가격', '커트 만오천원', '가격'],
    ['한글 단위 가격', '커트 삼만원', '가격'],
    ['영문 통화', 'Cut 15000won', '가격'],
    ['영문 축약 통화', 'Cut 15k', '가격'],
    ['영문 무료', 'FREE parking', '혜택'],
    ['영문 반값', 'half price', '혜택'],
    ['영문 1+1', 'Special deal, buy 1 get 1', '혜택'],
    ['영문 할인', '50% OFF', '혜택'],
    ['숫자 1+1', '1+1', '혜택'],
    ['한국어 세일', '세일 중', '혜택'],
    ['띄어 쓴 무료', '무 료 증 정', '혜택'],
    ['제로폭 무료', '무​료 제공', '혜택'],
    ['개행 분할 무료', '무\n료 제공', '혜택'],
    ['영문 운영시간', 'Open 9am-6pm daily', '영업시간'],
    ['영문 상시 영업', '24/7', '영업시간'],
    ['순위 맛집', '네이버 1등 맛집', '수상'],
    ['순위 업계', '업계 1위', '수상'],
    ['영문 순위', 'No.1', '수상'],
    ['최상위 홍보', '최고', '수상'],
    ['인증 주장', '인증', '수상'],
  ])('blocks unsupported %s: %s', (_name, text, reason) => {
    const result = checkBusinessClaims('threads', { text }, context())
    expect(result.status).toBe('UNKNOWN')
    expect(result.issues.join(' ')).toContain(reason)
  })

  it.each([
    ['커트 1,000원', [{ kind: 'offering' as const, label: '커트', value: '커트 11,000원' }]],
    ['9:00~', [{ kind: 'profile' as const, label: '운영시간', value: '19:00~21:00' }]],
    ['펌 할인', [{ kind: 'policy' as const, label: '펌', value: '펌 할인 이벤트 없음' }]],
    ['펌 할인', [{ kind: 'policy' as const, label: '펌', value: '펌 할인 진행하지 않습니다' }]],
    ['펌 할인', [{ kind: 'policy' as const, label: '펌', value: '펌 할인 안 함' }]],
  ])('does not treat partial or negated evidence as support for %s', (text, facts) => {
    expect(checkBusinessClaims('threads', { text }, context(facts)).status).toBe('UNKNOWN')
  })

  it.each([
    ['커트 1.5만원', '커트 5만원'],
    ['커트 10만5천원', '커트 5천원'],
    ['커트 ₩1.5', '커트 ₩1'],
    ['커트 5원', '커트 1.5원'],
    ['커트 5k', '커트 1.5k'],
  ])('does not borrow part of a decimal or compound price: %s', (text, evidence) => {
    expect(checkBusinessClaims('naver_blog', { text }, context([
      { kind: 'offering', label: '커트', value: evidence },
    ])).status).toBe('UNKNOWN')
  })

  it.each(['커트 1.5만원', '커트 10만5천원', '커트 ₩1.5', '커트 1.5원', '커트 1.5k'])('allows the exact approved decimal or compound price: %s', text => {
    expect(checkBusinessClaims('naver_blog', { text }, context([
      { kind: 'offering', label: '커트', value: text },
    ]))).toEqual({ status: 'OK', issues: [] })
  })

  it('never skips claims after the first 200 array or object entries', () => {
    const filler = Array.from({ length: 200 }, () => '평범한 글')
    expect(checkBusinessClaims('instagram', { hashtags: [...filler, '#무료증정'] }, context()).status).toBe('UNKNOWN')
    expect(checkBusinessClaims('threads', Object.fromEntries([...filler.map((text, i) => [`k${i}`, text]), ['last', '50% OFF']]), context()).status).toBe('UNKNOWN')
  })
})
