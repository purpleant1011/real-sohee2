import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import { AgentControlPlaneService } from '@/features/marketing-agent/engine/agent-control-state'
import { createServerSupabaseClient } from '@/lib/supabase/server'

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }))
vi.mock('@/lib/auth/workspace-guard', () => ({
  requireWorkspaceMembership: vi.fn(),
}))

describe('GET /api/workspaces/[workspaceId]/agent/workboard (ANI-909)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    AgentControlPlaneService.resetForTest('ws-1')
    // Workboard must read an explicit safety result; a real network request with
    // placeholder credentials fails closed and cannot represent the RUNNING case.
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      from: (table: string) => {
        if (table === 'kill_switches') return { select: () => ({ eq: async () => ({ data: [], error: null }) }) }
        if (table === 'audit_events') return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) }
        throw new Error(`Unexpected workboard table: ${table}`)
      },
    } as never)
  })

  it('returns 401 when user is not authenticated', async () => {
    const { requireWorkspaceMembership } = await import('@/lib/auth/workspace-guard')
    vi.mocked(requireWorkspaceMembership).mockResolvedValueOnce({
      ok: false,
      status: 401,
      error: 'AUTH_REQUIRED',
      message: '인증이 필요합니다.',
    })

    const req = new NextRequest('http://localhost:3000/api/workspaces/ws-1/agent/workboard')
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })

    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('AUTH_REQUIRED')
  }, 30000)

  it('returns canonical WorkboardSnapshot with Cache-Control: no-store', async () => {
    const { requireWorkspaceMembership } = await import('@/lib/auth/workspace-guard')
    vi.mocked(requireWorkspaceMembership).mockResolvedValueOnce({
      ok: true,
      userId: 'user-1',
      role: 'owner',
      workspaceId: 'ws-1',
    })

    AgentControlPlaneService.setDesiredMode('ws-1', 'RUNNING', 'user-1')

    const req = new NextRequest('http://localhost:3000/api/workspaces/ws-1/agent/workboard')
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })

    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')

    const snapshot = await res.json()
    expect(snapshot.workspaceId).toBe('ws-1')
    expect(snapshot.runtimeState).toBe('RUNNING')
    expect(snapshot.appliedRules).toBeInstanceOf(Array)
    expect(snapshot.freshness).toBeDefined()
  }, 30000)

  it('does not turn an internal content approval audit into verified external execution proof', async () => {
    const { requireWorkspaceMembership } = await import('@/lib/auth/workspace-guard')
    vi.mocked(requireWorkspaceMembership).mockResolvedValueOnce({ ok: true, userId: 'user-1', role: 'owner', workspaceId: 'ws-1' })
    vi.mocked(createServerSupabaseClient).mockResolvedValueOnce({
      from: (table: string) => {
        if (table === 'kill_switches') return { select: () => ({ eq: async () => ({ data: [], error: null }) }) }
        if (table === 'audit_events') return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({
          data: { id: 'audit-approval', event_type: 'content.approved', created_at: '2026-11-02T10:00:00Z', metadata: {} }, error: null,
        }) }) }) }) }) }
        throw new Error(`Unexpected workboard table: ${table}`)
      },
    } as never)
    const res = await GET(new NextRequest('http://localhost:3000/api/workspaces/ws-1/agent/workboard'), { params: Promise.resolve({ workspaceId: 'ws-1' }) })
    expect((await res.json()).lastProof?.verificationState).not.toBe('VERIFIED')
  })

  it('remains BLOCKED if the kill-switch read fails, instead of presenting a false RUNNING state', async () => {
    const { requireWorkspaceMembership } = await import('@/lib/auth/workspace-guard')
    vi.mocked(requireWorkspaceMembership).mockResolvedValueOnce({ ok: true, userId: 'user-1', role: 'owner', workspaceId: 'ws-1' })
    vi.mocked(createServerSupabaseClient).mockResolvedValueOnce({
      from: (table: string) => {
        if (table === 'kill_switches') return { select: () => ({ eq: async () => ({ data: null, error: { message: 'database unavailable' } }) }) }
        throw new Error(`Unexpected workboard table: ${table}`)
      },
    } as never)
    AgentControlPlaneService.setDesiredMode('ws-1', 'RUNNING', 'user-1')
    const res = await GET(new NextRequest('http://localhost:3000/api/workspaces/ws-1/agent/workboard'), { params: Promise.resolve({ workspaceId: 'ws-1' }) })
    expect(res.status).toBe(200)
    expect((await res.json()).runtimeState).toBe('BLOCKED')
  })
})
