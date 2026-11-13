import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  executeTaskLifecycle: vi.fn(),
  createActionRequest: vi.fn().mockResolvedValue({ requestId: 'req-1' }),
  startAttempt: vi.fn().mockResolvedValue({ attemptId: 'att-1' }),
  checkKillSwitchPreflight: vi.fn().mockResolvedValue({ blocked: false }),
  admissionEvaluate: vi.fn().mockResolvedValue({ admitted: true }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  })),
}))

vi.mock('@/lib/safety/kill-switch-guard', () => ({
  checkKillSwitchPreflight: mocks.checkKillSwitchPreflight,
}))

vi.mock('@/features/channels/execution-admission-gate', () => ({
  ExecutionAdmissionGate: {
    evaluate: mocks.admissionEvaluate,
  },
}))

vi.mock('@/features/external-actions/canonical-action-ledger', () => ({
  CanonicalActionLedgerService: {
    createActionRequest: mocks.createActionRequest,
    startAttempt: mocks.startAttempt,
  },
}))

vi.mock('@/lib/channels/browser-task-contract', () => ({
  BrowserTaskService: {
    createTask: mocks.createTask,
    executeTaskLifecycle: mocks.executeTaskLifecycle,
  },
}))

import { PublishingExecutor } from './publishing-executor'

describe('PublishingExecutor NAVER_BLOG fail-closed policy (V1.2 G0-02/03)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkKillSwitchPreflight.mockResolvedValue({ blocked: false })
    mocks.admissionEvaluate.mockResolvedValue({ admitted: true })
    mocks.createTask.mockResolvedValue({ task_id: 'task-1' })
  })

  it('fails with POLICY_DISABLED and zero calls to BrowserTaskService when channel is NAVER_BLOG', async () => {
    const result = await PublishingExecutor.executePublish({
      workspaceId: '10000000-0000-4000-8000-000000000001',
      channel: 'NAVER_BLOG',
      caption: '네이버 블로그 게시글 내용입니다.',
      title: '제목',
      contentVersionId: '20000000-0000-4000-8000-000000000001',
      expectedFingerprint: 'a'.repeat(64),
    })

    expect(result.success).toBe(false)
    expect(result.stage).toBe('FAILED')
    expect(result.channel).toBe('NAVER_BLOG')
    expect(result.errorCode).toBe('POLICY_DISABLED')
    expect(result.statusMessage).toContain('직접')

    // BrowserTaskService 호출 0회 검증
    expect(mocks.createTask).not.toHaveBeenCalled()
    expect(mocks.executeTaskLifecycle).not.toHaveBeenCalled()
    // CanonicalActionLedgerService 호출 0회 검증
    expect(mocks.createActionRequest).not.toHaveBeenCalled()
    expect(mocks.startAttempt).not.toHaveBeenCalled()
  })

  it('preserves existing browser execution flow for DAANGN channel', async () => {
    const result = await PublishingExecutor.executePublish({
      workspaceId: '10000000-0000-4000-8000-000000000001',
      channel: 'DAANGN',
      caption: '당근 비즈니스 소식입니다.',
      title: '당근 소식',
      contentVersionId: '20000000-0000-4000-8000-000000000001',
      expectedFingerprint: 'a'.repeat(64),
    })

    expect(result.channel).toBe('DAANGN')
    expect(result.stage).toBe('AWAITING_BROWSER_EXECUTION')
    expect(mocks.createActionRequest).toHaveBeenCalled()
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'DAANGN',
    }))
  })
})
