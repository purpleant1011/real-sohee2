import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendInstagramDm } from './send-dm'
import {
  computeDmApprovalFingerprint,
  DM_EXPIRED_KOREAN_MESSAGE,
} from './options-generator'
import type { InstagramDmRepository } from './repository'
import type { InstagramDmThread } from './types'

// Mock external dependencies
vi.mock('@/lib/safety/kill-switch-guard', () => ({
  checkKillSwitchPreflight: vi.fn().mockResolvedValue({ blocked: false }),
}))

vi.mock('@/features/channels/execution-admission-gate', () => ({
  ExecutionAdmissionGate: {
    evaluate: vi.fn().mockResolvedValue({ admitted: true, status: 'ADMITTED', message: '허가' }),
  },
}))

vi.mock('@/features/external-actions/canonical-action-ledger', () => ({
  CanonicalActionLedgerService: {
    createActionRequest: vi.fn().mockResolvedValue({
      requestId: 'act-req-dm-1',
      status: 'prepared',
      isExisting: false,
    }),
    startAttempt: vi.fn().mockResolvedValue({
      attemptId: 'att-dm-1',
      attemptNumber: 1,
    }),
    recordReceiptAndVerify: vi.fn().mockResolvedValue({
      receiptId: 'rcpt-dm-1',
    }),
    markUnknownResult: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/lib/providers/meta-api', () => ({
  sendInstagramDirectMessage: vi.fn().mockResolvedValue({ providerMessageId: 'ig-msg-123' }),
  getInstagramDirectMessageReadback: vi.fn().mockResolvedValue({
    isLive: true,
    messageId: 'ig-msg-123',
    observedAt: new Date().toISOString(),
  }),
}))

const TEST_WS_ID = '00000000-0000-4000-8000-0000000000a1'

const baseThread: InstagramDmThread = {
  id: 'th-100',
  workspace_id: TEST_WS_ID,
  channel_connection_id: 'conn-100',
  channel: 'instagram',
  provider_thread_id: 'prov-th-100',
  customer_id: 'cust-100',
  customer_handle: 'happy_customer',
  customer_name: '홍길동',
  last_message_at: new Date(Date.now() - 3600 * 1000).toISOString(),
  expires_at: new Date(Date.now() + 23 * 3600 * 1000).toISOString(),
  status: 'NEEDS_REPLY',
  last_message_text: '예약 문의드려요!',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

describe('sendInstagramDm Guardrails and Hard Invariants', () => {
  let mockRepo: InstagramDmRepository
  let originalEnv: string | undefined
  let originalAllowlist: string | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    originalEnv = process.env.ENGAGEMENT_SEND_ENABLED
    originalAllowlist = process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST
    process.env.ENGAGEMENT_SEND_ENABLED = '1'
    process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '*'

    mockRepo = {
      findThreadById: vi.fn().mockResolvedValue(baseThread),
      listThreads: vi.fn().mockResolvedValue({ threads: [baseThread] }),
      updateThreadStatus: vi.fn().mockResolvedValue(undefined),
      listMessages: vi.fn().mockResolvedValue([]),
      insertMessage: vi.fn().mockResolvedValue({ id: 'msg-1', text: '답장' } as any),
      upsertThread: vi.fn().mockResolvedValue(baseThread),
      findDraftByThreadId: vi.fn().mockResolvedValue({
        id: 'dr-100',
        workspace_id: TEST_WS_ID,
        thread_id: 'th-100',
        selected_option_id: 'opt_reservation',
        options: [],
        draft_text: '안녕하세요! 예약 안내 도와드릴게요.',
        approved_fingerprint: computeDmApprovalFingerprint(
          TEST_WS_ID,
          'th-100',
          '안녕하세요! 예약 안내 도와드릴게요.'
        ),
        approved_by: 'user-1',
        approved_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
      saveDraft: vi.fn().mockResolvedValue({} as any),
      updateDraft: vi.fn().mockResolvedValue({} as any),
      approveDraft: vi.fn().mockResolvedValue({} as any),
      recordAudit: vi.fn().mockResolvedValue(undefined),
      findThreadByProviderThreadId: vi.fn().mockResolvedValue(null),
      insertMessageIfAbsent: vi.fn().mockResolvedValue({ inserted: true }),
      findExistingProviderMessageIds: vi.fn().mockResolvedValue(new Set()),
      latestThreadActivityAt: vi.fn().mockResolvedValue(null),
    }
  })

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ENGAGEMENT_SEND_ENABLED = originalEnv
    } else {
      delete process.env.ENGAGEMENT_SEND_ENABLED
    }
    if (originalAllowlist !== undefined) {
      process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = originalAllowlist
    } else {
      delete process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST
    }
  })

  it('Guardrail 1: refuses sending when ENGAGEMENT_SEND_ENABLED is not 1', async () => {
    process.env.ENGAGEMENT_SEND_ENABLED = '0'

    const result = await sendInstagramDm(
      baseThread,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn(),
      }
    )

    expect(result.sent).toBe(false)
    expect(result.reason).toContain('비활성화')
  })

  it('Guardrail 2 (Hard Invariant 2): refuses sending when 24-hour window has expired', async () => {
    const expiredThread: InstagramDmThread = {
      ...baseThread,
      expires_at: new Date(Date.now() - 60 * 1000).toISOString(), // expired 1 min ago
    }

    const result = await sendInstagramDm(
      expiredThread,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn(),
      }
    )

    expect(result.sent).toBe(false)
    expect(result.status).toBe('EXPIRED')
    expect(result.reason).toBe(DM_EXPIRED_KOREAN_MESSAGE)
    expect(mockRepo.updateThreadStatus).toHaveBeenCalledWith(TEST_WS_ID, 'th-100', 'EXPIRED')
  })

  it('Guardrail 3: refuses double send if thread already SENT', async () => {
    const sentThread: InstagramDmThread = {
      ...baseThread,
      status: 'SENT',
    }

    const result = await sendInstagramDm(
      sentThread,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn(),
      }
    )

    expect(result.sent).toBe(false)
    expect(result.status).toBe('SENT')
    expect(result.reason).toContain('이미 답장을 보낸')
  })

  it('Guardrail 4: refuses sending if draft is empty', async () => {
    mockRepo.findDraftByThreadId = vi.fn().mockResolvedValue(null)

    const result = await sendInstagramDm(
      baseThread,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn(),
      }
    )

    expect(result.sent).toBe(false)
    expect(result.reason).toContain('답장 문안이 없습니다')
  })

  it('Guardrail 5 (Hard Invariant 3): refuses sending if approved fingerprint does not match draft text', async () => {
    mockRepo.findDraftByThreadId = vi.fn().mockResolvedValue({
      id: 'dr-100',
      workspace_id: 'ws-100',
      thread_id: 'th-100',
      draft_text: '수정된 다른 문안입니다.',
      approved_fingerprint: computeDmApprovalFingerprint(
        'ws-100',
        'th-100',
        '이전 원본 문안'
      ),
    })

    const result = await sendInstagramDm(
      baseThread,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn(),
      }
    )

    expect(result.sent).toBe(false)
    expect(result.reason).toContain('승인된 문안과 현재 문안이 일치하지 않습니다')
  })

  it('Guardrail 6: refuses sending if kill switch is blocked', async () => {
    const { checkKillSwitchPreflight } = await import('@/lib/safety/kill-switch-guard')
    vi.mocked(checkKillSwitchPreflight).mockResolvedValueOnce({
      blocked: true,
      reason: '관리자에 의해 긴급 중단되었습니다.',
    } as any)

    const result = await sendInstagramDm(
      baseThread,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn(),
      }
    )

    expect(result.sent).toBe(false)
    expect(result.reason).toContain('긴급 중단')
  })

  it('Guardrail 7: refuses sending if instagram_manage_messages scope is missing', async () => {
    const result = await sendInstagramDm(
      baseThread,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn().mockResolvedValue({
          accessToken: 'valid-meta-token',
          externalAccountId: 'page-100',
          grantedScopes: ['instagram_basic', 'instagram_manage_comments'], // missing instagram_manage_messages
        }),
      }
    )

    expect(result.sent).toBe(false)
    expect(result.reason).toContain('메시지 관리 권한이 부여되지 않았습니다')
  })

  it('Guardrail 8: provider error moves status to NEEDS_CHECK with NO auto-retry', async () => {
    const { sendInstagramDirectMessage } = await import('@/lib/providers/meta-api')
    vi.mocked(sendInstagramDirectMessage).mockRejectedValueOnce(new Error('Meta Network 500'))

    const result = await sendInstagramDm(
      baseThread,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn().mockResolvedValue({
          accessToken: 'valid-meta-token',
          externalAccountId: 'page-100',
          grantedScopes: ['instagram_manage_messages'],
        }),
      }
    )

    expect(result.sent).toBe(false)
    expect(result.status).toBe('NEEDS_CHECK')
    expect(result.reason).toBe('답장이 보내졌는지 확인해 주세요')
    expect(mockRepo.updateThreadStatus).toHaveBeenCalledWith(TEST_WS_ID, 'th-100', 'NEEDS_CHECK')
  })

  it('Guardrail 9: readback failure moves status to NEEDS_CHECK', async () => {
    const { getInstagramDirectMessageReadback } = await import('@/lib/providers/meta-api')
    vi.mocked(getInstagramDirectMessageReadback).mockResolvedValueOnce({
      isLive: false,
      messageId: 'ig-msg-123',
      observedAt: new Date().toISOString(),
      error: 'Not found',
    })

    const result = await sendInstagramDm(
      baseThread,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn().mockResolvedValue({
          accessToken: 'valid-meta-token',
          externalAccountId: 'page-100',
          grantedScopes: ['instagram_manage_messages'],
        }),
      }
    )

    expect(result.sent).toBe(false)
    expect(result.status).toBe('NEEDS_CHECK')
    expect(result.reason).toBe('답장이 보내졌는지 확인해 주세요')
  })

  it('Guardrail 10: successful send updates status to SENT and writes audit record', async () => {
    const result = await sendInstagramDm(
      baseThread,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn().mockResolvedValue({
          accessToken: 'valid-meta-token',
          externalAccountId: 'page-100',
          grantedScopes: ['instagram_manage_messages'],
        }),
      }
    )

    expect(result.sent).toBe(true)
    expect(result.status).toBe('SENT')
    expect(result.providerMessageId).toBe('ig-msg-123')
    expect(mockRepo.updateThreadStatus).toHaveBeenCalledWith(TEST_WS_ID, 'th-100', 'SENT')
    expect(mockRepo.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'manual_send',
        readback_verified: true,
        provider_message_id: 'ig-msg-123',
      })
    )
  })

  it('scrubs draft text and customer identifiers from audit log on successful send', async () => {
    const draftText = '안녕하세요! 예약 안내 도와드릴게요.'
    const approvedFingerprint = computeDmApprovalFingerprint(
      TEST_WS_ID,
      'th-100',
      draftText
    )

    await sendInstagramDm(
      baseThread,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn().mockResolvedValue({
          accessToken: 'valid-meta-token',
          externalAccountId: 'page-100',
          grantedScopes: ['instagram_manage_messages'],
        }),
      }
    )

    const auditCall = vi.mocked(mockRepo.recordAudit).mock.calls.find(
      ([record]) => record.action === 'manual_send'
    )
    expect(auditCall).toBeDefined()
    const details = auditCall![0].details as Record<string, unknown>
    expect(details).not.toHaveProperty('draftText')
    expect(details).not.toHaveProperty('customerHandle')
    expect(details).not.toHaveProperty('customerId')
    expect(details.draftFingerprint).toBe(approvedFingerprint)
    expect(details.draftLength).toBe(draftText.length)
  })

  it('Guardrail 1: refuses sending when workspace is not in ENGAGEMENT_WORKSPACE_ALLOWLIST, even if flag is 1', async () => {
    process.env.ENGAGEMENT_SEND_ENABLED = '1'
    process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '00000000-0000-4000-8000-0000000000a2' // other workspace

    const { sendInstagramDirectMessage } = await import('@/lib/providers/meta-api')
    vi.mocked(sendInstagramDirectMessage).mockClear()

    const result = await sendInstagramDm(
      baseThread,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn().mockResolvedValue({
          accessToken: 'valid-meta-token',
          externalAccountId: 'page-100',
          grantedScopes: ['instagram_manage_messages'],
        }),
      }
    )

    expect(result.sent).toBe(false)
    expect(result.status).toBe(baseThread.status)
    expect(result.reason).toBe('이 워크스페이스에서는 아직 소통함 발송을 열지 않았어요.')
    expect(mockRepo.updateThreadStatus).not.toHaveBeenCalled()
    expect(sendInstagramDirectMessage).not.toHaveBeenCalled()
  })

  it('Guardrail 5: expectedSourceMessageId 불일치(새 고객 인바운드 도착) 시 발송을 차단한다 (stale 승인 방지)', async () => {
    process.env.ENGAGEMENT_SEND_ENABLED = '1'
    process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '*'

    // Thread contains latest customer message msg-new
    vi.mocked(mockRepo.listMessages).mockResolvedValue([
      {
        id: 'msg-old',
        workspace_id: TEST_WS_ID,
        thread_id: 'th-100',
        provider_message_id: 'prov-msg-old',
        sender_type: 'customer',
        sender_id: 'cust-100',
        text: '첫 문의',
        sent_at: '2026-10-16T10:00:00Z',
        created_at: '2026-10-16T10:00:00Z',
      },
      {
        id: 'msg-new',
        workspace_id: TEST_WS_ID,
        thread_id: 'th-100',
        provider_message_id: 'prov-msg-new',
        sender_type: 'customer',
        sender_id: 'cust-100',
        text: '새 문의',
        sent_at: '2026-10-16T10:05:00Z',
        created_at: '2026-10-16T10:05:00Z',
      },
    ])

    const { sendInstagramDirectMessage } = await import('@/lib/providers/meta-api')
    vi.mocked(sendInstagramDirectMessage).mockClear()

    const result = await sendInstagramDm(
      baseThread,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn().mockResolvedValue({
          accessToken: 'valid-meta-token',
          externalAccountId: 'page-100',
          grantedScopes: ['instagram_manage_messages'],
        }),
      },
      {
        expectedSourceMessageId: 'msg-old', // User approved against msg-old, but msg-new arrived
      }
    )

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('새로운 고객 메시지가 수신되어 승인이 만료되었습니다. 대화를 다시 확인해 주세요.')
    expect(sendInstagramDirectMessage).not.toHaveBeenCalled()
  })

  it('expectedSourceMessageId 일치 시 idempotencyKey에 sourceMessageId가 결속된다', async () => {
    process.env.ENGAGEMENT_SEND_ENABLED = '1'
    process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '*'

    vi.mocked(mockRepo.listMessages).mockResolvedValue([
      {
        id: 'msg-match',
        workspace_id: TEST_WS_ID,
        thread_id: 'th-100',
        provider_message_id: 'prov-msg-match',
        sender_type: 'customer',
        sender_id: 'cust-100',
        text: '문의',
        sent_at: '2026-10-16T10:00:00Z',
        created_at: '2026-10-16T10:00:00Z',
      },
    ])

    const { CanonicalActionLedgerService } = await import('@/features/external-actions/canonical-action-ledger')
    vi.mocked(CanonicalActionLedgerService.createActionRequest).mockClear()

    const result = await sendInstagramDm(
      baseThread,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn().mockResolvedValue({
          accessToken: 'valid-meta-token',
          externalAccountId: 'page-100',
          grantedScopes: ['instagram_manage_messages'],
        }),
      },
      {
        expectedSourceMessageId: 'msg-match',
      }
    )

    expect(result.sent).toBe(true)
    expect(CanonicalActionLedgerService.createActionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `dm:${TEST_WS_ID}:instagram:${baseThread.provider_thread_id}:msg-match`,
      })
    )
  })

  describe('ANI-1777 전송/저장 truth 분리', () => {
    const credential = () =>
      vi.fn().mockResolvedValue({
        accessToken: 'valid-meta-token',
        externalAccountId: 'page-100',
        grantedScopes: ['instagram_manage_messages'],
      })

    it('NEEDS_CHECK 대화는 중복 발송 방지를 위해 provider POST를 시작하지 않는다', async () => {
      const { sendInstagramDirectMessage } = await import('@/lib/providers/meta-api')
      vi.mocked(sendInstagramDirectMessage).mockClear()

      const result = await sendInstagramDm(
        { ...baseThread, status: 'NEEDS_CHECK' },
        { type: 'owner', userId: 'user-1' },
        { repo: mockRepo, getChannelCredential: credential() }
      )

      expect(result.sent).toBe(false)
      expect(result.status).toBe('NEEDS_CHECK')
      expect(result.providerOutcome).toBe('NOT_ATTEMPTED')
      expect(result.localOutcome).toBe('NOT_STARTED')
      expect(result.reason).toContain('대사 확인이 필요한 대화입니다')
      expect(sendInstagramDirectMessage).not.toHaveBeenCalled()
      expect(mockRepo.updateThreadStatus).not.toHaveBeenCalled()
    })

    it('기존 완료 요청에 전송 참조번호가 없으면 SENT로 단정하지 않는다', async () => {
      const { CanonicalActionLedgerService } = await import('@/features/external-actions/canonical-action-ledger')
      const { sendInstagramDirectMessage } = await import('@/lib/providers/meta-api')
      vi.mocked(sendInstagramDirectMessage).mockClear()
      vi.mocked(CanonicalActionLedgerService.createActionRequest).mockResolvedValueOnce({
        requestId: 'act-req-existing-noprov',
        status: 'succeeded',
        isExisting: true,
      } as any)

      const result = await sendInstagramDm(
        baseThread,
        { type: 'owner', userId: 'user-1' },
        { repo: mockRepo, getChannelCredential: credential() }
      )

      expect(result.sent).toBe(false)
      expect(result.status).toBe('NEEDS_CHECK')
      expect(result.providerOutcome).toBe('DELIVERY_UNKNOWN')
      expect(result.localOutcome).toBe('RECONCILIATION_REQUIRED')
      expect(result.reason).toContain('전송 증거(참조번호)가 없습니다')
      expect(sendInstagramDirectMessage).not.toHaveBeenCalled()
      expect(mockRepo.updateThreadStatus).toHaveBeenCalledWith(TEST_WS_ID, 'th-100', 'NEEDS_CHECK')
    })

    it('기존 완료 요청에 참조번호가 있어도 이번 호출의 readback 없이는 성공으로 응답하지 않는다', async () => {
      const { CanonicalActionLedgerService } = await import('@/features/external-actions/canonical-action-ledger')
      const { sendInstagramDirectMessage } = await import('@/lib/providers/meta-api')
      vi.mocked(sendInstagramDirectMessage).mockClear()
      vi.mocked(CanonicalActionLedgerService.createActionRequest).mockResolvedValueOnce({
        requestId: 'act-req-existing-valid',
        status: 'succeeded',
        isExisting: true,
        providerReference: 'ig-msg-existing-999',
      } as any)

      const result = await sendInstagramDm(
        baseThread,
        { type: 'owner', userId: 'user-1' },
        { repo: mockRepo, getChannelCredential: credential() }
      )

      expect(result.sent).toBe(false)
      expect(result.status).toBe('NEEDS_CHECK')
      expect(result.providerOutcome).toBe('ACCEPTED_BUT_UNVERIFIED')
      expect(result.localOutcome).toBe('RECONCILIATION_REQUIRED')
      expect(result.providerMessageId).toBe('ig-msg-existing-999')
      expect(sendInstagramDirectMessage).not.toHaveBeenCalled()
    })

    it('readback 검증 후 원장 저장 실패 시 외부 전송은 숨기지 않고 로컬 정산 실패로 표시한다', async () => {
      const { CanonicalActionLedgerService } = await import('@/features/external-actions/canonical-action-ledger')
      vi.mocked(CanonicalActionLedgerService.recordReceiptAndVerify).mockRejectedValueOnce(
        new Error('receipt table unavailable')
      )

      const result = await sendInstagramDm(
        baseThread,
        { type: 'owner', userId: 'user-1' },
        { repo: mockRepo, getChannelCredential: credential() }
      )

      expect(result.sent).toBe(true)
      expect(result.status).toBe('NEEDS_CHECK')
      expect(result.providerOutcome).toBe('READBACK_VERIFIED')
      expect(result.localOutcome).toBe('RECONCILIATION_REQUIRED')
      expect(result.providerMessageId).toBe('ig-msg-123')
      expect(result.reason).toContain('전송 증거(원장) 저장 실패')
      expect(mockRepo.updateThreadStatus).not.toHaveBeenCalledWith(TEST_WS_ID, 'th-100', 'SENT')
      expect(mockRepo.updateThreadStatus).toHaveBeenCalledWith(TEST_WS_ID, 'th-100', 'NEEDS_CHECK')
    })

    it('감사 로그 저장 실패 시 SENT로 넘어가지 않고 대사 확인으로 종료한다', async () => {
      vi.mocked(mockRepo.recordAudit).mockRejectedValueOnce(new Error('audit insert failed'))

      const result = await sendInstagramDm(
        baseThread,
        { type: 'owner', userId: 'user-1' },
        { repo: mockRepo, getChannelCredential: credential() }
      )

      expect(result.sent).toBe(true)
      expect(result.status).toBe('NEEDS_CHECK')
      expect(result.localOutcome).toBe('RECONCILIATION_REQUIRED')
      expect(result.reason).toContain('감사 로그 저장 실패')
      expect(mockRepo.updateThreadStatus).not.toHaveBeenCalledWith(TEST_WS_ID, 'th-100', 'SENT')
    })

    it('감사 로그가 recorded=false로 보고되어도 SENT로 넘어가지 않는다', async () => {
      vi.mocked(mockRepo.recordAudit).mockResolvedValueOnce({ recorded: false })

      const result = await sendInstagramDm(
        baseThread,
        { type: 'owner', userId: 'user-1' },
        { repo: mockRepo, getChannelCredential: credential() }
      )

      expect(result.sent).toBe(true)
      expect(result.status).toBe('NEEDS_CHECK')
      expect(result.localOutcome).toBe('RECONCILIATION_REQUIRED')
      expect(result.reason).toContain('감사 로그 저장 실패')
      expect(mockRepo.updateThreadStatus).not.toHaveBeenCalledWith(TEST_WS_ID, 'th-100', 'SENT')
    })

    it('provider 결과가 불확실하고 격리 상태 저장까지 실패하면 PERSISTENCE_FAILED로 보고한다', async () => {
      const { sendInstagramDirectMessage } = await import('@/lib/providers/meta-api')
      vi.mocked(sendInstagramDirectMessage).mockRejectedValueOnce(new Error('Meta timeout'))
      vi.mocked(mockRepo.updateThreadStatus).mockRejectedValueOnce(new Error('0 rows affected'))

      const result = await sendInstagramDm(
        baseThread,
        { type: 'owner', userId: 'user-1' },
        { repo: mockRepo, getChannelCredential: credential() }
      )

      expect(result.sent).toBe(false)
      expect(result.status).toBe('NEEDS_CHECK')
      expect(result.providerOutcome).toBe('DELIVERY_UNKNOWN')
      expect(result.localOutcome).toBe('PERSISTENCE_FAILED')
      expect(result.reason).toContain('대화 상태도 저장하지 못했습니다')
    })

    it('readback 실패 후 격리 상태 저장이 실패하면 PERSISTENCE_FAILED로 보고한다', async () => {
      const { getInstagramDirectMessageReadback } = await import('@/lib/providers/meta-api')
      vi.mocked(getInstagramDirectMessageReadback).mockResolvedValueOnce({
        isLive: false,
        messageId: 'ig-msg-123',
        observedAt: new Date().toISOString(),
        error: 'Not found',
      })
      vi.mocked(mockRepo.updateThreadStatus).mockRejectedValueOnce(new Error('0 rows affected'))

      const result = await sendInstagramDm(
        baseThread,
        { type: 'owner', userId: 'user-1' },
        { repo: mockRepo, getChannelCredential: credential() }
      )

      expect(result.sent).toBe(false)
      expect(result.status).toBe('NEEDS_CHECK')
      expect(result.localOutcome).toBe('PERSISTENCE_FAILED')
      expect(result.providerMessageId).toBe('ig-msg-123')
    })

    it('메시지 내역 저장 실패 시 SENT로 넘어가지 않고 대사 확인으로 종료한다', async () => {
      vi.mocked(mockRepo.insertMessageIfAbsent).mockRejectedValueOnce(new Error('message insert failed'))

      const result = await sendInstagramDm(
        baseThread,
        { type: 'owner', userId: 'user-1' },
        { repo: mockRepo, getChannelCredential: credential() }
      )

      expect(result.sent).toBe(true)
      expect(result.status).toBe('NEEDS_CHECK')
      expect(result.localOutcome).toBe('RECONCILIATION_REQUIRED')
      expect(result.reason).toContain('메시지 내역 저장 실패')
      expect(mockRepo.updateThreadStatus).not.toHaveBeenCalledWith(TEST_WS_ID, 'th-100', 'SENT')
    })

    it('대화 상태 SENT 갱신이 실패하면 NEEDS_CHECK로 되돌린다', async () => {
      vi.mocked(mockRepo.updateThreadStatus).mockImplementation(async (_ws, _id, status) => {
        if (status === 'SENT') throw new Error('0 rows affected')
      })

      const result = await sendInstagramDm(
        baseThread,
        { type: 'owner', userId: 'user-1' },
        { repo: mockRepo, getChannelCredential: credential() }
      )

      expect(result.sent).toBe(true)
      expect(result.status).toBe('NEEDS_CHECK')
      expect(result.localOutcome).toBe('RECONCILIATION_REQUIRED')
      expect(result.reason).toContain('대화 상태 SENT 갱신 실패')
      expect(mockRepo.updateThreadStatus).toHaveBeenCalledWith(TEST_WS_ID, 'th-100', 'NEEDS_CHECK')
    })

    it('readback 실패 결과는 접수됨·미검증으로 남기고 providerMessageId를 보존한다', async () => {
      const { getInstagramDirectMessageReadback } = await import('@/lib/providers/meta-api')
      vi.mocked(getInstagramDirectMessageReadback).mockResolvedValueOnce({
        isLive: false,
        messageId: 'ig-msg-123',
        observedAt: new Date().toISOString(),
        error: 'Not found',
      })

      const result = await sendInstagramDm(
        baseThread,
        { type: 'owner', userId: 'user-1' },
        { repo: mockRepo, getChannelCredential: credential() }
      )

      expect(result.sent).toBe(false)
      expect(result.status).toBe('NEEDS_CHECK')
      expect(result.providerOutcome).toBe('ACCEPTED_BUT_UNVERIFIED')
      expect(result.localOutcome).toBe('RECONCILIATION_REQUIRED')
      expect(result.providerMessageId).toBe('ig-msg-123')
    })
  })
})
