import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, POST } from '@/app/api/onboarding/first-meeting/route'

// Mock dependencies
const mockUser = { id: 'usr-123', email: 'test@example.com' }
const mockWorkspaceId = '722f818e-718c-431e-94b8-9b527379f5fb'

const mockUpsertCandidate = vi.fn()
const mockSelectCandidates = vi.fn()

const createMockSupabase = () => ({
  auth: {
    getUser: vi.fn().mockResolvedValue({
      data: { user: mockUser },
      error: null,
    }),
  },
  from: vi.fn().mockImplementation((table: string) => {
    if (table === 'workspace_members') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [{ workspace_id: mockWorkspaceId }],
              error: null,
            }),
          }),
        }),
      }
    }
    if (table === 'workspace_profile_candidates') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: mockSelectCandidates(),
              error: null,
            }),
          }),
        }),
        insert: mockUpsertCandidate,
        upsert: mockUpsertCandidate,
      }
    }
    if (table === 'onboarding_sessions') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [{ id: 'session-123', workspace_id: mockWorkspaceId }],
              error: null,
            }),
          }),
        }),
      }
    }
    if (table === 'mission_events') {
      return {
        insert: vi.fn().mockResolvedValue({ error: null }),
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
        }),
      }
    }
    return {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockResolvedValue({ error: null }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    }
  }),
})

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockImplementation(() => createMockSupabase()),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn().mockImplementation(() => createMockSupabase()),
}))

describe('E3: First Meeting Canonical Persistence in workspace_profile_candidates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpsertCandidate.mockResolvedValue({ data: null, error: null })
    mockSelectCandidates.mockReturnValue([])
  })

  it('POST /api/onboarding/first-meeting persists candidates to workspace_profile_candidates with status CANDIDATE (review_required)', async () => {
    const payload = {
      expectationText: '인스타 홍보를 꾸준히 잘해줬으면 좋겠고, 말투는 너무 광고 같지 않았으면 해.',
      candidates: [
        {
          key: 'marketing_goal',
          label: '소희에게 바라는 역할',
          value: '인스타그램 홍보 및 피드 활성화',
          status: 'CANDIDATE',
          version: 1,
          sourceUtterance: '인스타 홍보를 꾸준히 잘해줬으면 좋겠고',
          previousValues: [],
        },
      ],
    }

    const req = new Request('http://localhost:3000/api/onboarding/first-meeting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(200)

    // MUST invoke persistence targeting workspace_profile_candidates
    expect(mockUpsertCandidate).toHaveBeenCalled()
    const callArg = mockUpsertCandidate.mock.calls[0]?.[0]
    const insertedRecord = Array.isArray(callArg) ? callArg[0] : callArg

    expect(insertedRecord).toBeDefined()
    expect(insertedRecord.workspace_id).toBe(mockWorkspaceId)
    expect(insertedRecord.profile_key).toBe('marketing_goal')
    expect(insertedRecord.status).toBe('review_required') // Non-silent confirmation
    expect(insertedRecord.confirmed_value).toBeNull() // Not confirmed
  })

  it('GET /api/onboarding/first-meeting rehydrates candidates from workspace_profile_candidates table', async () => {
    mockSelectCandidates.mockReturnValue([
      {
        id: 'cand-row-1',
        workspace_id: mockWorkspaceId,
        profile_key: 'marketing_goal',
        original_value: '인스타 홍보를 꾸준히 잘해줬으면 좋겠고',
        proposed_value: '인스타그램 홍보 및 피드 활성화',
        confirmed_value: null,
        status: 'review_required',
        evidence_quote: '인스타 홍보를 꾸준히 잘해줬으면 좋겠고, 말투는 너무 광고 같지 않았으면 해.',
        version: 1,
      },
    ])

    const res = await GET()
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.candidates).toHaveLength(1)
    expect(json.candidates[0].key).toBe('marketing_goal')
    expect(json.candidates[0].value).toBe('인스타그램 홍보 및 피드 활성화')
    expect(json.candidates[0].status).toBe('CANDIDATE')
  })
})
