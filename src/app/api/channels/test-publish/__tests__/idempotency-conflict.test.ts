import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ActionRequestConflictError } from '@/lib/external-actions/action-request-contract'

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('@/lib/external-actions/meta-action-executor', () => ({ executeMetaPublish: mocks.execute }))
vi.mock('@/features/sohee-ready/admission-guard', () => ({ requireSoheeReady: vi.fn().mockResolvedValue({}) }))
vi.mock('@/lib/safety/kill-switch-guard', () => ({ checkKillSwitchPreflight: vi.fn().mockResolvedValue({ blocked: false }) }))
vi.mock('@/lib/safety/meta-live-allowlist', () => ({ isMetaLiveAllowed: () => true }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'actor' } } }) },
  from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [{ workspace_id: 'workspace' }] }) }) }) }),
}) }))
import { POST } from '../route'

describe('test publish HTTP idempotency boundary', () => {
  beforeEach(() => vi.clearAllMocks())
  it('passes the caller key and preserves a domain conflict as HTTP 409', async () => {
    mocks.execute.mockRejectedValueOnce(new ActionRequestConflictError())
    const response = await POST(new Request('http://localhost/api/channels/test-publish', {
      method: 'POST', body: JSON.stringify({ channelId: 'INSTAGRAM', idempotencyKey: 'stable-key' }),
    }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ errorCode: 'IDEMPOTENCY_CONFLICT' })
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'workspace', actorUserId: 'actor', idempotencyKey: 'stable-key' }))
  })
  it.each([['SUCCEEDED', 200], ['EXECUTING', 202], ['RESULT_UNKNOWN', 202]])('maps reused %s to HTTP %s without treating it as a rejected request', async (status, expected) => {
    mocks.execute.mockResolvedValueOnce({ status })
    const response = await POST(new Request('http://localhost/api/channels/test-publish', {
      method: 'POST', body: JSON.stringify({ channelId: 'INSTAGRAM', idempotencyKey: 'stable-key' }),
    }))
    expect(response.status).toBe(expected)
  })
  it('does not expose unrelated persistence failures as conflicts', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('database unavailable'))
    const response = await POST(new Request('http://localhost/api/channels/test-publish', {
      method: 'POST', body: JSON.stringify({ channelId: 'INSTAGRAM', idempotencyKey: 'key' }),
    }))
    expect(response.status).toBe(500)
  })
})
