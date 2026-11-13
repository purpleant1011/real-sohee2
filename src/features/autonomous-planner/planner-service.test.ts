import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AutonomousPlannerService } from './planner-service'

describe('AutonomousPlannerService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calculates upcoming weekly slots for Tuesday, Thursday, Saturday at 19:00', () => {
    const service = new AutonomousPlannerService({} as any)
    const baseDate = new Date('2026-10-18T10:00:00+09:00') // Sunday
    const slots = service.calculateUpcomingSlots({
      baseDate,
      count: 3,
      targetDays: [2, 4, 6], // Tue, Thu, Sat
      targetHour: 19,
    })

    expect(slots).toHaveLength(3)
    // 1st slot: Tuesday Oct 20 at 19:00
    expect(slots[0].getDay()).toBe(2)
    expect(slots[0].getHours()).toBe(19)

    // 2nd slot: Thursday Oct 22 at 19:00
    expect(slots[1].getDay()).toBe(4)

    // 3rd slot: Saturday Oct 24 at 19:00
    expect(slots[2].getDay()).toBe(6)
  })

  it('plans content items for upcoming slots using theme rotation', async () => {
    const mockAdmin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
        insert: vi.fn().mockResolvedValue({ data: {}, error: null }),
      }),
    }

    const service = new AutonomousPlannerService(mockAdmin as any)
    const planned = await service.planUpcomingPosts({
      workspaceId: 'ws-1',
      context: {
        businessName: '바이름',
        location: '청라',
        industry: '뷰티',
        facts: [],
        tone: { presetKey: null, brandVoice: '다정한' },
        knowledgeVersion: 1,
        warnings: [],
      },
      count: 3,
      now: new Date('2026-10-18T10:00:00+09:00'),
    })

    expect(planned).toHaveLength(3)
    expect(planned[0].themeKey).toBe('story')
    expect(planned[1].themeKey).toBe('tip')
    expect(planned[2].themeKey).toBe('consultation')
  })
})
