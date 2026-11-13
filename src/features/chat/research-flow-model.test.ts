import { describe, expect, it } from 'vitest'
import {
  deriveFlowPhase,
  progressPercent,
  taskCounts,
  type FlowTaskStatus,
  type ResearchPlan,
} from './research-flow-model'

describe('research-flow-model', () => {
  const samplePlan: ResearchPlan = {
    summary: '인천 청라 30대 타깃 네이버 블로그 및 인스타그램 홍보 계획',
    direction: [
      '자연스러운 상담 전후 스토리 중심 전개',
      '네이버 블로그 1건 + 인스타그램 카드뉴스 1건 발행',
    ],
    tasks: [
      { id: 'task-1', title: '블로그 키워드 분석 및 제목 선정', channel: 'naver_blog', estimatedCredits: 2 },
      { id: 'task-2', title: '블로그 원고 본문 작성', detail: '전문성 강조 및 상담 CTA', channel: 'naver_blog', estimatedCredits: 5 },
      { id: 'task-3', title: '인스타그램 카드뉴스 이미지 생성', channel: 'instagram', estimatedCredits: 3 },
    ],
    totalCredits: 10,
  }

  describe('deriveFlowPhase', () => {
    it('returns asking when no questions answered and no plan', () => {
      expect(deriveFlowPhase({})).toBe('asking')
      expect(deriveFlowPhase({ answeredQuestions: false })).toBe('asking')
      expect(deriveFlowPhase({ answeredQuestions: 0 })).toBe('asking')
      expect(deriveFlowPhase({ answeredQuestions: [] })).toBe('asking')
    })

    it('returns proposing when questions are answered but no plan yet', () => {
      expect(deriveFlowPhase({ answeredQuestions: true })).toBe('proposing')
      expect(deriveFlowPhase({ answeredQuestions: 4 })).toBe('proposing')
      expect(deriveFlowPhase({ answeredQuestions: ['ans1', 'ans2'] })).toBe('proposing')
    })

    it('returns awaiting_approval when plan is present but not approved', () => {
      expect(deriveFlowPhase({ plan: samplePlan })).toBe('awaiting_approval')
      expect(deriveFlowPhase({ plan: samplePlan, approved: false })).toBe('awaiting_approval')
      expect(deriveFlowPhase({ answeredQuestions: true, plan: samplePlan, approved: false })).toBe('awaiting_approval')
    })

    it('returns running when plan is approved but tasks are not yet complete', () => {
      expect(deriveFlowPhase({ plan: samplePlan, approved: true })).toBe('running')
      expect(
        deriveFlowPhase({
          plan: samplePlan,
          approved: true,
          tasks: [
            { id: 'task-1', title: 'Task 1', status: 'pending' },
            { id: 'task-2', title: 'Task 2', status: 'pending' },
          ],
        }),
      ).toBe('running')
      expect(
        deriveFlowPhase({
          plan: samplePlan,
          approved: true,
          tasks: [
            { id: 'task-1', title: 'Task 1', status: 'completed' },
            { id: 'task-2', title: 'Task 2', status: 'in_progress' },
          ],
        }),
      ).toBe('running')
    })

    it('returns running if tasks are in progress even without explicit approved flag', () => {
      expect(
        deriveFlowPhase({
          tasks: [{ id: 'task-1', title: 'Task 1', status: 'in_progress' }],
        }),
      ).toBe('running')
    })

    it('returns running when some tasks failed or are unknown (not done)', () => {
      expect(
        deriveFlowPhase({
          plan: samplePlan,
          approved: true,
          tasks: [
            { id: 'task-1', title: 'Task 1', status: 'completed' },
            { id: 'task-2', title: 'Task 2', status: 'failed' },
          ],
        }),
      ).toBe('running')
    })

    it('returns done only when all tasks are completed', () => {
      expect(
        deriveFlowPhase({
          plan: samplePlan,
          approved: true,
          tasks: [
            { id: 'task-1', title: 'Task 1', status: 'completed' },
            { id: 'task-2', title: 'Task 2', status: 'completed' },
            { id: 'task-3', title: 'Task 3', status: 'completed' },
          ],
        }),
      ).toBe('done')
      expect(
        deriveFlowPhase({
          tasks: [{ id: 'task-1', title: 'Task 1', status: 'completed' }],
        }),
      ).toBe('done')
    })

    it('does not return done if tasks list is empty', () => {
      expect(deriveFlowPhase({ approved: true, tasks: [] })).toBe('running')
    })
  })

  describe('taskCounts', () => {
    it('handles empty task list', () => {
      const counts = taskCounts([])
      expect(counts.total).toBe(0)
      expect(counts.completed).toBe(0)
      expect(counts.inProgress).toBe(0)
      expect(counts.pending).toBe(0)
      expect(counts.failed).toBe(0)
      expect(counts.cancelled).toBe(0)
      expect(counts.unknown).toBe(0)
      expect(counts.awaitingApproval).toBe(0)
    })

    it('accurately counts tasks by status', () => {
      const tasks: { status: FlowTaskStatus }[] = [
        { status: 'completed' },
        { status: 'completed' },
        { status: 'in_progress' },
        { status: 'pending' },
        { status: 'failed' },
        { status: 'cancelled' },
        { status: 'unknown' },
        { status: 'awaiting_approval' },
      ]
      const counts = taskCounts(tasks)
      expect(counts.total).toBe(8)
      expect(counts.completed).toBe(2)
      expect(counts.inProgress).toBe(1)
      expect(counts.in_progress).toBe(1)
      expect(counts.pending).toBe(1)
      expect(counts.failed).toBe(1)
      expect(counts.cancelled).toBe(1)
      expect(counts.unknown).toBe(1)
      expect(counts.awaitingApproval).toBe(1)
      expect(counts.awaiting_approval).toBe(1)
    })
  })

  describe('progressPercent', () => {
    it('returns 0 for empty task list', () => {
      expect(progressPercent([])).toBe(0)
    })

    it('returns 0 when no tasks are completed', () => {
      expect(
        progressPercent([
          { status: 'pending' },
          { status: 'in_progress' },
        ]),
      ).toBe(0)
    })

    it('calculates completed/total percent correctly', () => {
      expect(
        progressPercent([
          { status: 'completed' },
          { status: 'pending' },
        ]),
      ).toBe(50)
      expect(
        progressPercent([
          { status: 'completed' },
          { status: 'completed' },
          { status: 'pending' },
          { status: 'pending' },
        ]),
      ).toBe(50)
    })

    it('never counts failed, cancelled, or unknown as completed', () => {
      expect(
        progressPercent([
          { status: 'completed' },
          { status: 'failed' },
          { status: 'unknown' },
          { status: 'cancelled' },
        ]),
      ).toBe(25)
    })

    it('returns 100 ONLY if all tasks are completed', () => {
      // 1 out of 2 completed + 1 failed -> must not be 100
      expect(
        progressPercent([
          { status: 'completed' },
          { status: 'failed' },
        ]),
      ).toBe(50)

      // 999 out of 1000 completed -> at most 99, never 100
      const almostAll: { status: FlowTaskStatus }[] = Array.from({ length: 999 }, () => ({
        status: 'completed',
      }))
      almostAll.push({ status: 'pending' })
      expect(progressPercent(almostAll)).toBeLessThan(100)
      expect(progressPercent(almostAll)).toBe(99)

      // Only all completed is 100
      expect(
        progressPercent([
          { status: 'completed' },
          { status: 'completed' },
        ]),
      ).toBe(100)
    })
  })
})
