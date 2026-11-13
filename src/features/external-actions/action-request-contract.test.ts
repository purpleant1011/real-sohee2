import { describe, expect, it, vi } from 'vitest'
import { CanonicalActionLedgerService } from './canonical-action-ledger'
import { ActionRequestConflictError } from '@/lib/external-actions/action-request-contract'
import { PersistenceError } from '@/lib/errors/persistence-error'

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }))

const input = {
  workspaceId: 'workspace', channel: 'instagram' as const, actionKind: 'feed_publish' as const,
  targetExternalId: 'account', targetLabel: '@account', exactPayload: { text: 'hello', nested: { b: 2, a: 1 }, media: ['a', 'b'] },
  contentVersionId: 'version', approvalId: 'approval', approvalFingerprint: 'fingerprint', idempotencyKey: 'key',
}
const stored = {
  id: 'request', status: 'prepared', workspace_id: input.workspaceId, channel: input.channel, action_kind: input.actionKind,
  target_external_id: input.targetExternalId, exact_payload: input.exactPayload,
  content_version_id: input.contentVersionId, approval_id: input.approvalId, approval_fingerprint: input.approvalFingerprint, idempotency_key: 'key',
}
function database(lookups: Array<{ data: unknown; error: unknown }>, mutation = { data: null as unknown, error: { code: '23505' } as unknown }) {
  const maybeSingle = vi.fn()
  for (const result of lookups) maybeSingle.mockResolvedValueOnce(result)
  const query: any = { select: vi.fn(() => query), eq: vi.fn(() => query), maybeSingle,
    single: vi.fn().mockResolvedValue(mutation) }
  const insert = vi.fn(() => query)
  return { from: vi.fn(() => ({ ...query, insert })), insert, query }
}

describe('ANI-1805 approval-bound durable idempotency', () => {
  it('reuses semantically equal JSON with different object key order', async () => {
    const db = database([{ data: { ...stored, exact_payload: { media: ['a', 'b'], nested: { a: 1, b: 2 }, text: 'hello' } }, error: null }])
    await expect(CanonicalActionLedgerService.createActionRequest({ ...input, adminClient: db })).resolves.toMatchObject({ requestId: 'request', isExisting: true })
    expect(db.insert).not.toHaveBeenCalled()
    expect(db.query.eq).toHaveBeenCalledWith('workspace_id', input.workspaceId)
  })

  it('uses a total key ordering even for canonically equivalent Unicode keys', async () => {
    const db = database([{ data: { ...stored, exact_payload: { 'é': 1, 'é': 2 } }, error: null }])
    await expect(CanonicalActionLedgerService.createActionRequest({ ...input,
      exactPayload: { 'é': 2, 'é': 1 }, adminClient: db })).resolves.toMatchObject({ isExisting: true })
    expect(db.insert).not.toHaveBeenCalled()
  })

  it.each([
    { channel: 'threads' }, { action_kind: 'comment_reply' }, { target_external_id: 'other' },
    { content_version_id: 'new' }, { approval_id: 'new' }, { approval_fingerprint: 'new' },
    { exact_payload: { ...input.exactPayload, media: ['b', 'a'] } },
    { exact_payload: { ...input.exactPayload, text: 'changed' } },
  ])('rejects changed contract %j', async (change) => {
    const db = database([{ data: { ...stored, ...change }, error: null }])
    await expect(CanonicalActionLedgerService.createActionRequest({ ...input, adminClient: db }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 })
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('converges a 23505 race on the matching committed winner', async () => {
    const db = database([{ data: null, error: null }, { data: stored, error: null }])
    await expect(CanonicalActionLedgerService.createActionRequest({ ...input, adminClient: db }))
      .resolves.toMatchObject({ requestId: 'request', isExisting: true })
    expect(db.insert).toHaveBeenCalledOnce()
  })

  it('returns conflict when the concurrent winner has a different approval', async () => {
    const db = database([{ data: null, error: null }, { data: { ...stored, approval_id: 'changed' }, error: null }])
    await expect(CanonicalActionLedgerService.createActionRequest({ ...input, adminClient: db })).rejects.toBeInstanceOf(ActionRequestConflictError)
  })

  it.each([
    [{ data: null, error: { code: '08006' } }],
    [{ data: null, error: null }, { data: null, error: null }],
    [{ data: null, error: null }, { data: null, error: { code: '08006' } }],
  ])('fails closed when lookup or concurrent winner cannot be established', async (...lookups) => {
    const db = database(lookups)
    await expect(CanonicalActionLedgerService.createActionRequest({ ...input, adminClient: db })).rejects.toBeInstanceOf(PersistenceError)
  })

  it('does not retry non-unique persistence failures', async () => {
    const db = database([{ data: null, error: null }], { data: null, error: { code: '23503', message: 'FK failure' } })
    await expect(CanonicalActionLedgerService.createActionRequest({ ...input, adminClient: db })).rejects.toBeInstanceOf(PersistenceError)
    expect(db.query.maybeSingle).toHaveBeenCalledOnce()
  })
})
