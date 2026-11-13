import { describe, expect, it, vi, beforeEach } from 'vitest'
import { POST } from './route'

const mockAuth = vi.fn()
vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: (...args: any[]) => mockAuth(...args),
  isResponse: (v: any) => v && typeof v.status === 'number',
}))

describe('POST /api/workspaces/[workspaceId]/engagement/comments/[commentId]/retry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resets comment from NEEDS_CHECK to DRAFTED and clears previous action requests', async () => {
    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'social_comments') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          }
        }
        if (table === 'external_action_requests') {
          return {
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ error: null }),
                }),
              }),
            }),
          }
        }
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null }),
        }
      }),
    }

    mockAuth.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      admin: mockAdmin,
    })

    const req = new Request('https://example.com/api/workspaces/ws-1/engagement/comments/cm-1/retry', {
      method: 'POST',
    })
    const res = await POST(req, { params: Promise.resolve({ workspaceId: 'ws-1', commentId: 'cm-1' }) })
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.ok).toBe(true)
  })
})
