import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  claimLocalPublishJob,
  claimScopedLocalPublishJob,
  completeLocalPublishJob,
  issueLocalSubmitPermit,
  recordCheckpoint,
} from './repository'

const device = {
  deviceId: '10000000-0000-4000-8000-000000000001',
  workspaceId: '10000000-0000-4000-8000-000000000002',
  platform: 'macos',
  clientVersion: '0.1.0',
  status: 'active',
  tokenDigest: 'c'.repeat(64),
} as const

const leaseId = '10000000-0000-4000-8000-000000000003'
const jobId = '10000000-0000-4000-8000-000000000004'

describe('local publishing repository', () => {
  it('returns no second job when the database does not claim one', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: 0, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
    await expect(claimLocalPublishJob(device, 'c'.repeat(64), { rpc })).resolves.toEqual({ data: null })
    expect(rpc.mock.calls[0]).toEqual(['recover_expired_local_publish_jobs', {
      p_workspace_id: device.workspaceId,
      p_device_id: device.deviceId,
    }])
    expect(rpc).toHaveBeenCalledWith('claim_local_publish_job', {
      p_workspace_id: device.workspaceId,
      p_device_id: device.deviceId,
      p_token_digest: 'c'.repeat(64),
    })
  })

  it('accepts the schedule metadata returned by the production claim RPC', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: 0, error: null })
      .mockResolvedValueOnce({ data: {
        jobId,
        leaseId,
        attemptId: '10000000-0000-4000-8000-000000000005',
        contentVersionId: '10000000-0000-4000-8000-000000000006',
        approvalId: '10000000-0000-4000-8000-000000000007',
        approvalFingerprint: 'a'.repeat(64),
        browserChannelConnectionId: '10000000-0000-4000-8000-000000000008',
        scheduledAt: null,
        autoExecuteUntil: null,
      }, error: null })

    await expect(claimLocalPublishJob(device, 'c'.repeat(64), { rpc })).resolves.toMatchObject({
      data: { jobId, scheduledAt: null, autoExecuteUntil: null },
    })
  })

  it('binds checkpoints and submit permits to the authenticated device', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    await expect(recordCheckpoint(device, {
      jobId,
      leaseId,
      phase: 'preflight_verified',
      observedAt: '2026-08-19T07:00:00.000Z',
    }, { rpc })).resolves.toEqual({ data: true })

    const permit = await issueLocalSubmitPermit(device, jobId, leaseId, { rpc, randomToken: () => 'p'.repeat(43) })
    expect(permit).toEqual({ data: { permit: 'p'.repeat(43) } })
    expect(rpc.mock.calls.at(-1)).toEqual(['issue_local_submit_permit', expect.objectContaining({
      p_device_id: device.deviceId,
      p_action_id: jobId,
      p_lease_id: leaseId,
      p_permit_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
    })])
  })

  it('records success and unknown results through separate terminal states', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    await expect(completeLocalPublishJob(device, {
      jobId,
      leaseId,
      status: 'succeeded',
      providerReference: 'naver-post-1',
      resultUrl: 'https://blog.naver.com/findk3/223000000000',
    }, { rpc })).resolves.toEqual({ data: true })
    expect(rpc).toHaveBeenCalledWith('complete_local_publish_job', expect.objectContaining({
      p_device_id: device.deviceId,
      p_status: 'succeeded',
    }))

    rpc.mockClear()
    await expect(completeLocalPublishJob(device, {
      jobId,
      leaseId,
      status: 'failed_before_submit',
    }, { rpc })).resolves.toEqual({ error: { code: 'COMPLETION_INVALID' } })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('claims only the explicit scope without bulk recovery or a FIFO fallback', async () => {
    const scopeId='10000000-0000-4000-8000-000000000009'
    const rpc=vi.fn().mockResolvedValue({ data:null,error:null })
    expect(await claimScopedLocalPublishJob(device,{ actionId:jobId,scopeId },{ rpc })).toEqual({ data:null })
    expect(rpc).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith('claim_scoped_local_publish_job',{
      p_workspace_id:device.workspaceId,p_device_id:device.deviceId,p_token_digest:device.tokenDigest,p_action_id:jobId,p_scope_id:scopeId,
    })
  })

  it('rejects a malformed target before either claim RPC', async () => {
    const rpc=vi.fn()
    expect(await claimScopedLocalPublishJob(device,{ actionId:jobId },{ rpc })).toEqual({ error:{ code:'SCOPE_REQUEST_INVALID' } })
    expect(rpc).not.toHaveBeenCalled()
  })

})
