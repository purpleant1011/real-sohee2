import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  createMetaDataDeletionRequest,
  createWorkspaceDataDeletionRequest,
  getDataDeletionRequestStatus,
} from './repository'

const requestId = '10000000-0000-4000-8000-000000000001'
const workspaceId = '20000000-0000-4000-8000-000000000001'
const userId = '30000000-0000-4000-8000-000000000001'
const confirmationCode = 'deletion_confirmation_code_123456'
const confirmationCodeSha256 = createHash('sha256').update(confirmationCode).digest('hex')

describe('data deletion repository', () => {
  it('stores only a confirmation hash for an authorized workspace request', async () => {
    const rpc = vi.fn(async () => ({ data: requestId, error: null }))

    const result = await createWorkspaceDataDeletionRequest({
      workspaceId,
      actorUserId: userId,
      scope: 'member',
    }, { rpc }, () => confirmationCode)

    expect(result).toEqual({ requestId, confirmationCode })
    expect(rpc).toHaveBeenCalledWith('create_data_deletion_request', {
      p_workspace_id: workspaceId,
      p_actor_user_id: userId,
      p_scope: 'member',
      p_confirmation_code_sha256: confirmationCodeSha256,
    })
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(confirmationCode)
  })

  it('passes the raw Meta subject only to the queued review RPC and hashes the confirmation code', async () => {
    const rpc = vi.fn(async () => ({ data: requestId, error: null }))

    const result = await createMetaDataDeletionRequest({
      provider: 'instagram',
      externalAccountId: 'meta-user-42',
      confirmationCode,
    }, { rpc })

    expect(result).toEqual({ requestId })
    expect(rpc).toHaveBeenCalledWith('request_meta_data_deletion', {
      p_provider: 'instagram',
      p_external_account_id: 'meta-user-42',
      p_confirmation_code_sha256: confirmationCodeSha256,
    })
  })

  it('returns the persisted status and rejects a channel mismatch', async () => {
    const rpc = vi.fn(async () => ({
      data: [{
        status: 'in_progress',
        request_origin: 'meta',
        scope: 'provider',
        provider: 'instagram',
        requested_at: '2026-08-14T01:00:00.000Z',
        updated_at: '2026-08-14T01:05:00.000Z',
        completed_at: null,
      }],
      error: null,
    }))

    await expect(getDataDeletionRequestStatus({ confirmationCode }, { rpc })).resolves.toEqual({
      status: 'in_progress',
      origin: 'meta',
      scope: 'provider',
      provider: 'instagram',
      requestedAt: '2026-08-14T01:00:00.000Z',
      updatedAt: '2026-08-14T01:05:00.000Z',
      completedAt: null,
    })
    await expect(getDataDeletionRequestStatus({
      confirmationCode,
      provider: 'threads',
    }, { rpc })).resolves.toBeNull()
    expect(rpc).toHaveBeenCalledWith('get_data_deletion_request_status', {
      p_confirmation_code_sha256: confirmationCodeSha256,
    })
  })

  it('does not query storage for a malformed public confirmation code', async () => {
    const rpc = vi.fn()

    await expect(getDataDeletionRequestStatus({ confirmationCode: 'short' }, { rpc })).resolves.toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })
})
