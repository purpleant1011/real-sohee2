import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
const load = vi.hoisted(() => vi.fn())
vi.mock('@/features/chat/conversation-operation-catalog-request.server', () => ({ loadAuthorizedConversationCatalog: load }))
vi.mock('@/features/quick-start/route-auth', () => ({ isResponse: (value: unknown) => value instanceof NextResponse }))
import { GET } from './route'
const scope = { params: Promise.resolve({ workspaceId: '20000000-0000-4000-8000-000000000001' }) }
beforeEach(() => vi.clearAllMocks())

describe('private conversation capability discovery', () => {
  it('returns the authorized workspace catalog without caching it', async () => {
    load.mockResolvedValue({ workspaceId: '20000000-0000-4000-8000-000000000001', items: [] })
    const response = await GET(new Request('https://sohee.test/api'), scope)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(load).toHaveBeenCalledWith('20000000-0000-4000-8000-000000000001')
    expect(await response.json()).toMatchObject({ data: { items: [] } })
  })
  it.each([401, 403, 503])('does not cache or replace a failed authorization/readiness response (%s)', async status => {
    load.mockResolvedValue(NextResponse.json({ error: '조회하지 못했어요.' }, { status }))
    const response = await GET(new Request('https://sohee.test/api'), scope)
    expect(response.status).toBe(status)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).not.toHaveProperty('data')
  })
})
