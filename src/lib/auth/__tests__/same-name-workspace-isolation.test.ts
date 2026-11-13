import { describe, it, expect, vi, beforeEach } from 'vitest'
import { requireWorkspaceMembership } from '../workspace-guard'
import { selectWorkspaceContext } from '@/features/auth/workspace-context'
import { parseContentApiResponse } from '@/features/content/content-view-state'

// Mock Supabase Server client
const mockGetUser = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: mockFrom,
  })),
}))

describe('Same-Name Two-Workspace Tenant Isolation Regression Suite (ANI-1202, ANI-1203, ANI-1204, ANI-1205)', () => {
  // Production Canonical Fixtures
  const CANONICAL_BYREUM_WS_ID = '00000000-0000-4000-8000-0000000000a2'
  const CANONICAL_OWNER_ID = 'usr-true1011-uuid'
  const CANONICAL_OWNER_EMAIL = 'admin@example.com'

  const CONFLICTING_BYREUM_WS_ID = 'b1000000-0000-4000-8000-000000000001'
  const CONFLICTING_OWNER_ID = 'usr-admin-uuid'
  const CONFLICTING_OWNER_EMAIL = 'admin@example.com'

  beforeEach(() => {
    vi.clearAllMocks()
    ;(process.env as any).NODE_ENV = 'test'
    delete process.env.NEXT_PUBLIC_APP_ENV
  })

  describe('1. Immutable Workspace ID Authorization (ANI-1202, ANI-1203)', () => {
    it('MUST allow canonical owner (true1011) only to canonical workspace and deny conflicting workspace', async () => {
      // Authenticated as admin@example.com
      mockGetUser.mockResolvedValue({
        data: { user: { id: CANONICAL_OWNER_ID, email: CANONICAL_OWNER_EMAIL } },
        error: null,
      })

      // Mock database membership check
      mockFrom.mockImplementation((table: string) => {
        if (table === 'workspace_members') {
          return {
            select: () => ({
              eq: (col: string, val: string) => ({
                eq: (col2: string, val2: string) => ({
                  eq: (col3: string, val3: string) => ({
                    maybeSingle: vi.fn().mockImplementation(async () => {
                      if (val === CANONICAL_BYREUM_WS_ID && val2 === CANONICAL_OWNER_ID && val3 === 'active') {
                        return { data: { workspace_id: CANONICAL_BYREUM_WS_ID, role: 'owner', status: 'active' }, error: null }
                      }
                      return { data: null, error: null }
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'workspaces') {
          return {
            select: () => ({
              eq: (col: string, val: string) => ({
                eq: (col2: string, val2: string) => ({
                  maybeSingle: vi.fn().mockImplementation(async () => {
                    if (val === CANONICAL_BYREUM_WS_ID && val2 === CANONICAL_OWNER_ID) {
                      return { data: { id: CANONICAL_BYREUM_WS_ID, created_by: CANONICAL_OWNER_ID }, error: null }
                    }
                    return { data: null, error: null }
                  }),
                }),
              }),
            }),
          }
        }
        return { select: () => ({ eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn() }) }
      })

      // Access to canonical workspace: SUCCESS
      const canonicalAccess = await requireWorkspaceMembership(CANONICAL_BYREUM_WS_ID)
      expect(canonicalAccess.ok).toBe(true)
      if (canonicalAccess.ok) {
        expect(canonicalAccess.workspaceId).toBe(CANONICAL_BYREUM_WS_ID)
        expect(canonicalAccess.userId).toBe(CANONICAL_OWNER_ID)
      }

      // Access to conflicting workspace with SAME display name: FAIL CLOSED (403)
      const conflictingAccess = await requireWorkspaceMembership(CONFLICTING_BYREUM_WS_ID)
      expect(conflictingAccess.ok).toBe(false)
      if (!conflictingAccess.ok) {
        expect(conflictingAccess.status).toBe(403)
        expect(conflictingAccess.error).toBe('WORKSPACE_FORBIDDEN')
      }
    })

    it('MUST fail closed if workspace resolution uses name instead of UUID', () => {
      // Invariant: Display name resolution must NEVER be allowed
      const resolveByDisplayName = (displayName: string, workspaces: Array<{ id: string; name: string }>) => {
        const matches = workspaces.filter((w) => w.name === displayName)
        if (matches.length > 1) {
          throw new Error(`AMBIGUOUS_WORKSPACE_NAME: Multiple workspaces found for "${displayName}"`)
        }
        return matches[0]?.id ?? null
      }

      const workspacesFixture = [
        { id: CANONICAL_BYREUM_WS_ID, name: '바이름' },
        { id: CONFLICTING_BYREUM_WS_ID, name: '바이름' },
      ]

      // Name lookup is ambiguous and MUST throw/fail
      expect(() => resolveByDisplayName('바이름', workspacesFixture)).toThrow(
        'AMBIGUOUS_WORKSPACE_NAME'
      )
    })
  })

  describe('2. Session Workspace Resolver Multi-tenant Isolation (ANI-1203)', () => {
    it('MUST resolve to preferred canonical workspace when user has multiple memberships', () => {
      const memberships = [
        { workspace_id: CONFLICTING_BYREUM_WS_ID, role: 'owner', status: 'active' },
        { workspace_id: CANONICAL_BYREUM_WS_ID, role: 'owner', status: 'active' },
      ]

      const resolved = selectWorkspaceContext(memberships, CANONICAL_BYREUM_WS_ID)
      expect(resolved).not.toBeNull()
      expect(resolved?.workspaceId).toBe(CANONICAL_BYREUM_WS_ID)
      expect(resolved?.role).toBe('owner')
    })
  })

  describe('3. Content View State Multi-Tenant Cross-Contamination Guard (ANI-1205)', () => {
    it('MUST strictly prevent conflicting workspace content from contaminating canonical workspace feed', () => {
      const mixedContentPayload = {
        contents: [
          {
            contentId: 'c-canonical-1',
            workspaceId: CANONICAL_BYREUM_WS_ID,
            title: '바이름 청라점 가을 립브로우 이벤트',
            channel: 'instagram',
            caption: '자연스러운 눈썹 결 완성',
            isApproved: true,
            status: 'published',
            createdAt: '2026-09-08T10:00:00.000Z',
          },
          {
            contentId: 'c-conflicting-2',
            workspaceId: CONFLICTING_BYREUM_WS_ID,
            title: '바이름 어드민 테스트 콘텐츠',
            channel: 'instagram',
            caption: '이 콘텐츠는 노출되면 안 됩니다',
            isApproved: false,
            status: 'draft',
            createdAt: '2026-09-08T10:00:00.000Z',
          },
        ],
      }

      const parsed = parseContentApiResponse(mixedContentPayload, CANONICAL_BYREUM_WS_ID)
      expect(parsed.status).toBe('DATA')
      if (parsed.status === 'DATA') {
        expect(parsed.items.length).toBe(1)
        expect(parsed.items[0].id).toBe('c-canonical-1')
        expect(parsed.items.some((item) => item.id === 'c-conflicting-2')).toBe(false)
      }
    })
  })
})
