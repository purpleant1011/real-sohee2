import { describe, it, expect, vi } from 'vitest'
import { getTodayWorkspaceModel } from './today-workspace.repository'

// Mock repositories
vi.mock('@/features/reports/repository', () => ({
  getReportSnapshot: vi.fn().mockResolvedValue({
    data: {
      message: '오후 6시 이전 빠른 답변이 상담 전환율을 18% 높였어요.',
      metrics: { observedPosts: 5 },
    },
  }),
}))

vi.mock('@/features/channels/interaction-repository', () => ({
  listChannelInteractions: vi.fn().mockResolvedValue({
    data: [
      {
        id: 'int-1',
        channel: 'instagram',
        category: 'dm',
        occurredAt: new Date().toISOString(),
        inboundText: '내일 예약 가능한가요?',
        responseStatus: 'draft',
        responseText: '안녕하세요! 내일 가능합니다.',
      },
    ],
  }),
}))

vi.mock('@/features/schedule/repository', () => ({
  getScheduleBoard: vi.fn().mockResolvedValue({
    data: {
      schedules: [
        {
          id: 'sch-1',
          publishAt: new Date().toISOString(),
          status: 'scheduled',
        },
      ],
    },
  }),
}))

describe('today-workspace.repository', () => {
  it('올바른 TodayWorkspaceModel 구조를 조합하여 반환한다', async () => {
    const model = await getTodayWorkspaceModel({ workspaceId: '00000000-0000-0000-0000-000000000001' })

    expect(model).toBeDefined()
    expect(model.agent.status).toBe('running')
    expect(model.growthFlow.signals).toBe(1)
    expect(model.growthFlow.draftsReady).toBe(1)
    expect(model.opportunities.length).toBeGreaterThan(0)
    expect(model.opportunities[0].channel).toBe('instagram')
    expect(model.goals.length).toBe(3)
    expect(model.schedule.length).toBeGreaterThan(0)
    expect(model.insights.length).toBeGreaterThan(0)
  })
})
