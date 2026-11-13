import { describe, expect, it } from 'vitest'
import { evaluateRequirements, pickNextStep } from '../requirements'
import { EMPTY, FULL, PARTIAL } from './fixtures'

const done = (results: ReturnType<typeof evaluateRequirements>) =>
  Object.fromEntries(results.map((r) => [r.key, r.done]))

describe('evaluateRequirements', () => {
  it('아무것도 없으면 모두 미충족', () => {
    expect(Object.values(done(evaluateRequirements(EMPTY))).every((v) => v === false)).toBe(true)
  })

  it('모두 가르쳤으면 모두 충족', () => {
    expect(Object.values(done(evaluateRequirements(FULL))).every((v) => v === true)).toBe(true)
  })

  it('부분적으로 가르친 경우', () => {
    expect(done(evaluateRequirements(PARTIAL))).toEqual({
      shop_basic: true,
      products: true,
      voice: true,
      image_style: false,
      caution: true,
      channel: true,
      faq: false,
      manual: false,
      booking_rules: false,
    })
  })

  it('FAQ 는 3개가 목표이고 남은 개수를 알려준다', () => {
    const faq = evaluateRequirements(PARTIAL).find((r) => r.key === 'faq')
    expect(faq).toMatchObject({ done: false, remaining: '2개 더' })
  })

  it('말투는 말투 입력이나 글 쓰는 기준 확정 둘 중 하나면 충족', () => {
    const onlyHarness = { ...EMPTY, harness: { ...EMPTY.harness, text: true } }
    expect(evaluateRequirements(onlyHarness).find((r) => r.key === 'voice')?.done).toBe(true)
  })

  it('가게 기본 정보는 이름·업종·소개가 모두 있어야 충족', () => {
    const two = { ...EMPTY, profile: { ...EMPTY.profile, nameValid: true, industryValid: true } }
    expect(evaluateRequirements(two).find((r) => r.key === 'shop_basic')?.done).toBe(false)
  })

  it('운영 매뉴얼은 운영 규칙 확정과 자료 1개 이상이 모두 필요', () => {
    const policyOnly = { ...EMPTY, harness: { ...EMPTY.harness, approvalPolicy: true } }
    expect(evaluateRequirements(policyOnly).find((r) => r.key === 'manual')?.done).toBe(false)
    const both = { ...policyOnly, sourceCount: 1 }
    expect(evaluateRequirements(both).find((r) => r.key === 'manual')?.done).toBe(true)
  })

  it('각 요건에 사용자용 이름과 가야 할 탭이 있다', () => {
    const reqs = evaluateRequirements(EMPTY)
    expect(reqs.find((r) => r.key === 'channel')).toMatchObject({ label: '인스타·스레드 연결하기', destination: 'tools' })
    expect(reqs.find((r) => r.key === 'voice')).toMatchObject({ label: '말투 정하기', destination: 'work' })
    expect(reqs.find((r) => r.key === 'shop_basic')).toMatchObject({ label: '가게 이름·업종·소개 알려주기', destination: 'teach' })
  })
})

describe('pickNextStep', () => {
  it('우선순위대로 가장 먼저 못 채운 요건을 고른다', () => {
    expect(pickNextStep(evaluateRequirements(EMPTY))?.requirementKey).toBe('shop_basic')
    expect(pickNextStep(evaluateRequirements(PARTIAL))).toEqual({
      requirementKey: 'image_style',
      title: '이미지 스타일 정하기',
      destination: 'work',
    })
  })

  it('모두 채웠으면 null', () => {
    expect(pickNextStep(evaluateRequirements(FULL))).toBeNull()
  })
})
