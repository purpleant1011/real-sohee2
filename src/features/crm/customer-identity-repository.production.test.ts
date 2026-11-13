import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser }, from: mocks.from })),
}))
import { lookupPersistedCustomerIdentity, getPersistedCustomerIdentity } from './customer-identity-repository'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const customerId = '20000000-0000-4000-8000-000000000001'
const userId = '30000000-0000-4000-8000-000000000001'
const subject = 'External-ID-1'
const hash = createHash('sha256').update(subject).digest('hex')
const record = { id: customerId, workspace_id: workspaceId, channel: 'instagram', external_subject_reference_hash: hash }
function query(data: unknown, error: unknown = null) {
  const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data, error }) }
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null })
})

describe('production identity reader uses session auth plus durable scoped SELECT', () => {
  it('adds workspace/user/active predicates before subject lookup and uses no service role', async () => {
    const membership = query({ workspace_id: workspaceId, user_id: userId, status: 'active' })
    const identity = query(record)
    mocks.from.mockImplementation(table => table === 'workspace_members' ? membership : identity)
    expect((await lookupPersistedCustomerIdentity({ workspaceId, channel: 'instagram', externalSubjectId: subject })).status).toBe('FOUND')
    expect(mocks.getUser).toHaveBeenCalledTimes(1)
    expect(membership.eq.mock.calls).toEqual([['workspace_id', workspaceId], ['user_id', userId], ['status', 'active']])
    expect(identity.eq.mock.calls).toEqual([['workspace_id', workspaceId], ['channel', 'instagram'], ['external_subject_reference_hash', hash]])
    expect(mocks.from.mock.calls).toEqual([['workspace_members'], ['customer_conversations']])
  })
  it('does not read the identity table when authenticated membership is absent', async () => {
    const membership = query(null)
    mocks.from.mockReturnValue(membership)
    expect(await lookupPersistedCustomerIdentity({ workspaceId, channel: 'instagram', externalSubjectId: subject })).toEqual({ status: 'FORBIDDEN' })
    expect(mocks.from.mock.calls).toEqual([['workspace_members']])
  })
  it('does not grant a demo-email bypass or trust a foreign membership row', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId, email: 'test@example.com' } }, error: null })
    mocks.from.mockReturnValue(query({ workspace_id: '10000000-0000-4000-8000-000000000002', user_id: userId, status: 'active' }))
    expect(await getPersistedCustomerIdentity(workspaceId, customerId)).toEqual({ status: 'FORBIDDEN' })
    expect(mocks.from.mock.calls).toEqual([['workspace_members']])
  })
  it('does not query after auth verification errors', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: new Error('fixture auth error') })
    expect(await getPersistedCustomerIdentity(workspaceId, customerId)).toEqual({ status: 'FORBIDDEN' })
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('scopes known-customer ID lookup to workspace, not a bare ID', async () => {
    const membership = query({ workspace_id: workspaceId, user_id: userId, status: 'active' })
    const identity = query(record)
    mocks.from.mockImplementation(table => table === 'workspace_members' ? membership : identity)
    expect((await getPersistedCustomerIdentity(workspaceId, customerId)).status).toBe('FOUND')
    expect(identity.eq.mock.calls).toEqual([['workspace_id', workspaceId], ['id', customerId]])
  })
})
