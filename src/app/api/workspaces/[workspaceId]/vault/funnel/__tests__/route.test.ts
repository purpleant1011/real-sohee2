import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  record: vi.fn(),
  query: vi.fn(),
}))

vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: mocks.auth,
  isResponse: (val: any) => val instanceof Response,
}))

vi.mock('@/features/vault/funnel', () => ({
  recordVaultFunnelEvent: mocks.record,
  queryVaultFunnel: mocks.query,
  VAULT_FUNNEL_CHANNELS: ['instagram', 'threads', 'naver_blog', 'daangn_business'] as const,
}))

import { GET, POST } from '../route'

describe('/api/workspaces/[workspaceId]/vault/funnel route', () => {
  const workspaceId = '11111111-1111-4111-8111-111111111111'
  const params = Promise.resolve({ workspaceId })

  it('POST: rejects forbidden client events other than preview_opened', async () => {
    mocks.auth.mockResolvedValueOnce({
      workspaceId,
      userId: 'user-1',
      admin: {},
    })

    const req = new Request('http://localhost/api/workspaces/111/vault/funnel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'vault_saved', // Clients cannot spoof server-authoritative save
        channel: 'instagram',
        contentId: '22222222-2222-4222-8222-222222222222',
        versionId: '33333333-3333-4333-8333-333333333333',
      }),
    })

    const res = await POST(req, { params })
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toContain('미리보기 열림 이벤트만')
  })

  it('POST: records preview_opened successfully and returns 200 with dedupeKey', async () => {
    mocks.auth.mockResolvedValueOnce({
      workspaceId,
      userId: 'user-1',
      admin: {},
    })
    mocks.record.mockResolvedValueOnce({
      success: true,
      dedupeKey: 'preview_opened:instagram:222:333',
    })

    const req = new Request('http://localhost/api/workspaces/111/vault/funnel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'preview_opened',
        channel: 'instagram',
        contentId: '22222222-2222-4222-8222-222222222222',
        versionId: '33333333-3333-4333-8333-333333333333',
      }),
    })

    const res = await POST(req, { params })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.dedupeKey).toBe('preview_opened:instagram:222:333')
  })

  it('POST: ignores client dedupeKey and derives it server-side (B-2 flood guard)', async () => {
    mocks.record.mockClear()
    mocks.auth.mockResolvedValueOnce({ workspaceId, userId: 'user-1', admin: {} })
    mocks.record.mockResolvedValueOnce({ success: true, dedupeKey: 'x' })
    const base = { event: 'preview_opened', channel: 'instagram', contentId: '22222222-2222-4222-8222-222222222222', versionId: '33333333-3333-4333-8333-333333333333' }
    const res = await POST(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ ...base, dedupeKey: 'flood-1' }) }), { params })
    expect(res.status).toBe(422)
    expect(mocks.record).not.toHaveBeenCalled()
    mocks.auth.mockResolvedValueOnce({ workspaceId, userId: 'user-1', admin: {} })
    mocks.record.mockResolvedValueOnce({ success: true, dedupeKey: 'x' })
    await POST(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(base) }), { params })
    expect(mocks.record.mock.calls[0][0].dedupeKey).toBe(`preview_opened:${workspaceId}:instagram:${base.contentId}:${base.versionId}`)
  })

  it('POST: rejects personal content like title/text in payload', async () => {
    mocks.auth.mockResolvedValueOnce({
      workspaceId,
      userId: 'user-1',
      admin: {},
    })

    const req = new Request('http://localhost/api/workspaces/111/vault/funnel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'preview_opened',
        channel: 'instagram',
        contentId: '22222222-2222-4222-8222-222222222222',
        versionId: '33333333-3333-4333-8333-333333333333',
        title: '포스팅 제목 유출',
      }),
    })

    const res = await POST(req, { params })
    expect(res.status).toBe(422)
  })

  it('GET: queries funnel read model with period and channel', async () => {
    mocks.auth.mockResolvedValueOnce({
      workspaceId,
      userId: 'user-1',
      admin: {},
    })
    mocks.query.mockResolvedValueOnce({
      status: 'OK',
      workspaceId,
      channel: 'instagram',
      period: { from: '2026-10-01T00:00:00Z', to: '2026-10-07T23:59:59Z' },
      totalEvents: 10,
      stages: [],
      overallConversionRate: 50.0,
    })

    const req = new Request('http://localhost/api/workspaces/111/vault/funnel?from=2026-10-01T00:00:00Z&to=2026-10-07T23:59:59Z&channel=instagram')
    const res = await GET(req, { params })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('OK')
    expect(json.channel).toBe('instagram')
  })

  it('GET: rejects invalid date query parameters', async () => {
    mocks.auth.mockResolvedValueOnce({
      workspaceId,
      userId: 'user-1',
      admin: {},
    })

    const req = new Request('http://localhost/api/workspaces/111/vault/funnel?from=not-a-date&to=invalid')
    const res = await GET(req, { params })
    expect(res.status).toBe(422)
  })
})
