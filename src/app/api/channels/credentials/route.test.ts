import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { disconnectChannelConnection, saveConnectedChannel } from '@/features/channels/credential-repository'
import { createServerSupabaseClient } from '@/lib/supabase/server'

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))
vi.mock('@/features/channels/credential-repository', () => ({
  disconnectChannelConnection: vi.fn(), saveConnectedChannel: vi.fn(),
}))

const selected = '10000000-0000-4000-8000-000000000001'
const other = '10000000-0000-4000-8000-000000000002'

function session({ authenticated = true, active = true, failed = false, role = 'owner' } = {}) {
  const reads: string[] = []
  vi.mocked(createServerSupabaseClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'owner' } : null } }) },
    from: (table: string) => {
      const filters: Record<string, string> = {}
      const result = () => table === 'workspace_members'
        ? { data: filters.workspace_id === selected
          ? { workspace_id: selected, role, status: active ? 'active' : 'disabled' }
          : [{ workspace_id: other, role: 'owner', status: 'active' }], error: failed ? { message: 'lookup failed' } : null }
        : { data: [{ channel: 'instagram', account_label: filters.workspace_id === selected ? '@selected' : '@other' }], error: null }
      const query = {
        select: () => query,
        eq: (key: string, value: string) => {
          filters[key] = value
          if (table === 'channel_connections' && key === 'workspace_id') reads.push(value)
          return query
        },
        limit: async () => result(),
        maybeSingle: async () => result(),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      }
      return query
    },
  } as unknown as Awaited<ReturnType<typeof createServerSupabaseClient>>)
  return reads
}

beforeEach(() => vi.clearAllMocks())

function post(body: Record<string, unknown>) {
  return POST(new NextRequest('https://example.com/api/channels/credentials', {
    method: 'POST',
    body: JSON.stringify({ workspaceId: selected, channelId: 'INSTAGRAM', ...body }),
    headers: { 'content-type': 'application/json' },
  }))
}

describe('channel credentials write workspace boundary', () => {
  it('disconnects only the explicitly selected active workspace', async () => {
    session()
    const response = await post({ action: 'disconnect' })
    expect(response.status).toBe(200)
    expect(disconnectChannelConnection).toHaveBeenCalledWith(selected, 'owner', 'owner', 'instagram')
  })

  for (const options of [{ active: false }, { role: 'viewer' }, { role: 'reviewer' }]) {
    it(`rejects a channel mutation for ${JSON.stringify(options)}`, async () => {
      session(options)
      const response = await post({ action: 'disconnect' })
      expect(response.status).toBe(403)
      expect(disconnectChannelConnection).not.toHaveBeenCalled()
      expect(createAdminSupabaseClient).not.toHaveBeenCalled()
    })
  }

  it('does not write when workspace lookup fails', async () => {
    session({ failed: true })
    const response = await post({ action: 'disconnect' })
    expect(response.status).toBe(500)
    expect(disconnectChannelConnection).not.toHaveBeenCalled()
  })

  it('rejects unverified manual tokens even when account identity is supplied', async () => {
    session()
    const response = await post({
      action: 'bind_provider_token', accessToken: 'unverified-test-token',
      externalAccountId: 'claimed-id', accountLabel: '@claimed',
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'OAUTH_REQUIRED' })
    expect(saveConnectedChannel).not.toHaveBeenCalled()
    expect(createAdminSupabaseClient).not.toHaveBeenCalled()
  })
})

describe('channel credentials read workspace boundary', () => {
  it('reads the explicitly authorized workspace rather than the first membership', async () => {
    const reads = session()
    const response = await GET(new NextRequest(`https://example.com/api/channels/credentials?workspaceId=${selected}`))
    expect(response.status).toBe(200)
    expect((await response.json()).connections).toEqual([{ channel: 'instagram', account_label: '@selected' }])
    expect(reads).toEqual([selected])
  })

  for (const scenario of [
    { options: { authenticated: false }, status: 401 },
    { options: { active: false }, status: 403 },
    { options: { failed: true }, status: 500 },
  ]) {
    it(`does not read credentials when authorization fails with ${scenario.status}`, async () => {
      const reads = session(scenario.options)
      const response = await GET(new NextRequest(`https://example.com/api/channels/credentials?workspaceId=${selected}`))
      expect(response.status).toBe(scenario.status)
      expect(reads).toEqual([])
    })
  }
})
