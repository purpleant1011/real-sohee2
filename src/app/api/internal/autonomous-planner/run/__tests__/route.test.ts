import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const {
  selectMock,
  orMock,
  loadGroundedBusinessContextMock,
  planUpcomingPostsMock,
  persistPlannedItemMock,
} = vi.hoisted(() => ({
  selectMock: vi.fn(),
  orMock: vi.fn(),
  loadGroundedBusinessContextMock: vi.fn(),
  planUpcomingPostsMock: vi.fn(),
  persistPlannedItemMock: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'engagement_policies') {
        return {
          select: selectMock.mockReturnValue({
            or: orMock,
          }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { user_id: 'owner-1' }, error: null }),
      }
    }),
  })),
}))

vi.mock('@/features/channel-studio/knowledge-context', () => ({
  loadGroundedBusinessContext: loadGroundedBusinessContextMock,
}))

vi.mock('@/features/autonomous-planner/planner-service', () => ({
  AutonomousPlannerService: vi.fn().mockImplementation(function () {
    return {
      planUpcomingPosts: planUpcomingPostsMock,
      persistPlannedItem: persistPlannedItemMock,
    }
  }),
}))

import { POST } from '../route'

describe('Autonomous Planner Cron Route (POST /api/internal/autonomous-planner/run)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'this-is-a-valid-long-cron-secret-123456789'
  })

  it('rejects unauthorized requests with 404', async () => {
    const req = new NextRequest('http://localhost/api/internal/autonomous-planner/run', {
      method: 'POST',
      headers: { authorization: 'Bearer invalid-token' },
    })
    const res = await POST(req)
    expect(res.status).toBe(404)
  })

  it('skips planning when no L3 or auto-post workspaces exist', async () => {
    orMock.mockResolvedValueOnce({ data: [], error: null })

    const req = new NextRequest('http://localhost/api/internal/autonomous-planner/run', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.workspacesProcessed).toBe(0)
    expect(json.skipped).toBe(true)
  })

  it('plans and persists content for active L3 workspaces', async () => {
    orMock.mockResolvedValueOnce({
      data: [
        { workspace_id: 'ws-1', autonomy_level: 'L3_AUTONOMOUS', auto_post_enabled: true, default_tone: 'friendly' },
      ],
      error: null,
    })

    loadGroundedBusinessContextMock.mockResolvedValueOnce({
      businessName: '바이름',
      location: '청라',
      industry: '뷰티',
      facts: [],
      tone: { presetKey: null, brandVoice: '친근한' },
      knowledgeVersion: 1,
      warnings: [],
    })

    planUpcomingPostsMock.mockResolvedValueOnce([
      {
        themeKey: 'story',
        themeTitle: '🌿 매장 일상 이야기',
        instagramCaption: '인스타 본문',
        threadsText: '스레드 본문',
        scheduledSlot: '2026-10-20T19:00:00.000Z',
        hashtags: ['#바이름'],
      },
    ])

    persistPlannedItemMock.mockResolvedValueOnce({ success: true, id: 'item-1' })

    const req = new NextRequest('http://localhost/api/internal/autonomous-planner/run', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.workspacesProcessed).toBe(1)
    expect(json.totalPlanned).toBe(1)
  })
})
