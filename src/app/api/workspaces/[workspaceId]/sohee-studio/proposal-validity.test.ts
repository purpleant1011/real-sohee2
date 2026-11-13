import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const guard = vi.hoisted(() => vi.fn())
const decide = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/workspace-guard', () => ({ requireWorkspaceMembership: guard }))
vi.mock('@/features/sohee-studio/services/sohee-studio-service', () => ({ decideKnowledgeProposal: decide }))
import { POST } from './knowledge-proposals/[id]/decide/route'
const workspaceId = '10000000-0000-4000-8000-000000000001'
const id = '30000000-0000-4000-8000-000000000001'
const request = (body: unknown) => new NextRequest('http://localhost/decide', { method: 'POST', body: JSON.stringify(body) })

describe('proposal validity API', () => {
  it('forwards an owner-confirmed, timezone-qualified effective period', async () => {
    guard.mockResolvedValue({ ok: true, workspaceId, userId: 'owner', role: 'owner' })
    decide.mockResolvedValue({ success: true })
    const validity = { validFrom: '2026-11-01T00:00:00+09:00', validUntil: '2026-12-01T00:00:00+09:00' }
    const response = await POST(request({ decision: 'confirm', ...validity }), { params: Promise.resolve({ workspaceId, id }) })
    expect(response.status).toBe(200)
    expect(decide).toHaveBeenCalledWith(workspaceId, 'owner', id, 'confirm', undefined, undefined, validity)
  })
  it('rejects ambiguous dates without calling the service', async () => {
    vi.clearAllMocks()
    guard.mockResolvedValue({ ok: true, workspaceId, userId: 'owner', role: 'owner' })
    const response = await POST(request({ decision: 'confirm', validFrom: '2026-11-01' }), { params: Promise.resolve({ workspaceId, id }) })
    expect(response.status).toBe(400)
    expect(decide).not.toHaveBeenCalled()
  })
})
