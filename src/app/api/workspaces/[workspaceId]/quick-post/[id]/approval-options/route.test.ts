import { describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), options: vi.fn(), readiness: vi.fn(), ensure: vi.fn() }))
vi.mock('@/features/quick-start/route-auth', () => ({ authorizeQuickRequest: mocks.authorize, isResponse: (v: unknown) => v instanceof Response }))
vi.mock('@/features/quick-start/quick-post-vault-contract', () => ({ getQuickPostApprovalOptions: mocks.options, ensureQuickPostVaultVersions: mocks.ensure, QuickPostVaultError: class QuickPostVaultError extends Error {} }))
vi.mock('@/features/quick-start/quick-post-approval-readiness', () => ({ readQuickPostApprovalReadiness: mocks.readiness }))
import { GET } from './route'
const request = new Request('http://localhost/api/workspaces/ws/quick-post/id/approval-options')
const ctx = { params: Promise.resolve({ workspaceId: 'ws', id: 'draft' }) }
describe('GET quick post approval options', () => {
  it('does not read foreign workspace data after authorization rejects it', async () => {
    mocks.authorize.mockResolvedValueOnce(new Response(JSON.stringify({ error: '찾을 수 없어요.' }), { status: 404 }))
    const response = await GET(request, ctx)
    expect(response.status).toBe(404)
    expect(mocks.options).not.toHaveBeenCalled()
    expect(mocks.readiness).not.toHaveBeenCalled()
  })
  it('returns server policy, canonical ids, and Korean reason fields without an external call', async () => {
    const admin = { from: vi.fn() }
    mocks.authorize.mockResolvedValue({ workspaceId: 'ws', admin, userId: 'owner' })
    mocks.readiness.mockResolvedValue({ stage: 'PREPARE_ONLY', verifiedChannels: [] })
    mocks.options.mockResolvedValue({ missionId: 'draft', revision: 1, targets: [{ channel: 'threads', contentId: 'content', versionId: 'version', handle: null, specLabel: '규격 확인 완료', actions: { VAULT: { allowed: true, message: null }, PUBLISH: { allowed: false, message: '채널을 연결하면 발행할 수 있어요' }, SCHEDULE: { allowed: false, message: '채널을 연결하면 발행할 수 있어요' } } }] })
    const response = await GET(request, ctx)
    expect(mocks.ensure).toHaveBeenCalledWith(admin, 'ws', 'owner', 'draft')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const body = await response.json()
    expect(body.targets[0]).toMatchObject({ contentId: 'content', versionId: 'version', actions: { VAULT: { allowed: true }, PUBLISH: { allowed: false, message: '채널을 연결하면 발행할 수 있어요' } } })
  })
  it('does not turn a database failure into an empty list or expose internal error codes', async () => {
    mocks.authorize.mockResolvedValue({ workspaceId: 'ws', admin: {} })
    mocks.readiness.mockRejectedValueOnce(new Error('private secret'))
    const response = await GET(request, ctx)
    expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain('private secret')
  })
})
