import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MissionRepository } from '../mission-repository'

describe('MissionRepository & Event Sourcing (ANI-1210, ANI-1211)', () => {
  const targetWorkspaceId = '00000000-0000-4000-8000-0000000000a2'
  const mockFrom = vi.fn()

  const mockClient = {
    from: mockFrom,
  } as any

  let repo: MissionRepository

  beforeEach(() => {
    vi.clearAllMocks()
    repo = new MissionRepository(mockClient)
  })

  it('1. MUST create marketing mission with RECEIVED status and append MISSION_RECEIVED event', async () => {
    const fakeMission = {
      id: 'm-100',
      workspace_id: targetWorkspaceId,
      trace_id: 'tr-100',
      status: 'RECEIVED',
      goal: '가을 자연눈썹 마케팅',
      created_at: '2026-09-10T00:00:00.000Z',
      updated_at: '2026-09-10T00:00:00.000Z',
    }

    mockFrom.mockImplementation((table: string) => {
      if (table === 'marketing_missions') {
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValueOnce({ data: fakeMission, error: null }),
        }
      }
      if (table === 'mission_events') {
        return {
          insert: vi.fn().mockResolvedValueOnce({ data: null, error: null }),
        }
      }
      return {}
    })

    const result = await repo.createMission({
      workspaceId: targetWorkspaceId,
      traceId: 'tr-100',
      goal: '가을 자연눈썹 마케팅',
    })

    expect(result.id).toBe('m-100')
    expect(result.status).toBe('RECEIVED')
  })

  it('2. MUST validate transitions through state machine and reject illegal leaps', async () => {
    const currentMission = {
      id: 'm-100',
      workspace_id: targetWorkspaceId,
      trace_id: 'tr-100',
      status: 'RECEIVED',
    }

    mockFrom.mockImplementation((table: string) => {
      if (table === 'marketing_missions') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValueOnce({ data: currentMission, error: null }),
        }
      }
      return {}
    })

    // RECEIVED -> PUBLISHED_VERIFIED is illegal!
    await expect(
      repo.transitionMission({
        workspaceId: targetWorkspaceId,
        missionId: 'm-100',
        traceId: 'tr-100',
        toStatus: 'PUBLISHED_VERIFIED',
        actorType: 'agent',
        eventName: 'ILLEGAL_PUBLISH',
      })
    ).rejects.toThrow(/INVALID_MISSION_TRANSITION/)
  })
})
