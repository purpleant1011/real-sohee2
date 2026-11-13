import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  BrowserTask,
  BrowserTaskDriver,
  BrowserTaskService,
  transitionBrowserTask,
  InvalidStateTransitionError,
} from '@/lib/channels/browser-task-contract'
import { PublishingExecutor, PublishInput } from '@/lib/agent-os/executors/publishing-executor'

const mockInsert = vi.fn((record: any) => ({
  select: vi.fn(() => ({
    single: vi.fn(async () => ({ data: { id: 'mock-action-req-1', ...record }, error: null })),
  })),
  then: (resolve: any) => resolve({ data: { id: 'mock-action-req-1', ...record }, error: null }),
}))
const mockUpsert = vi.fn().mockResolvedValue({ error: null })

const createMockQueryBuilder = () => {
  const qb: any = {
    select: vi.fn(() => qb),
    eq: vi.fn(() => qb),
    in: vi.fn(() => qb),
    order: vi.fn(() => qb),
    limit: vi.fn(() => qb),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    single: vi.fn(async () => ({ data: null, error: null })),
    insert: mockInsert,
    upsert: mockUpsert,
    update: vi.fn(() => qb),
    then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
  }
  return qb
}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    from: vi.fn(() => createMockQueryBuilder()),
  })),
}))

vi.mock('@/lib/safety/kill-switch-guard', () => ({
  checkKillSwitchPreflight: vi.fn(async () => ({ blocked: false })),
}))

vi.mock('@/features/channels/execution-admission-gate', () => ({
  ExecutionAdmissionGate: {
    evaluate: vi.fn().mockResolvedValue({
      admitted: true,
      status: 'ADMITTED',
      dimensions: { killSwitch: true, connected: true, authorized: true, leaseAcquired: true },
    }),
  },
}))

vi.mock('@/features/channels/credential-repository', () => ({
  loadChannelCredentialByChannel: vi.fn(async () => ({
    accessToken: 'test_token_valid',
    externalAccountId: 'acc_test_123',
  })),
}))

describe('ANI-955: Browser Execution Contract (Naver Blog & Daangn)', () => {
  const workspaceId = 'ws_browser_test'

  beforeEach(() => {
    vi.clearAllMocks()
    BrowserTaskService._reset()
  })

  describe('1. Canonical BrowserTask Entity & State Machine Invariants', () => {
    it('creates a canonical BrowserTask entity with all required properties', async () => {
      const task = await BrowserTaskService.createTask({
        workspaceId,
        channel: 'NAVER_BLOG',
        sessionRef: 'session_naver_blog_ws1',
        actionRunId: 'act_run_001',
        targetUrl: 'https://blog.naver.com/studio_byreum',
        operation: 'POST_PUBLISH',
        payload: {
          title: '청라 맞춤 스타일링 안내',
          caption: '2026 가을 신상 스타일링 오픈했습니다.',
          imageUrl: 'https://cdn.sohee.app/images/hair1.jpg',
          tags: ['청라미용실', '가을헤어'],
        },
      })

      // Canonical properties check (ANI-955 specification)
      expect(task.task_id).toMatch(/^btask_/)
      expect(task.session_ref).toBe('session_naver_blog_ws1')
      expect(task.action_run_id).toBe('act_run_001')
      expect(task.target_url).toBe('https://blog.naver.com/studio_byreum')
      expect(task.operation).toBe('POST_PUBLISH')
      expect(task.state).toBe('QUEUED')
      expect(task.evidence).toEqual({})
      expect(task.retry_count).toBe(0)

      // Dual naming convention support (camelCase & snake_case)
      expect(task.taskId).toBe(task.task_id)
      expect(task.sessionRef).toBe(task.session_ref)
      expect(task.actionRunId).toBe(task.action_run_id)
      expect(task.targetUrl).toBe(task.target_url)
      expect(task.retryCount).toBe(task.retry_count)
    })

    it('enforces standard state progression: QUEUED -> PROBING -> FILLING -> AWAITING_APPROVAL -> SUBMITTING -> VERIFYING -> EXTERNAL_VERIFIED', () => {
      let task: BrowserTask = {
        task_id: 'btask_test_1',
        session_ref: 'sess_1',
        action_run_id: 'act_1',
        target_url: 'https://blog.naver.com',
        operation: 'POST_PUBLISH',
        state: 'QUEUED',
        evidence: {},
        retry_count: 0,
        workspace_id: workspaceId,
        channel: 'NAVER_BLOG',
        payload: { caption: 'test' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      task = transitionBrowserTask(task, 'PROBING')
      expect(task.state).toBe('PROBING')

      task = transitionBrowserTask(task, 'FILLING')
      expect(task.state).toBe('FILLING')

      task = transitionBrowserTask(task, 'AWAITING_APPROVAL')
      expect(task.state).toBe('AWAITING_APPROVAL')

      task = transitionBrowserTask(task, 'SUBMITTING')
      expect(task.state).toBe('SUBMITTING')

      task = transitionBrowserTask(task, 'VERIFYING')
      expect(task.state).toBe('VERIFYING')

      task = transitionBrowserTask(task, 'EXTERNAL_VERIFIED')
      expect(task.state).toBe('EXTERNAL_VERIFIED')
    })

    it('rejects illegal non-sequential state transitions (e.g. QUEUED directly to EXTERNAL_VERIFIED)', () => {
      const task: BrowserTask = {
        task_id: 'btask_test_2',
        session_ref: 'sess_1',
        action_run_id: 'act_1',
        target_url: 'https://blog.naver.com',
        operation: 'POST_PUBLISH',
        state: 'QUEUED',
        evidence: {},
        retry_count: 0,
        workspace_id: workspaceId,
        channel: 'NAVER_BLOG',
        payload: { caption: 'test' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      expect(() => transitionBrowserTask(task, 'EXTERNAL_VERIFIED')).toThrow(
        InvalidStateTransitionError
      )
    })
  })

  describe('2. Browser Driver Lifecycle Execution & Guardrails', () => {
    it('halts and sets SESSION_EXPIRED when session probe detects expired cookie token', async () => {
      const mockDriver: BrowserTaskDriver = {
        probeSession: vi.fn().mockResolvedValue({
          valid: false,
          sessionExpired: true,
          reason: '네이버 로그인 세션 쿠키가 만료되었습니다.',
        }),
        fillDraft: vi.fn(),
        submitPost: vi.fn(),
        verifyPost: vi.fn(),
      }

      const task = await BrowserTaskService.createTask({
        workspaceId,
        channel: 'NAVER_BLOG',
        sessionRef: 'expired_sess',
        actionRunId: 'act_sess_exp',
        targetUrl: 'https://blog.naver.com',
        operation: 'POST_PUBLISH',
        payload: { caption: '만료 세션 테스트' },
      })

      const executed = await BrowserTaskService.executeTaskLifecycle(task, mockDriver)

      expect(executed.state).toBe('SESSION_EXPIRED')
      expect(executed.error_code).toBe('SESSION_EXPIRED')
      expect(executed.error_message).toContain('네이버 로그인 세션 쿠키가 만료되었습니다.')
      expect(mockDriver.fillDraft).not.toHaveBeenCalled()
      expect(mockDriver.submitPost).not.toHaveBeenCalled()
    })

    it('halts and sets OWNER_HANDOFF_REQUIRED when anti-bot CAPTCHA or 2FA challenge is detected', async () => {
      const mockDriver: BrowserTaskDriver = {
        probeSession: vi.fn().mockResolvedValue({
          valid: false,
          captchaDetected: true,
          reason: 'SmartEditor 로그인 화면에서 영숫자 CAPTCHA 감지됨',
        }),
        fillDraft: vi.fn(),
        submitPost: vi.fn(),
        verifyPost: vi.fn(),
      }

      const task = await BrowserTaskService.createTask({
        workspaceId,
        channel: 'NAVER_BLOG',
        sessionRef: 'captcha_sess',
        actionRunId: 'act_captcha',
        targetUrl: 'https://blog.naver.com',
        operation: 'POST_PUBLISH',
        payload: { caption: '캡차 테스트' },
      })

      const executed = await BrowserTaskService.executeTaskLifecycle(task, mockDriver)

      expect(executed.state).toBe('OWNER_HANDOFF_REQUIRED')
      expect(executed.error_code).toBe('OWNER_HANDOFF_REQUIRED')
      expect(executed.error_message).toContain('CAPTCHA')
      expect(mockDriver.fillDraft).not.toHaveBeenCalled()
    })

    it('pauses at AWAITING_APPROVAL when autoSubmit is false (draft filled & preview created)', async () => {
      const mockDriver: BrowserTaskDriver = {
        probeSession: vi.fn().mockResolvedValue({ valid: true }),
        fillDraft: vi.fn().mockResolvedValue({
          success: true,
          previewUrl: 'https://blog.naver.com/preview/draft_123',
          draftSnapshot: '<html><body>draft content</body></html>',
        }),
        submitPost: vi.fn(),
        verifyPost: vi.fn(),
      }

      const task = await BrowserTaskService.createTask({
        workspaceId,
        channel: 'NAVER_BLOG',
        sessionRef: 'valid_sess',
        actionRunId: 'act_draft',
        targetUrl: 'https://blog.naver.com',
        operation: 'POST_PUBLISH',
        payload: { caption: '승인 대기 테스트' },
      })

      const executed = await BrowserTaskService.executeTaskLifecycle(task, mockDriver, {
        autoSubmit: false,
      })

      expect(executed.state).toBe('AWAITING_APPROVAL')
      expect(executed.evidence.domSnapshot).toBe('<html><body>draft content</body></html>')
      expect(mockDriver.submitPost).not.toHaveBeenCalled()
    })

    it('transitions to RESULT_UNKNOWN when post is submitted but independent DOM readback fails', async () => {
      const mockDriver: BrowserTaskDriver = {
        probeSession: vi.fn().mockResolvedValue({ valid: true }),
        fillDraft: vi.fn().mockResolvedValue({ success: true, draftSnapshot: 'draft_html' }),
        submitPost: vi.fn().mockResolvedValue({
          success: true,
          publishedUrl: 'https://blog.naver.com/studio_byreum/223789001',
          externalPostId: '223789001',
        }),
        verifyPost: vi.fn().mockResolvedValue({
          verified: false,
          isLive: false,
          error: '게시글 URL 접속 시 404 Not Found 또는 임시 비공개 상태',
        }),
      }

      const task = await BrowserTaskService.createTask({
        workspaceId,
        channel: 'NAVER_BLOG',
        sessionRef: 'valid_sess',
        actionRunId: 'act_readback_fail',
        targetUrl: 'https://blog.naver.com',
        operation: 'POST_PUBLISH',
        payload: { caption: 'readback 실패 테스트' },
      })

      const executed = await BrowserTaskService.executeTaskLifecycle(task, mockDriver, {
        autoSubmit: true,
      })

      expect(executed.state).toBe('RESULT_UNKNOWN')
      expect(executed.error_code).toBe('READBACK_FAILED')
      expect(executed.evidence.publishedUrl).toBe('https://blog.naver.com/studio_byreum/223789001')
      expect(executed.evidence.externalPostId).toBe('223789001')
    })

    it('transitions to EXTERNAL_VERIFIED when submit and independent DOM readback both succeed', async () => {
      const mockDriver: BrowserTaskDriver = {
        probeSession: vi.fn().mockResolvedValue({ valid: true }),
        fillDraft: vi.fn().mockResolvedValue({ success: true, draftSnapshot: 'draft_html' }),
        submitPost: vi.fn().mockResolvedValue({
          success: true,
          publishedUrl: 'https://blog.naver.com/studio_byreum/223789999',
          externalPostId: '223789999',
          domSnapshot: '<div>submitted</div>',
        }),
        verifyPost: vi.fn().mockResolvedValue({
          verified: true,
          isLive: true,
          publishedUrl: 'https://blog.naver.com/studio_byreum/223789999',
          externalPostId: '223789999',
          domSnapshotDigest: 'sha256_verified_digest_999',
          screenshotUrl: 'https://cdn.sohee.app/screenshots/nblog_223789999.png',
        }),
      }

      const task = await BrowserTaskService.createTask({
        workspaceId,
        channel: 'NAVER_BLOG',
        sessionRef: 'valid_sess',
        actionRunId: 'act_success',
        targetUrl: 'https://blog.naver.com',
        operation: 'POST_PUBLISH',
        payload: { caption: '발행 성공 테스트' },
      })

      const executed = await BrowserTaskService.executeTaskLifecycle(task, mockDriver, {
        autoSubmit: true,
      })

      expect(executed.state).toBe('EXTERNAL_VERIFIED')
      expect(executed.evidence.publishedUrl).toBe('https://blog.naver.com/studio_byreum/223789999')
      expect(executed.evidence.externalPostId).toBe('223789999')
      expect(executed.evidence.readbackDigest).toBe('sha256_verified_digest_999')
      expect(executed.evidence.screenshotUrl).toBe('https://cdn.sohee.app/screenshots/nblog_223789999.png')
      expect(executed.evidence.verifiedAt).toBeDefined()
    })
  })

  describe('3. PublishingExecutor End-to-End Integration (Naver Blog & Daangn)', () => {
        it('blocks Naver Blog automation by policy even without a browserDriver', async () => {
      const driver = { probeSession: vi.fn(), fillDraft: vi.fn(), submitPost: vi.fn(), verifyPost: vi.fn() }
      const res = await PublishingExecutor.executePublish({
        workspaceId,
        channel: 'NAVER_BLOG',
        caption: '네이버 포스팅 시도',
        imageUrl: 'https://cdn.sohee.app/images/blog.jpg',
        browserDriver: driver as unknown as BrowserTaskDriver,
        autoSubmit: true,
      })
      // V1.2: 네이버 자동 게시는 정책상 어떤 경우에도 실행되지 않는다(드라이버 호출 0).
      expect(res.success).toBe(false)
      expect(res.verified).toBe(false)
      expect(res.stage).toBe('FAILED')
      expect(res.errorCode).toBe('POLICY_DISABLED')
      expect(driver.probeSession).not.toHaveBeenCalled()
      expect(driver.fillDraft).not.toHaveBeenCalled()
      expect(driver.submitPost).not.toHaveBeenCalled()
    })

        it('blocks Naver Blog automation by policy instead of probing the session', async () => {
      const driver = { probeSession: vi.fn(), fillDraft: vi.fn(), submitPost: vi.fn(), verifyPost: vi.fn() }
      const res = await PublishingExecutor.executePublish({
        workspaceId,
        channel: 'NAVER_BLOG',
        caption: '네이버 포스팅 시도',
        imageUrl: 'https://cdn.sohee.app/images/blog.jpg',
        browserDriver: driver as unknown as BrowserTaskDriver,
        autoSubmit: true,
      })
      // V1.2: 네이버 자동 게시는 정책상 어떤 경우에도 실행되지 않는다(드라이버 호출 0).
      expect(res.success).toBe(false)
      expect(res.verified).toBe(false)
      expect(res.stage).toBe('FAILED')
      expect(res.errorCode).toBe('POLICY_DISABLED')
      expect(driver.probeSession).not.toHaveBeenCalled()
      expect(driver.fillDraft).not.toHaveBeenCalled()
      expect(driver.submitPost).not.toHaveBeenCalled()
    })

    it('returns FAILED with OWNER_HANDOFF_REQUIRED when CAPTCHA is encountered', async () => {
      const mockDriver: BrowserTaskDriver = {
        probeSession: vi.fn().mockResolvedValue({
          valid: false,
          captchaDetected: true,
          reason: '당근 비즈프로필 보안 문자 확인 필요',
        }),
        fillDraft: vi.fn(),
        submitPost: vi.fn(),
        verifyPost: vi.fn(),
      }

      const res = await PublishingExecutor.executePublish({
        workspaceId,
        channel: 'DAANGN',
        caption: '당근 소식 발행 시도',
        imageUrl: 'https://cdn.sohee.app/images/daangn.jpg',
        browserDriver: mockDriver,
        autoSubmit: true,
      })

      expect(res.success).toBe(false)
      expect(res.verified).toBe(false)
      expect(res.stage).toBe('FAILED')
      expect(res.errorCode).toBe('OWNER_HANDOFF_REQUIRED')
      expect(res.statusMessage).toContain('점주 개입이 필요')
    })

    it('returns RESULT_UNKNOWN when publishing succeeds but DOM readback fails on Daangn', async () => {
      const mockDriver: BrowserTaskDriver = {
        probeSession: vi.fn().mockResolvedValue({ valid: true }),
        fillDraft: vi.fn().mockResolvedValue({ success: true }),
        submitPost: vi.fn().mockResolvedValue({
          success: true,
          publishedUrl: 'https://business.daangn.com/articles/d_12345',
          externalPostId: 'd_12345',
        }),
        verifyPost: vi.fn().mockResolvedValue({
          verified: false,
          isLive: false,
          error: '당근 피드에서 작성된 소식을 찾을 수 없습니다.',
        }),
      }

      const res = await PublishingExecutor.executePublish({
        workspaceId,
        channel: 'DAANGN',
        caption: '당근 할인 이벤트 소식',
        imageUrl: 'https://cdn.sohee.app/images/daangn.jpg',
        browserDriver: mockDriver,
        autoSubmit: true,
      })

      expect(res.success).toBe(false)
      expect(res.verified).toBe(false)
      expect(res.stage).toBe('RESULT_UNKNOWN')
      expect(res.errorCode).toBe('READBACK_FAILED')
      expect(res.externalPostId).toBe('d_12345')
      expect(res.publishedUrl).toBe('https://business.daangn.com/articles/d_12345')
    })

        it('never publishes to Naver Blog even when a full-cycle driver is supplied', async () => {
      const driver = { probeSession: vi.fn(), fillDraft: vi.fn(), submitPost: vi.fn(), verifyPost: vi.fn() }
      const res = await PublishingExecutor.executePublish({
        workspaceId,
        channel: 'NAVER_BLOG',
        caption: '네이버 포스팅 시도',
        imageUrl: 'https://cdn.sohee.app/images/blog.jpg',
        browserDriver: driver as unknown as BrowserTaskDriver,
        autoSubmit: true,
      })
      // V1.2: 네이버 자동 게시는 정책상 어떤 경우에도 실행되지 않는다(드라이버 호출 0).
      expect(res.success).toBe(false)
      expect(res.verified).toBe(false)
      expect(res.stage).toBe('FAILED')
      expect(res.errorCode).toBe('POLICY_DISABLED')
      expect(driver.probeSession).not.toHaveBeenCalled()
      expect(driver.fillDraft).not.toHaveBeenCalled()
      expect(driver.submitPost).not.toHaveBeenCalled()
    })
  })
})
