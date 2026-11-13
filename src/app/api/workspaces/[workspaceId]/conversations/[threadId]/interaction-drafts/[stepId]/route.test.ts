import { describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import type { ServerSupabaseClient } from '@/features/operations/types'
import { createInteractionDraftReviewGetHandler } from '@/features/chat/interaction-draft-review-request.server'
vi.mock('server-only', () => ({}))
vi.mock('@/features/quick-start/route-auth', () => ({ authorizeQuickRequest: vi.fn(), isResponse: (value: unknown) => value instanceof Response }))
vi.mock('@/features/chat/interaction-draft-review.server', () => ({ loadInteractionDraftReview: vi.fn() }))
const workspaceId = '20000000-0000-4000-8000-000000000001'
const threadId = '30000000-0000-4000-8000-000000000001'
const stepId = '40000000-0000-4000-8000-000000000001'
const client = {} as ServerSupabaseClient
const context = { params: Promise.resolve({ workspaceId, threadId, stepId }) }
const payload = { snapshot: { kind: 'interaction_draft', workspaceId, targetKind: 'comment',
  targetId: '60000000-0000-4000-8000-000000000001', draftId: '70000000-0000-4000-8000-000000000001', draftText: '상담 후 안내드릴게요.',
  fingerprint: 'a'.repeat(64), sourceRef: 'b'.repeat(64), channel: 'threads', customerLabel: '문의 고객',
  preparedAt: '2026-10-29T12:00:00Z', reused: false, requiresUserApproval: true },
  sourceText: '가격 문의', currentDraftText: '상담 후 안내드릴게요.', canSend: true, reason: null, observedAt: '2026-10-30T00:00:00Z' }
const request = new Request('https://example.com/api/review')
describe('private fresh conversation draft review GET', () => {
  it('wires the production route to fresh manager authorization', async () => {
    const { authorizeQuickRequest } = await import('@/features/quick-start/route-auth')
    vi.mocked(authorizeQuickRequest).mockResolvedValueOnce(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    const { GET } = await import('./route')
    expect((await GET(request, context)).status).toBe(403)
    expect(authorizeQuickRequest).toHaveBeenCalledWith(workspaceId, { requireRole: 'manager' })
  })
  it('uses the actual authorized workspace and returns a no-store review only', async () => {
    const load = vi.fn().mockResolvedValue(payload)
    const handler = createInteractionDraftReviewGetHandler({ authorize: async () => ({ workspaceId, client }), load })
    const response = await handler(request, context)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.json()).toMatchObject({ data: payload })
    expect(load).toHaveBeenCalledExactlyOnceWith({ workspaceId, threadId, stepId, client })
  })
  it('preserves auth denial without reading source data and prevents caching the denial', async () => {
    const load = vi.fn()
    const handler = createInteractionDraftReviewGetHandler({ authorize: async () => new Response('forbidden', { status: 403 }), load })
    const response = await handler(request, context)
    expect(response.status).toBe(403)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(load).not.toHaveBeenCalled()
  })
  it('does not expose a foreign result or raw database error', async () => {
    for (const value of [{ ...payload, snapshot: { ...payload.snapshot, workspaceId: '21000000-0000-4000-8000-000000000001' } }, new Error('private sql detail')]) {
      const load = vi.fn().mockImplementation(async () => { if (value instanceof Error) throw value; return value })
      const handler = createInteractionDraftReviewGetHandler({ authorize: async () => ({ workspaceId, client }), load })
      const response = await handler(request, context)
      expect(response.status).toBe(503)
      expect(response.headers.get('cache-control')).toContain('no-store')
      expect(await response.text()).not.toMatch(/private sql detail|21000000/)
    }
  })
  it('rejects malformed identifiers before any privileged access', async () => {
    const authorize = vi.fn()
    const handler = createInteractionDraftReviewGetHandler({ authorize, load: vi.fn() })
    expect((await handler(request, { params: Promise.resolve({ workspaceId, threadId, stepId: 'bad' }) })).status).toBe(400)
    expect(authorize).not.toHaveBeenCalled()
  })
})
