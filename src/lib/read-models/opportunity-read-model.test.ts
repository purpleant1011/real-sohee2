import { describe, expect, it } from 'vitest'
import { getOpportunitiesReadModel } from './opportunity-read-model'

const workspaceId = 'ws-test'

describe('getOpportunitiesReadModel — 가짜 값을 실측처럼 보여주지 않는다', () => {
  it('isDemo 가 없으면 빈 목록과 정직한 안내를 반환한다', () => {
    const list = getOpportunitiesReadModel({ workspaceId })

    expect(list.items).toEqual([])
    expect(list.totalCount).toBe(0)
    expect(list.insufficientSampleWarning).toBe('아직 측정된 기회가 없어요.')
  })

  it('isDemo: false 도 빈 목록이다 (명시적 실사용 경로)', () => {
    const list = getOpportunitiesReadModel({ workspaceId, isDemo: false })

    expect(list.items).toEqual([])
    expect(list.insufficientSampleWarning).toBe('아직 측정된 기회가 없어요.')
  })

  it('isDemo: true 일 때만 예시 항목을 반환하되 측정값으로 표시하지 않는다', () => {
    const list = getOpportunitiesReadModel({ workspaceId, isDemo: true })

    expect(list.items.length).toBeGreaterThan(0)
    for (const item of list.items) {
      expect(item.expectedImpact.provenance).toBe('demo')
      for (const evidence of item.evidence) {
        expect(evidence.provenance).not.toBe('measured')
      }
    }
    expect(list.demoNotice).toContain('예시')
  })

  it('예시 항목은 실측 출처명을 주장하지 않는다', () => {
    const list = getOpportunitiesReadModel({ workspaceId, isDemo: true })

    for (const item of list.items) {
      for (const evidence of item.evidence) {
        expect(evidence.source.startsWith('예시')).toBe(true)
        expect(evidence.label).not.toContain('실시간')
      }
    }
  })

  it('필터는 실제 항목 수로 집계된다', () => {
    const all = getOpportunitiesReadModel({ workspaceId, isDemo: true })
    const review = getOpportunitiesReadModel({ workspaceId, isDemo: true, filter: 'review' })

    expect(review.totalCount).toBe(review.items.length)
    expect(all.counts.all).toBe(all.items.length)
    expect(review.counts.review).toBe(review.items.length)
  })

  it('빈 목록일 때 counts 는 모두 0 이다', () => {
    const list = getOpportunitiesReadModel({ workspaceId })

    expect(list.counts).toEqual({ all: 0, empty_slot: 0, inquiry: 0, review: 0, content: 0, local: 0, channel_issue: 0 })
  })
})
