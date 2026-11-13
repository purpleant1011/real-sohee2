import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), maybeSingle: vi.fn(), scheduleUpdatedAt: vi.fn(), rpc: vi.fn(), preview: vi.fn(), publish: vi.fn(), revalidatePath: vi.fn(), readiness: vi.fn(),
  scheduleRows: { data: [] as unknown, error: null as unknown },
  attemptRows: { data: [] as unknown, error: null as unknown },
  missionRows: { data: [] as unknown, error: null as unknown },
  missionFilter: vi.fn(),
  // 사전 확인과 사후 재확인이 같은 테이블을 순서대로 읽는다. 큐에 있으면 순서대로 소비한다.
  scheduleResults: [] as { data: unknown; error: unknown }[],
}))
type TestQuery = {
  select(): TestQuery
  eq(key: string, value: unknown): TestQuery
  in(): TestQuery
  order(): TestQuery
  limit(): Promise<{ data: unknown; error: unknown }>
  maybeSingle: () => Promise<unknown>
}
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: vi.fn((table: string) => {
      const query = {} as TestQuery
      query.select = () => query
      query.eq = (key, value) => {
        if (table === 'marketing_missions') mocks.missionFilter(key, value)
        return query
      }
      query.in = () => query
      query.order = () => query
      query.limit = () => Promise.resolve(
        table === 'schedules' ? (mocks.scheduleResults.shift() ?? mocks.scheduleRows)
          : table === 'publish_attempts' ? mocks.attemptRows
            : table === 'marketing_missions' ? mocks.missionRows
              : { data: [], error: null },
      )
      query.maybeSingle = () => table === 'schedules' ? mocks.scheduleUpdatedAt() : mocks.maybeSingle()
      return query
    }),
    rpc: mocks.rpc,
  })),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn(() => ({ rpc: mocks.rpc })) }))
vi.mock('@/features/approvals/approval-preview-repository', () => ({ getApprovalPreview: mocks.preview }))
vi.mock('@/features/publishing/actions/live-publish', () => ({ executeLivePublishSchedule: mocks.publish }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/readiness/load', () => ({ loadReadiness: mocks.readiness }))

import { approveAndDispatchAction } from './approve-and-dispatch'

const input = {
  workspaceId: '20000000-0000-4000-8000-000000000001',
  contentId: '30000000-0000-4000-8000-000000000001',
  versionId: '40000000-0000-4000-8000-000000000001',
  fingerprint: 'a'.repeat(64),
  mode: 'publish_now' as const,
  channelConnectionId: '50000000-0000-4000-8000-000000000001',
  scheduledLocal: null,
  timezone: null,
}
const snapshot = {
  workspaceId: input.workspaceId, contentId: input.contentId, versionId: input.versionId, versionNumber: 3,
  fingerprint: input.fingerprint, approval: { id: null, status: 'unreviewed', fingerprint: null }, channel: 'instagram',
  account: { connectionId: input.channelConnectionId, label: '@sohee', status: 'connected' }, text: '본문', media: [], issues: [],
}

describe('approveAndDispatchAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.scheduleRows = { data: [], error: null }
    mocks.attemptRows = { data: [], error: null }
    mocks.missionRows = { data: [], error: null }
    mocks.scheduleResults = []
    vi.stubEnv('META_APP_REVIEW_STATUS', 'approved')
    vi.stubEnv('META_LIVE_WORKSPACE_ALLOWLIST', '*')
    mocks.getUser.mockResolvedValue({ data: { user: { id: '10000000-0000-4000-8000-000000000001' } }, error: null })
    mocks.maybeSingle.mockResolvedValue({ data: { role: 'manager', status: 'active' }, error: null })
    mocks.scheduleUpdatedAt.mockResolvedValue({ data: { updated_at: '2026-10-24T00:00:00.000Z' }, error: null })
    mocks.preview.mockResolvedValue({ data: snapshot })
    mocks.readiness.mockResolvedValue({ stage: 'PUBLISH_READY', verifiedChannels: ['instagram'], prepared: true, businessVerified: false })
    // 승인 RPC 와 모듈이 부르는 다른 RPC(예약 취소)를 이름으로 구분한다.
    mocks.rpc.mockImplementation(async (name: string) => name === 'cancel_schedule_guarded'
      ? { data: null, error: null }
      : { data: {
        approvalId: '60000000-0000-4000-8000-000000000001',
        scheduleId: '70000000-0000-4000-8000-000000000001',
        next: 'publishing',
      }, error: null })
    mocks.publish.mockResolvedValue({ data: {
      attemptId: '80000000-0000-4000-8000-000000000001',
      status: 'published',
      providerPostId: 'post-1',
      errorCode: null,
    } })
  })

  it('rechecks the exact server snapshot before approving and starting immediate delivery', async () => {
    await expect(approveAndDispatchAction(input)).resolves.toMatchObject({
      data: {
        versionId: input.versionId,
        next: 'published',
        scheduleId: '70000000-0000-4000-8000-000000000001',
        attemptId: '80000000-0000-4000-8000-000000000001',
        providerPostId: 'post-1',
        errorCode: null,
      },
    })
    expect(mocks.missionFilter.mock.calls).toEqual([
      ['workspace_id', input.workspaceId], ['content_id', input.contentId],
    ])
    expect(mocks.rpc).toHaveBeenCalledWith('approve_and_dispatch_content_as_actor', expect.objectContaining({
      p_workspace_id: input.workspaceId,
      p_content_id: input.contentId,
      p_actor_user_id: '10000000-0000-4000-8000-000000000001',
      p_lane: 'meta',
      p_version_id: input.versionId,
      p_expected_fingerprint: input.fingerprint,
      p_mode: 'publish_now',
      p_channel_connection_id: input.channelConnectionId,
    }))
    expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: input.workspaceId,
      scheduleId: '70000000-0000-4000-8000-000000000001',
      actorUserId: '10000000-0000-4000-8000-000000000001',
      // 사람이 승인 화면에서 직접 누른 실행이다. 자율근무 중지와 분리한다(ANI-1712 M24 규칙 유지).
      trigger: 'user',
    }))
  })

  it.each([
    ['instagram', 'publish_now'], ['instagram', 'schedule'],
    ['naver_blog', 'publish_now'], ['naver_blog', 'schedule'],
  ] as const)('미션 원고의 %s %s는 비용·범위 검토 없이 상세 화면에서 실행할 수 없다', async (channel, mode) => {
    mocks.preview.mockResolvedValue({ data: { ...snapshot, channel } })
    if (channel === 'naver_blog') mocks.rpc.mockResolvedValue({ data: {
      approvalId: '60000000-0000-4000-8000-000000000001',
      actionRequestId: '70000000-0000-4000-8000-000000000001', next: 'scheduled',
    }, error: null })
    mocks.missionRows = { data: [{ id: '90000000-0000-4000-8000-000000000001' }], error: null }
    await expect(approveAndDispatchAction({
      ...input, mode, scheduledLocal: mode === 'schedule' ? '2030-01-01T12:00' : null,
      timezone: mode === 'schedule' ? 'Asia/Seoul' : null,
    })).resolves.toMatchObject({ error: { message: '미션의 게시 비용과 승인 범위를 먼저 확인해 주세요.' } })
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it.each([
    { data: null, error: { message: 'unavailable' } },
    { data: null, error: null },
    { data: {}, error: null },
  ])('미션 연결 조회가 불확실하면 비미션으로 간주하여 게시하지 않는다: %j', async result => {
    mocks.missionRows = result
    await expect(approveAndDispatchAction(input)).resolves.toMatchObject({ error: { requestId: 'approve-and-dispatch' } })
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it('미션 원고를 승인만 할 때는 외부 게시 의도를 만들지 않는다', async () => {
    mocks.missionRows = { data: [{ id: '90000000-0000-4000-8000-000000000001' }], error: null }
    mocks.rpc.mockResolvedValue({ data: {
      approvalId: '60000000-0000-4000-8000-000000000001', scheduleId: null, next: 'approved',
    }, error: null })
    await expect(approveAndDispatchAction({ ...input, mode: 'approve_only', channelConnectionId: null }))
      .resolves.toMatchObject({ data: { next: 'approved', scheduleId: null } })
    expect(mocks.publish).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledWith('approve_and_dispatch_content_as_actor', expect.objectContaining({ p_mode: 'approve_only' }))
  })

  it('rejects a direct publish or schedule with no verified channel before creating a dispatch intent', async () => {
    mocks.readiness.mockResolvedValue({ stage: 'PREPARE_ONLY', verifiedChannels: [], prepared: true, businessVerified: false })
    for (const mode of ['publish_now', 'schedule'] as const) {
      const attempt = { ...input, mode, scheduledLocal: mode === 'schedule' ? '2030-01-01T12:00' : null,
        timezone: mode === 'schedule' ? 'Asia/Seoul' : null }
      await expect(approveAndDispatchAction(attempt)).resolves.toMatchObject({ error: { message: '채널을 연결하면 발행할 수 있어요' } })
    }
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('refuses Meta dispatch when workspace is not in live allowlist', async () => {
    vi.stubEnv('META_LIVE_WORKSPACE_ALLOWLIST', '99999999-9999-4999-8999-999999999999')
    await expect(approveAndDispatchAction(input)).resolves.toMatchObject({
      error: { message: '아직 이 계정에서는 실제 게시를 열지 않았어요. 곧 열릴 예정이에요.' },
    })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('refuses Meta dispatch while app review remains pending even with a verified channel', async () => {
    vi.stubEnv('META_APP_REVIEW_STATUS', 'pending')
    await expect(approveAndDispatchAction(input)).resolves.toMatchObject({ error: { message: 'Meta 앱 심사가 끝나면 열려요' } })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('returns a safe unknown result when the provider request cannot be reconciled', async () => {
    mocks.publish.mockResolvedValue({ data: {
      attemptId: '80000000-0000-4000-8000-000000000001',
      status: 'unknown',
      providerPostId: null,
      errorCode: 'RESULT_UNKNOWN',
    } })

    await expect(approveAndDispatchAction(input)).resolves.toMatchObject({
      data: {
        next: 'unknown',
        attemptId: '80000000-0000-4000-8000-000000000001',
        providerPostId: null,
        errorCode: 'RESULT_UNKNOWN',
      },
    })
  })

  it('blocks a stale fingerprint before the mutation or provider call', async () => {
    mocks.preview.mockResolvedValue({ data: { ...snapshot, fingerprint: 'b'.repeat(64) } })
    await expect(approveAndDispatchAction(input)).resolves.toMatchObject({ error: { requestId: 'approve-and-dispatch' } })
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it('allows reviewers to approve only and never creates a delivery intent', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { role: 'reviewer', status: 'active' }, error: null })
    mocks.rpc.mockResolvedValue({ data: {
      approvalId: '60000000-0000-4000-8000-000000000001', scheduleId: null, next: 'approved',
    }, error: null })
    await expect(approveAndDispatchAction({ ...input, mode: 'approve_only', channelConnectionId: null }))
      .resolves.toMatchObject({ data: {
        next: 'approved', scheduleId: null, attemptId: null, providerPostId: null, errorCode: null,
      } })
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it('blocks a reviewer who sends a publish mode before the RPC', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { role: 'reviewer', status: 'active' }, error: null })
    await expect(approveAndDispatchAction(input)).resolves.toMatchObject({ error: { requestId: 'approve-and-dispatch' } })
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it('records a Naver Blog approval through the local connector RPC without calling Meta', async () => {
    mocks.preview.mockResolvedValue({ data: {
      ...snapshot,
      channel: 'naver_blog',
      account: { connectionId: input.channelConnectionId, label: 'findk3', status: 'connected' },
    } })
    mocks.rpc.mockResolvedValue({ data: {
      approvalId: '60000000-0000-4000-8000-000000000001',
      actionRequestId: null,
      next: 'approved',
    }, error: null })

    await expect(approveAndDispatchAction({
      ...input,
      mode: 'approve_only',
      channelConnectionId: null,
    })).resolves.toMatchObject({ data: { next: 'approved', scheduleId: null } })

    expect(mocks.rpc).toHaveBeenCalledWith('approve_and_dispatch_content_as_actor', expect.objectContaining({
      p_channel_connection_id: null,
      p_mode: 'approve_only',
    }))
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it.each(['publish_now', 'schedule'] as const)(
    'blocks Naver Blog dispatch for mode %s with POLICY_DISABLED and does not call local RPC',
    async (mode) => {
      mocks.preview.mockResolvedValue({
        data: {
          ...snapshot,
          channel: 'naver_blog',
          account: { connectionId: input.channelConnectionId, label: 'findk3', status: 'connected' },
        },
      })

      const res = await approveAndDispatchAction({
        ...input,
        mode,
        scheduledLocal: mode === 'schedule' ? '2030-01-01T12:00' : null,
        timezone: mode === 'schedule' ? 'Asia/Seoul' : null,
      })

      expect(res).toMatchObject({
        error: {
          errorCode: 'POLICY_DISABLED',
          requestId: 'approve-and-dispatch',
        },
      })
      expect(mocks.rpc).not.toHaveBeenCalled()
      expect(mocks.publish).not.toHaveBeenCalled()
    },
  )

  describe('발행 전 최종 승인 가드 (ANI-1680 M07)', () => {
    const existingScheduleId = '70000000-0000-4000-8000-000000000009'
    const existingApprovalId = '60000000-0000-4000-8000-000000000009'
    const existingAttemptId = '80000000-0000-4000-8000-000000000009'
    const scheduleRow = {
      id: existingScheduleId,
      approval_id: existingApprovalId,
      status: 'published',
    }

    it('같은 승인 기록의 두 번째 게시 실행은 공급자를 다시 부르지 않고 기존 결과를 돌려준다', async () => {
      mocks.scheduleRows = { data: [scheduleRow], error: null }
      mocks.attemptRows = { data: [{
        schedule_id: existingScheduleId,
        id: existingAttemptId,
        status: 'succeeded',
        provider_reference: 'post-1',
        error_code: null,
      }], error: null }

      await expect(approveAndDispatchAction(input)).resolves.toEqual({ data: {
        approvalId: existingApprovalId,
        versionId: input.versionId,
        next: 'published',
        scheduleId: existingScheduleId,
        attemptId: existingAttemptId,
        providerPostId: 'post-1',
        errorCode: null,
      } })
      // 중복 발송 0: 승인 RPC도, 공급자 실행도 다시 부르지 않는다.
      expect(mocks.rpc).not.toHaveBeenCalled()
      expect(mocks.publish).not.toHaveBeenCalled()
    })

    it('이전 실행 결과가 불확실하면 성공이 아니라 검증 중으로 돌려주고 다시 보내지 않는다', async () => {
      mocks.scheduleRows = { data: [{ ...scheduleRow, status: 'unknown' }], error: null }
      mocks.attemptRows = { data: [{
        schedule_id: existingScheduleId,
        id: existingAttemptId,
        status: 'unknown',
        provider_reference: null,
        error_code: 'RESULT_UNKNOWN',
      }], error: null }

      await expect(approveAndDispatchAction(input)).resolves.toMatchObject({ data: {
        next: 'unknown',
        attemptId: existingAttemptId,
        providerPostId: null,
        errorCode: 'RESULT_UNKNOWN',
      } })
      expect(mocks.rpc).not.toHaveBeenCalled()
      expect(mocks.publish).not.toHaveBeenCalled()
    })

    it('이전 실행이 아직 진행 중이면 중복 실행을 시작하지 않는다', async () => {
      mocks.scheduleRows = { data: [{ ...scheduleRow, status: 'publishing' }], error: null }
      mocks.attemptRows = { data: [{
        schedule_id: existingScheduleId,
        id: existingAttemptId,
        status: 'pending',
        provider_reference: null,
        error_code: null,
      }], error: null }

      await expect(approveAndDispatchAction(input)).resolves.toMatchObject({ data: {
        next: 'unknown',
        attemptId: existingAttemptId,
      } })
      expect(mocks.rpc).not.toHaveBeenCalled()
      expect(mocks.publish).not.toHaveBeenCalled()
    })

    it('실패한 실행을 조용히 다시 발송하지 않는다', async () => {
      mocks.scheduleRows = { data: [{ ...scheduleRow, status: 'failed' }], error: null }
      mocks.attemptRows = { data: [{
        schedule_id: existingScheduleId,
        id: existingAttemptId,
        status: 'failed',
        provider_reference: null,
        error_code: 'PROVIDER_REJECTED',
      }], error: null }

      await expect(approveAndDispatchAction(input)).resolves.toMatchObject({ data: {
        next: 'failed',
        attemptId: existingAttemptId,
        errorCode: 'PROVIDER_REJECTED',
      } })
      expect(mocks.rpc).not.toHaveBeenCalled()
      expect(mocks.publish).not.toHaveBeenCalled()
    })

    // 경합 재현: 두 요청이 사전 확인(빈 이력)을 함께 통과한 뒤, 앞선 요청의 게시가 끝나고
    // 뒤 요청의 RPC 가 새 예약을 만든 시점의 이력을 사후 확인이 읽는 상황.
    it('사전 확인을 통과해도 RPC 직후 다른 예약의 게시 결과가 보이면 방금 만든 예약을 취소하고 공급자를 부르지 않는다', async () => {
      const newScheduleId = '70000000-0000-4000-8000-00000000000a'
      const newApprovalId = '60000000-0000-4000-8000-00000000000a'
      mocks.scheduleResults = [
        // 사전 확인 시점에는 이력이 비어 있었다.
        { data: [], error: null },
        // 사전 확인과 RPC 사이에 앞선 요청의 게시가 끝나 이력에 나타났다.
        { data: [
          { id: newScheduleId, approval_id: newApprovalId, status: 'scheduled' },
          { id: existingScheduleId, approval_id: existingApprovalId, status: 'published' },
        ], error: null },
      ]
      mocks.attemptRows = { data: [{
        schedule_id: existingScheduleId,
        id: existingAttemptId,
        status: 'succeeded',
        provider_reference: 'post-1',
        error_code: null,
      }], error: null }
      mocks.rpc.mockImplementation(async (name: string) => name === 'cancel_schedule_guarded'
        ? { data: null, error: null }
        : { data: { approvalId: newApprovalId, scheduleId: newScheduleId, next: 'publishing' }, error: null })

      await expect(approveAndDispatchAction(input)).resolves.toEqual({ data: {
        approvalId: existingApprovalId,
        versionId: input.versionId,
        next: 'published',
        scheduleId: existingScheduleId,
        attemptId: existingAttemptId,
        providerPostId: 'post-1',
        errorCode: null,
      } })
      expect(mocks.rpc).toHaveBeenCalledWith('cancel_schedule_guarded', {
        p_workspace_id: input.workspaceId,
        p_schedule_id: newScheduleId,
        p_expected_updated_at: '2026-10-24T00:00:00.000Z',
      })
      // 중복 발송 0: 방금 만든 예약은 취소되고 공급자는 호출되지 않는다.
      expect(mocks.publish).not.toHaveBeenCalled()
    })

    it('방금 만든 예약을 취소하지 못하면 공급자를 부르지 않고 명시적으로 멈춘다', async () => {
      const newScheduleId = '70000000-0000-4000-8000-00000000000a'
      mocks.scheduleResults = [
        { data: [], error: null },
        { data: [
          { id: newScheduleId, approval_id: existingApprovalId, status: 'scheduled' },
          { id: existingScheduleId, approval_id: existingApprovalId, status: 'published' },
        ], error: null },
      ]
      mocks.attemptRows = { data: [{
        schedule_id: existingScheduleId,
        id: existingAttemptId,
        status: 'succeeded',
        provider_reference: 'post-1',
        error_code: null,
      }], error: null }
      mocks.rpc.mockImplementation(async (name: string) => name === 'cancel_schedule_guarded'
        ? { data: null, error: { message: 'conflict' } }
        : { data: { approvalId: existingApprovalId, scheduleId: newScheduleId, next: 'publishing' }, error: null })

      await expect(approveAndDispatchAction(input)).resolves.toMatchObject({
        error: { message: '이전 게시와 겹쳐 실행을 멈췄지만 예약을 취소하지 못했어요. 일정 화면에서 예약을 취소해 주세요.' },
      })
      expect(mocks.publish).not.toHaveBeenCalled()
    })

    it('사후 확인이 불가능하면 방금 만든 예약을 취소해 cron 중복 발송을 막는다', async () => {
      const newScheduleId = '70000000-0000-4000-8000-00000000000a'
      mocks.scheduleResults = [
        { data: [], error: null },
        { data: null, error: { message: 'timeout' } },
      ]
      mocks.rpc.mockImplementation(async (name: string) => name === 'cancel_schedule_guarded'
        ? { data: null, error: null }
        : { data: { approvalId: existingApprovalId, scheduleId: newScheduleId, next: 'publishing' }, error: null })

      await expect(approveAndDispatchAction(input)).resolves.toMatchObject({
        error: { message: '게시 실행 기록을 확인하지 못해 방금 만든 예약을 취소했어요. 잠시 후 다시 시도해 주세요.' },
      })
      expect(mocks.rpc).toHaveBeenCalledWith('cancel_schedule_guarded', expect.objectContaining({
        p_schedule_id: newScheduleId,
      }))
      expect(mocks.publish).not.toHaveBeenCalled()
    })

    it('사후 확인도 예약 취소도 실패하면 남은 예약 확인을 사용자에게 명시한다', async () => {
      const newScheduleId = '70000000-0000-4000-8000-00000000000a'
      mocks.scheduleResults = [
        { data: [], error: null },
        { data: null, error: { message: 'timeout' } },
      ]
      mocks.rpc.mockImplementation(async (name: string) => name === 'cancel_schedule_guarded'
        ? { data: null, error: { message: 'conflict' } }
        : { data: { approvalId: existingApprovalId, scheduleId: newScheduleId, next: 'publishing' }, error: null })

      await expect(approveAndDispatchAction(input)).resolves.toMatchObject({
        error: { message: '게시 실행 기록을 확인하지 못했어요. 예약이 남아 있을 수 있으니 일정 화면에서 예약 상태를 확인해 주세요.' },
      })
      expect(mocks.publish).not.toHaveBeenCalled()
    })

    it('실행 기록을 읽지 못하면 통과가 아니라 재확인 요구로 막는다', async () => {
      mocks.scheduleRows = { data: null, error: { message: 'timeout' } }

      await expect(approveAndDispatchAction(input)).resolves.toMatchObject({
        error: { requestId: 'approve-and-dispatch' },
      })
      expect(mocks.rpc).not.toHaveBeenCalled()
      expect(mocks.publish).not.toHaveBeenCalled()
    })

    it('원고 버전이 바뀌었으면 승인 실행을 만들지 않고 재검토를 요구한다', async () => {
      mocks.preview.mockResolvedValue({ data: {
        ...snapshot,
        versionId: '40000000-0000-4000-8000-000000000002',
      } })

      await expect(approveAndDispatchAction(input)).resolves.toMatchObject({
        error: { message: '수정된 새 버전과 채널 연결을 다시 확인해 주세요.' },
      })
      expect(mocks.rpc).not.toHaveBeenCalled()
      expect(mocks.publish).not.toHaveBeenCalled()
    })

    it('게시 대상 채널 연결이 바뀌었으면 차단한다', async () => {
      mocks.preview.mockResolvedValue({ data: {
        ...snapshot,
        account: { ...snapshot.account, connectionId: '50000000-0000-4000-8000-000000000002' },
      } })

      await expect(approveAndDispatchAction(input)).resolves.toMatchObject({
        error: { message: '수정된 새 버전과 채널 연결을 다시 확인해 주세요.' },
      })
      expect(mocks.rpc).not.toHaveBeenCalled()
      expect(mocks.publish).not.toHaveBeenCalled()
    })

    it('권한이 만료된 채널로는 승인 실행을 만들지 않는다', async () => {
      mocks.preview.mockResolvedValue({ data: {
        ...snapshot,
        account: { ...snapshot.account, status: 'expired' },
      } })

      await expect(approveAndDispatchAction(input)).resolves.toMatchObject({
        error: { requestId: 'approve-and-dispatch' },
      })
      expect(mocks.rpc).not.toHaveBeenCalled()
      expect(mocks.publish).not.toHaveBeenCalled()
    })

    it('구성원 자격이 끝났으면 승인 실행을 만들지 않는다', async () => {
      mocks.maybeSingle.mockResolvedValue({ data: { role: 'manager', status: 'suspended' }, error: null })

      await expect(approveAndDispatchAction(input)).resolves.toMatchObject({
        error: { message: '이 작업공간에서는 콘텐츠를 승인할 수 없습니다.' },
      })
      expect(mocks.rpc).not.toHaveBeenCalled()
      expect(mocks.publish).not.toHaveBeenCalled()
    })

    it('처음 실행할 때만 승인 RPC 와 공급자 실행을 정확히 한 번씩 부른다', async () => {
      await approveAndDispatchAction(input)

      expect(mocks.rpc).toHaveBeenCalledTimes(1)
      expect(mocks.publish).toHaveBeenCalledTimes(1)
    })
  })
})
