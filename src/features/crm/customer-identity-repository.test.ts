import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { getPersistedCustomerIdentity, lookupPersistedCustomerIdentity, type CustomerIdentityGateway } from './customer-identity-repository'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const customerId = '20000000-0000-4000-8000-000000000001'
const input = { workspaceId, channel: 'instagram' as const, externalSubjectId: 'External-ID-1' }
const hash = createHash('sha256').update(input.externalSubjectId).digest('hex')
const row = { id: customerId, workspace_id: workspaceId, channel: 'instagram', external_subject_reference_hash: hash }
function gateway(data: unknown = row): CustomerIdentityGateway {
  return { authorizeWorkspace: vi.fn().mockResolvedValue(true), findBySubject: vi.fn().mockResolvedValue({ data, error: null }), findById: vi.fn().mockResolvedValue({ data, error: null }) }
}

describe('durable workspace-scoped identity reads, never process Map SSOT', () => {
  it('uses existing canonical subject hashing and passes tenant scope to persistent query', async () => {
    const db = gateway()
    const result = await lookupPersistedCustomerIdentity({ ...input, externalSubjectId: ' External-ID-1 ' }, db)
    expect(result).toEqual({ status: 'FOUND', identity: { workspaceId, customerId, channel: 'instagram' } })
    expect(db.authorizeWorkspace).toHaveBeenCalledWith(workspaceId)
    expect(db.findBySubject).toHaveBeenCalledWith(workspaceId, 'instagram', hash)
    expect(JSON.stringify(result)).not.toContain(hash)
    expect(JSON.stringify(result)).not.toContain(input.externalSubjectId)
  })
  it('queries fresh persistence and authorization on every call instead of caching identities', async () => {
    const db = gateway()
    expect((await lookupPersistedCustomerIdentity(input, db)).status).toBe('FOUND')
    vi.mocked(db.findBySubject).mockResolvedValue({ data: null, error: null })
    expect((await lookupPersistedCustomerIdentity(input, db)).status).toBe('NOT_OBSERVED')
    expect(db.authorizeWorkspace).toHaveBeenCalledTimes(2)
    expect(db.findBySubject).toHaveBeenCalledTimes(2)
  })
  it('does not query identities without active workspace authorization', async () => {
    const db = gateway()
    vi.mocked(db.authorizeWorkspace).mockResolvedValue(false)
    expect(await lookupPersistedCustomerIdentity(input, db)).toEqual({ status: 'FORBIDDEN' })
    expect(db.findBySubject).not.toHaveBeenCalled()
  })
  it.each([{ workspace_id: '10000000-0000-4000-8000-000000000002' }, { channel: 'threads' }, { external_subject_reference_hash: 'b'.repeat(64) }])('does not return a row outside the requested identity scope %j', async change => {
    expect(await lookupPersistedCustomerIdentity(input, gateway({ ...row, ...change }))).toEqual({ status: 'ERROR' })
  })
  it('keeps lookup errors distinct from genuinely absent identities', async () => {
    const db = gateway()
    vi.mocked(db.findBySubject).mockResolvedValue({ data: null, error: new Error('fixture unavailable') })
    expect(await lookupPersistedCustomerIdentity(input, db)).toEqual({ status: 'ERROR' })
    expect(await lookupPersistedCustomerIdentity(input, gateway(null))).toEqual({ status: 'NOT_OBSERVED' })
  })
  it('requires scope on ID lookup and checks returned ID and workspace', async () => {
    const db = gateway()
    expect((await getPersistedCustomerIdentity(workspaceId, customerId, db)).status).toBe('FOUND')
    expect(db.findById).toHaveBeenCalledWith(workspaceId, customerId)
    expect(await getPersistedCustomerIdentity(workspaceId, customerId, gateway({ ...row, id: '20000000-0000-4000-8000-000000000002' }))).toEqual({ status: 'ERROR' })
    expect(await getPersistedCustomerIdentity(workspaceId, customerId, gateway({ ...row, workspace_id: '10000000-0000-4000-8000-000000000002' }))).toEqual({ status: 'ERROR' })
  })
  it('rejects unsupported contracts and malformed scopes before querying', async () => {
    const db = gateway()
    expect(await lookupPersistedCustomerIdentity({ ...input, channel: 'kakao' }, db)).toEqual({ status: 'ERROR' })
    expect(await lookupPersistedCustomerIdentity({ ...input, workspaceId: '' }, db)).toEqual({ status: 'ERROR' })
    expect(await getPersistedCustomerIdentity('', customerId, db)).toEqual({ status: 'ERROR' })
    expect(db.authorizeWorkspace).not.toHaveBeenCalled()
  })
  it('does not fall back to memory when workspace authorization throws', async () => {
    const db = gateway()
    vi.mocked(db.authorizeWorkspace).mockRejectedValue(new Error('fixture failure'))
    expect(await lookupPersistedCustomerIdentity(input, db)).toEqual({ status: 'ERROR' })
    expect(db.findBySubject).not.toHaveBeenCalled()
  })
})
