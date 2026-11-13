import { expect, it, vi } from 'vitest'
import {
  createConversationWorkStatusGetHandler,
  createProductionConversationWorkStatusGetHandler,
} from './route'

it('returns an authorized no-store workspace status snapshot', async () => {
  const workspaceId = '10000000-0000-4000-8000-000000000001'
  const response = await createConversationWorkStatusGetHandler({
    authenticate: async () => '20000000-0000-4000-8000-000000000001',
    authorize: async () => true,
    load: async () => ({ activeJobCount: 2, attentionThreadCount: 1, threads: [], creditBalance: { available: 1253, weeklyLimit: 2000 }, observedAt: '2026-08-22T14:00:00.000Z' }),
  })(new Request('https://sohee.test/status'), { params: Promise.resolve({ workspaceId }) })
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  await expect(response.json()).resolves.toMatchObject({ data: { creditBalance: { available: 1253, weeklyLimit: 2000 } } })
})

it('creates one Supabase request scope and lets the status RPC enforce workspace membership', async () => {
  const getClaims = vi.fn(async () => ({
    data: { claims: { sub: '20000000-0000-4000-8000-000000000001' } },
    error: null,
  }))
  const rpc = vi.fn(async () => ({
    data: { activeJobCount: 0, attentionThreadCount: 0, threads: [], creditBalance: { available: 1253, weeklyLimit: 2000 }, observedAt: '2026-08-22T14:00:00.000Z' },
    error: null,
  }))
  const createClient = vi.fn(async () => ({ auth: { getClaims }, rpc }))
  const handler = createProductionConversationWorkStatusGetHandler({ createClient })

  const response = await handler(
    new Request('https://sohee.test/status'),
    { params: Promise.resolve({ workspaceId: '10000000-0000-4000-8000-000000000001' }) },
  )

  expect(response.status).toBe(200)
  expect(createClient).toHaveBeenCalledOnce()
  expect(getClaims).toHaveBeenCalledOnce()
  expect(rpc).toHaveBeenCalledOnce()
  expect(rpc).toHaveBeenCalledWith('get_conversation_work_status_v2', {
    p_workspace_id: '10000000-0000-4000-8000-000000000001',
  })
})

it('maps the membership-enforcing status RPC denial to a forbidden response', async () => {
  const createClient = vi.fn(async () => ({
    auth: { getClaims: async () => ({ data: { claims: { sub: '20000000-0000-4000-8000-000000000001' } }, error: null }) },
    rpc: async () => ({ data: null, error: { code: '42501' } }),
  }))
  const handler = createProductionConversationWorkStatusGetHandler({ createClient })

  const response = await handler(
    new Request('https://sohee.test/status'),
    { params: Promise.resolve({ workspaceId: '10000000-0000-4000-8000-000000000001' }) },
  )

  expect(response.status).toBe(403)
})

it('returns a retry-safe service response when the request-scoped client is unavailable', async () => {
  const handler = createProductionConversationWorkStatusGetHandler({
    createClient: async () => { throw new Error('temporary connection failure') },
  })

  const response = await handler(
    new Request('https://sohee.test/status'),
    { params: Promise.resolve({ workspaceId: '10000000-0000-4000-8000-000000000001' }) },
  )

  expect(response.status).toBe(503)
  await expect(response.json()).resolves.toEqual({ error: { code: 'WORK_STATUS_UNAVAILABLE' } })
})
