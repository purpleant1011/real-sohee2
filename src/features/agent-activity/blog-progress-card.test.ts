import { describe, expect, it } from 'vitest'
import { projectBlogProgress, type BlogStageFact } from './blog-progress-card'

const W = '11111111-1111-4111-8111-111111111111'
const R = '22222222-2222-4222-8222-222222222222'
const scope = { workspaceId: W, runId: R, live: true }
let n = 0
const fact = (over: Partial<BlogStageFact> = {}): BlogStageFact => ({
  eventId: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  workspaceId: W, runId: R, sequence: n, observedAt: '2026-10-28T01:30:00.000Z',
  stage: 'keyword_lookup', status: 'verified', provenance: 'server_record', sourceId: 'naver_search',
  ...over,
})

describe('블로그 조사·작성 진행 카드', () => {
  it('서버 수행 기록의 출처·관측 시각·표본·커버리지를 한국 시각으로 표시한다', () => {
    const card = projectBlogProgress([fact({ sampleSize: 20, coverage: { covered: 18, total: 20 } })], scope)!
    expect(card.kind).toBe('task_timeline')
    expect(card.steps[0]).toMatchObject({ status: 'completed' })
    expect(card.steps[0].title).toContain('키워드 조회')
    expect(card.steps[0].title).toContain('네이버 검색')
    expect(card.steps[0].title).toContain('10:30')
    expect(card.steps[0].title).toContain('표본 20건')
    expect(card.steps[0].title).toContain('18/20')
  })
  it('server_record가 아닌 fixture·시뮬레이션은 완료로 보이지 않고 연습으로 구분한다', () => {
    for (const provenance of ['fixture', 'simulated'] as const) {
      const card = projectBlogProgress([fact({ provenance })], scope)!
      expect(card.steps[0].status).toBe('unknown')
      expect(card.steps[0].title).toContain('시안·연습')
      expect(card.completedSteps).toBe(0)
    }
  })
  it('시작만 있고 종료 기록이 없는 단계는 라이브가 아니면 확인 전으로 남긴다', () => {
    const started = fact({ status: 'started', stage: 'draft_writing', sourceId: 'business_facts' })
    expect(projectBlogProgress([started], scope)!.steps[0].status).toBe('in_progress')
    expect(projectBlogProgress([started], { ...scope, live: false })!.steps[0].status).toBe('unknown')
  })
  it('같은 단계의 최신 기록만 남기고 SSE 재전송 중복은 한 번만 센다', () => {
    const started = fact({ status: 'started', sequence: 1 })
    const done = fact({ status: 'verified', sequence: 2 })
    const card = projectBlogProgress([done, started, done, started], scope)!
    expect(card.steps).toHaveLength(1)
    expect(card.steps[0].status).toBe('completed')
  })
  it('부분 실패는 완료가 아니라 확인 필요이며 커버리지를 보인다', () => {
    const card = projectBlogProgress([fact({ status: 'partial', coverage: { covered: 3, total: 10 } })], scope)!
    expect(card.steps[0].status).toBe('unknown')
    expect(card.steps[0].title).toContain('일부만 확인')
    expect(card.steps[0].title).toContain('3/10')
    expect(card.completedSteps).toBe(0)
  })
  it('실패는 failed로 표시한다', () => {
    expect(projectBlogProgress([fact({ status: 'failed' })], scope)!.steps[0].status).toBe('failed')
  })
  it('다른 workspace·run 기록과 형식이 잘못된 기록은 무시한다', () => {
    const other = '33333333-3333-4333-8333-333333333333'
    const bad = [
      fact({ workspaceId: other }), fact({ runId: other }), fact({ sequence: 0 }),
      fact({ observedAt: 'not-a-date' }), fact({ sampleSize: -1 }), fact({ sampleSize: 1.5 }),
      fact({ coverage: { covered: 5, total: 3 } }), fact({ sourceId: 'free-text' as never }),
      fact({ stage: 'invented' as never }),
    ]
    expect(projectBlogProgress(bad, scope)).toBeNull()
  })
  it('자유 문장·비밀값·PII는 허용 목록 밖이라 카드에 전달되지 않는다', () => {
    const leaky = { ...fact(), note: 'sk-secret 010-1234-5678', sourceLabel: '고객 홍길동' } as BlogStageFact
    const text = JSON.stringify(projectBlogProgress([leaky], scope))
    expect(text).not.toMatch(/sk-secret|010-1234|홍길동/)
  })
  it('임의 완료 소요시간을 만들지 않는다', () => {
    const card = projectBlogProgress([fact({ status: 'started', sequence: 1 }), fact({ status: 'verified', sequence: 2 })], scope)!
    expect(JSON.stringify(card)).not.toMatch(/\d+(\.\d+)?\s*(초|ms|분 걸)/)
  })
  it('기록이 없으면 카드를 만들지 않는다', () => {
    expect(projectBlogProgress([], scope)).toBeNull()
  })
})
