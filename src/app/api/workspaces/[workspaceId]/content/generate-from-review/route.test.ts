import { describe, expect, it, vi, beforeEach } from 'vitest'
import { POST } from './route'

const mockAuth = vi.fn()
vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: (...args: any[]) => mockAuth(...args),
  isResponse: (v: any) => v && typeof v.status === 'number',
}))

describe('POST /api/workspaces/[workspaceId]/content/generate-from-review', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generates 3 review content options from workspace business profile facts', async () => {
    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'business_profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                business_name: '바이름 청라점',
                location: '인천 서구 청라',
                industry: '퍼스널 뷰티',
                summary: '평점 4.98점, 방문자 리뷰 87개, 25년 손길',
              },
              error: null,
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      }),
    }

    mockAuth.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      admin: mockAdmin,
    })

    const req = new Request('https://example.com/api/workspaces/ws-1/content/generate-from-review', {
      method: 'POST',
    })
    const res = await POST(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.options).toHaveLength(3)
    expect(json.options[0].instagramCaption).toContain('바이름')
  })

  it('fails closed when business profile is missing or business_name is empty', async () => {
    const mockAdmin = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      })),
    }

    mockAuth.mockResolvedValueOnce({
      workspaceId: 'ws-empty',
      admin: mockAdmin,
    })

    const req = new Request('https://example.com/api/workspaces/ws-empty/content/generate-from-review', {
      method: 'POST',
    })
    const res = await POST(req, { params: Promise.resolve({ workspaceId: 'ws-empty' }) })
    expect(res.status).toBe(400)

    const json = await res.json()
    expect(json.ok).toBeUndefined()
    expect(json.error).toContain('사업장 프로필')
  })

  it('does not invent 4.98 rating or 87 reviews when summary has no rating or review facts', async () => {
    const mockAdmin = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            business_name: '강남속눈썹앤왁싱',
            location: '서울 강남구 역삼동',
            industry: '뷰티',
            summary: '1:1 프라이빗 예약제 뷰티 스튜디오',
          },
          error: null,
        }),
      })),
    }

    mockAuth.mockResolvedValueOnce({
      workspaceId: 'ws-2',
      admin: mockAdmin,
    })

    const req = new Request('https://example.com/api/workspaces/ws-2/content/generate-from-review', {
      method: 'POST',
    })
    const res = await POST(req, { params: Promise.resolve({ workspaceId: 'ws-2' }) })
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.ok).toBe(true)
    for (const opt of json.options) {
      expect(opt.instagramCaption).not.toContain('4.98')
      expect(opt.instagramCaption).not.toContain('87')
      expect(opt.instagramCaption).not.toContain('바이름')
      expect(opt.instagramCaption).not.toContain('청라')
      expect(opt.threadsText).not.toContain('4.98')
      expect(opt.threadsText).not.toContain('바이름')
      expect(opt.threadsText).not.toContain('청라')
    }
  })
})
