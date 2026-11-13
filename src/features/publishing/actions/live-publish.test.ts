import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ material: vi.fn(), provider: vi.fn(), destination: vi.fn(), admission: vi.fn() }))
vi.mock('../approved-publish-repository', () => ({ loadApprovedPublishMaterial: mocks.material }))
vi.mock('../meta-publish-provider', () => ({ publishApprovedMetaContent: mocks.provider }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: () => ({}) }))
vi.mock('@/features/marketing-agent/engine/autonomy-execution-admission', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/marketing-agent/engine/autonomy-execution-admission')>()),
  checkAutonomyExecutionAdmission: mocks.admission,
}))

import { executeLivePublishRetry, executeLivePublishSchedule } from './live-publish'

const input = {
  workspaceId: '10000000-0000-4000-8000-000000000001',
  scheduleId: '20000000-0000-4000-8000-000000000001',
  actorUserId: '30000000-0000-4000-8000-000000000001',
}
const reservation = {
  attemptId: '40000000-0000-4000-8000-000000000001',
  status: 'pending', providerReference: null, errorCode: null, isNew: true,
  workspaceId: input.workspaceId, scheduleId: input.scheduleId,
  versionId: '50000000-0000-4000-8000-000000000001',
  channelConnectionId: '60000000-0000-4000-8000-000000000001', channel: 'instagram',
  idempotencyKey: 'a'.repeat(64), contentFingerprint: 'b'.repeat(64),
}

describe('live publish claim service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.material.mockResolvedValue({ payload: { workspaceId: input.workspaceId }, mediaUrls: ['https://media.example/image'] })
    mocks.provider.mockResolvedValue({
      ok: true,
      providerPostId: 'ig-post-1',
      destinationUrl: 'https://www.instagram.com/p/POST1/',
      errorCode: null,
    })
    mocks.destination.mockResolvedValue({ error: null })
    mocks.admission.mockResolvedValue({ admitted: true })
  })

  it('자율근무가 중지되면 백그라운드 발행은 claim 과 provider 를 호출하지 않는다', async () => {
    mocks.admission.mockResolvedValueOnce({ admitted: false, code: 'AUTONOMY_PAUSED' })
    const rpc = vi.fn()

    await expect(executeLivePublishSchedule(input, { rpc })).resolves.toEqual({
      error: { message: '자율근무가 중지되어 있어요. 다시 켠 뒤 시도해 주세요.', requestId: 'live-publish' },
    })
    expect(mocks.admission).toHaveBeenCalledWith(expect.anything(), input.workspaceId)
    expect(rpc).not.toHaveBeenCalled()
    expect(mocks.provider).not.toHaveBeenCalled()
  })

  it('재시도도 자율근무가 중지되면 claim 을 호출하지 않는다', async () => {
    mocks.admission.mockResolvedValueOnce({ admitted: false, code: 'AGENT_BLOCKED' })
    const rpc = vi.fn()

    await expect(executeLivePublishRetry({
      workspaceId: input.workspaceId,
      failedAttemptId: reservation.attemptId,
      actorUserId: input.actorUserId,
    }, { rpc })).resolves.toMatchObject({ error: { message: expect.stringContaining('막혀') } })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('자율근무 상태를 읽지 못하면 자동 발행을 시작하지 않는다', async () => {
    mocks.admission.mockResolvedValueOnce({ admitted: false, code: 'AUTONOMY_UNVERIFIABLE' })
    const rpc = vi.fn()

    await expect(executeLivePublishSchedule(input, { rpc })).resolves.toMatchObject({
      error: { message: '자율근무 상태를 확인하지 못해 실행을 시작하지 않았어요.' },
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('사람이 화면에서 직접 실행한 발행은 자율근무 중지와 별개로 진행한다', async () => {
    mocks.admission.mockResolvedValue({ admitted: false, code: 'AUTONOMY_PAUSED' })
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: reservation, error: null })
      .mockResolvedValueOnce({ data: reservation.attemptId, error: null })

    await expect(executeLivePublishSchedule({ ...input, trigger: 'user' }, { rpc })).resolves.toMatchObject({
      data: { status: 'published' },
    })
    expect(mocks.admission).not.toHaveBeenCalled()
    expect(mocks.provider).toHaveBeenCalledOnce()
  })

  it('claims atomically, invokes the provider once, and completes with the same private claim token', async () => {
    mocks.provider.mockImplementationOnce(async (context: { onProviderRequestId(id: string): Promise<void> }) => {
      await context.onProviderRequestId('container-1')
      return {
        ok: true,
        providerPostId: 'ig-post-1',
        destinationUrl: 'https://www.instagram.com/p/POST1/',
        errorCode: null,
      }
    })
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: reservation, error: null })
      .mockResolvedValueOnce({ data: reservation.attemptId, error: null })
      .mockResolvedValueOnce({ data: reservation.attemptId, error: null })
    await expect(executeLivePublishSchedule(input, { rpc, recordDestination: mocks.destination })).resolves.toEqual({ data: {
      attemptId: reservation.attemptId,
      status: 'published',
      providerPostId: 'ig-post-1',
      destinationUrl: 'https://www.instagram.com/p/POST1/',
      errorCode: null,
    } })
    expect(mocks.material).toHaveBeenCalledWith(input.workspaceId, input.scheduleId)
    expect(mocks.provider).toHaveBeenCalledOnce()
    const claimArgs = rpc.mock.calls[0]![1] as Record<string, unknown>
    const recordArgs = rpc.mock.calls[1]![1] as Record<string, unknown>
    const completeArgs = rpc.mock.calls[2]![1] as Record<string, unknown>
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'claim_publish_schedule',
      'record_claimed_publish_request',
      'complete_claimed_publish',
    ])
    expect(claimArgs.p_claim_token).toEqual(expect.any(String))
    expect(recordArgs).toMatchObject({
      p_claim_token: claimArgs.p_claim_token,
      p_provider_request_id: 'container-1',
    })
    expect(completeArgs.p_claim_token).toBe(claimArgs.p_claim_token)
    expect(completeArgs).toMatchObject({
      p_status: 'succeeded', p_provider_reference: 'ig-post-1', p_error_code: null,
      p_provider_request_id: 'container-1',
    })
    expect(mocks.destination).toHaveBeenCalledWith({
      workspaceId: input.workspaceId,
      attemptId: reservation.attemptId,
      destinationUrl: 'https://www.instagram.com/p/POST1/',
    })
  })

  it('keeps the confirmed publish successful when destination persistence fails', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: reservation, error: null })
      .mockResolvedValueOnce({ data: reservation.attemptId, error: null })
    mocks.destination.mockResolvedValueOnce({ error: { code: 'storage_unavailable' } })

    await expect(executeLivePublishSchedule(input, {
      rpc,
      recordDestination: mocks.destination,
    })).resolves.toMatchObject({
      data: {
        status: 'published',
        providerPostId: 'ig-post-1',
        destinationUrl: 'https://www.instagram.com/p/POST1/',
        errorCode: null,
      },
    })
  })

  it('never records published when the provider failed', async () => {
    mocks.provider.mockResolvedValue({ ok: false, providerPostId: null, errorCode: 'TEMPORARY_NETWORK' })
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: reservation, error: null })
      .mockResolvedValueOnce({ data: reservation.attemptId, error: null })
    await expect(executeLivePublishSchedule(input, { rpc })).resolves.toMatchObject({
      data: { status: 'failed', providerPostId: null, errorCode: 'TEMPORARY_NETWORK' },
    })
    expect(rpc.mock.calls[1]![1]).toMatchObject({
      p_status: 'failed', p_provider_reference: null, p_error_code: 'TEMPORARY_NETWORK',
    })
  })

  it('returns unknown instead of a false published state if result recording fails after provider success', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: reservation, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: 'timeout' } })
    await expect(executeLivePublishSchedule(input, { rpc })).resolves.toMatchObject({
      data: { status: 'unknown', providerPostId: 'ig-post-1', errorCode: 'RESULT_RECORDING_UNKNOWN' },
    })
  })

  it('persists a provider-unknown result as unknown and never marks it failed/retryable', async () => {
    mocks.provider.mockResolvedValue({ ok: false, providerPostId: null, errorCode: 'RESULT_UNKNOWN' })
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: reservation, error: null })
      .mockResolvedValueOnce({ data: reservation.attemptId, error: null })
    await expect(executeLivePublishSchedule(input, { rpc })).resolves.toMatchObject({
      data: { status: 'unknown', providerPostId: null, errorCode: 'RESULT_UNKNOWN' },
    })
    expect(rpc.mock.calls[1]![1]).toMatchObject({ p_status: 'unknown', p_error_code: 'RESULT_UNKNOWN' })
  })

  it('does not call the provider again for an idempotently completed attempt', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ...reservation, isNew: false, status: 'succeeded', providerReference: 'ig-existing' }, error: null,
    })
    await expect(executeLivePublishSchedule(input, { rpc })).resolves.toMatchObject({
      data: { status: 'published', providerPostId: 'ig-existing' },
    })
    expect(mocks.provider).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledOnce()
  })

  it('uses a separate service-only retry claim and retry idempotency key', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { ...reservation, idempotencyKey: 'c'.repeat(64) }, error: null })
      .mockResolvedValueOnce({ data: reservation.attemptId, error: null })
    await expect(executeLivePublishRetry({
      workspaceId: input.workspaceId,
      failedAttemptId: reservation.attemptId,
      actorUserId: input.actorUserId,
    }, { rpc })).resolves.toMatchObject({ data: { status: 'published' } })
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['claim_publish_retry', 'complete_claimed_publish'])
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_failed_attempt_id: reservation.attemptId })
    expect(rpc.mock.calls[1]![1]).toMatchObject({ p_idempotency_key: 'c'.repeat(64) })
  })

  it('maps PUBLISH_CLAIM_FORBIDDEN error to specific message', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'PUBLISH_CLAIM_FORBIDDEN' },
    })
    await expect(executeLivePublishSchedule(input, { rpc })).resolves.toEqual({
      error: {
        message: '게시 권한이 필요해요',
        requestId: 'live-publish',
        code: 'PUBLISH_CLAIM_FORBIDDEN',
      },
    })
  })

  it('maps PUBLISH_NOT_DUE_OR_NOT_READY error to specific reconnect message', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'PUBLISH_NOT_DUE_OR_NOT_READY' },
    })
    await expect(executeLivePublishSchedule(input, { rpc })).resolves.toEqual({
      error: {
        message: '연결 권한이나 상태를 확인해 주세요. 채널을 다시 연결하면 해결될 수 있어요.',
        requestId: 'live-publish',
        code: 'PUBLISH_NOT_DUE_OR_NOT_READY',
      },
    })
  })

  it('maps generic claim errors to standard fallback message', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'SOME_UNKNOWN_DATABASE_ERROR' },
    })
    await expect(executeLivePublishSchedule(input, { rpc })).resolves.toEqual({
      error: {
        message: '게시 실행을 시작하지 못했어요. 연결 상태와 예약 기록을 확인해 주세요.',
        requestId: 'live-publish',
      },
    })
  })
})

