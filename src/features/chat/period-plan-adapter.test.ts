import { describe, expect, it } from 'vitest'
import { periodPlanToResearchPlan } from './period-plan-adapter'

const base = { id: 'p1', originalRequest: '이번 주 포스팅 기획해줘', periodStart: '2026-11-03', periodEnd: '2026-11-09', timezone: 'Asia/Seoul', goal: '신규 상담 늘리기',
  channels: [{ channel: 'instagram', postCount: 3, imagesPerPost: 1 }, { channel: 'naver_blog', postCount: 1, imagesPerPost: 2 }] as const,
  catalogVersion: 1, estimatedCredits: 12, expectedRemainingCredits: 88, status: 'ready' as const }

describe('periodPlanToResearchPlan', () => {
  it('목표·기간·채널별 작업을 승인 카드 모양으로 바꾼다', () => {
    const plan = periodPlanToResearchPlan(base as never)
    expect(plan.summary).toContain('신규 상담 늘리기')
    expect(plan.direction.join(' ')).toContain('11월 3일')
    expect(plan.tasks.map(t => t.title)).toEqual(['인스타그램 게시물 3개 만들기', '네이버 블로그 게시물 1개 만들기'])
    expect(plan.tasks[0].detail).toContain('이미지 3장')
    expect(plan.totalCredits).toBe(12)
  })
  it('크레딧이 부족하면 방향에 범위 조정이 필요하다고 분명히 적는다', () => {
    const plan = periodPlanToResearchPlan({ ...base, status: 'insufficient', expectedRemainingCredits: -4 } as never)
    expect(plan.direction.join(' ')).toMatch(/크레딧이 부족/)
  })
})
