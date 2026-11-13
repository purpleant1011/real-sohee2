import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendCommentReply } from './send'
import { computeApprovalFingerprint } from './draft'
import type { EngagementRepository } from './repository'
import type { SocialComment } from './types'

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
      requestId: 'act-req-1',
      status: 'prepared',
      isExisting: false,
    }),
    startAttempt: vi.fn().mockResolvedValue({
      attemptId: 'att-1',
      attemptNumber: 1,
    }),
    recordReceiptAndVerify: vi.fn().mockResolvedValue({
      receiptId: 'rcpt-1',
    }),
    markUnknownResult: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/lib/providers/meta-api', () => ({
  createInstagramProvider: vi.fn().mockReturnValue({
    sendCommentReply: vi.fn().mockResolvedValue({ providerReplyId: 'ig-reply-123' }),
  }),
  createThreadsProvider: vi.fn().mockReturnValue({
    sendReply: vi.fn().mockResolvedValue({ providerReplyId: 'th-reply-123' }),
  }),
  getInstagramCommentReplyReadback: vi.fn().mockResolvedValue({
    isLive: true,
    replyId: 'ig-reply-123',
    observedAt: new Date().toISOString(),
  }),
  getThreadsReplyReadback: vi.fn().mockResolvedValue({
    isLive: true,
    replyId: 'th-reply-123',
    observedAt: new Date().toISOString(),
  }),
}))

const TEST_WS_ID = '00000000-0000-4000-8000-0000000000a1'

const baseComment: SocialComment = {
  id: 'cm-100',
  workspace_id: TEST_WS_ID,
  channel_connection_id: 'conn-100',
  channel: 'instagram',
  provider_comment_id: 'prov-cm-100',
  provider_media_id: 'media-100',
  author_handle: 'tester',
  comment_text: '좋은 하루 되세요',
  comment_created_at: new Date().toISOString(),
  classification: 'GREETING',
  confidence: 0.95,
  status: 'DRAFTED',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

describe('sendCommentReply hard invariants (Invariants 1, 2, 3)', () => {
  let mockRepo: EngagementRepository
  let originalEnv: string | undefined
  let originalAllowlist: string | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    originalEnv = process.env.ENGAGEMENT_SEND_ENABLED
    originalAllowlist = process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST
    process.env.ENGAGEMENT_SEND_ENABLED = '1'
    process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '*'

    mockRepo = {
      findCommentById: vi.fn().mockResolvedValue(baseComment),
      findDraftByCommentId: vi.fn().mockResolvedValue({
        id: 'dr-100',
        workspace_id: TEST_WS_ID,
        comment_id: 'cm-100',
        draft_text: '감사합니다!',
        approved_fingerprint: computeApprovalFingerprint(TEST_WS_ID, 'cm-100', '감사합니다!'),
        approved_by: 'user-1',
        approved_at: new Date().toISOString(),
        is_auto_approved: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
      updateCommentStatus: vi.fn().mockResolvedValue(undefined),
      recordAudit: vi.fn().mockResolvedValue(undefined),
      findPolicy: vi.fn().mockResolvedValue(null),
    } as unknown as EngagementRepository
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

  it('blocks a newly approved draft that differs from the user-reviewed fingerprint', async () => {
    const getChannelCredential = vi.fn()
    const result = await sendCommentReply(baseComment, { type: 'owner', userId: 'user-1' }, {
      repo: mockRepo, getChannelCredential,
    }, { expectedFingerprint: computeApprovalFingerprint(TEST_WS_ID, 'cm-100', '검토했던 이전 답안') })
    expect(result.sent).toBe(false)
    expect(result.reason).toContain('최종 확인')
    expect(getChannelCredential).not.toHaveBeenCalled()
  })

  it('Invariant 1: blocks sending when ENGAGEMENT_SEND_ENABLED is not 1, state unchanged', async () => {
    process.env.ENGAGEMENT_SEND_ENABLED = '0'

    const result = await sendCommentReply(
      baseComment,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn(),
      }
    )

    expect(result.sent).toBe(false)
    expect(result.reason).toContain('비활성화')
    expect(mockRepo.updateCommentStatus).not.toHaveBeenCalled()
  })

  it('Invariant 1: blocks sending when Kill Switch is engaged', async () => {
    const { checkKillSwitchPreflight } = await import('@/lib/safety/kill-switch-guard')
    vi.mocked(checkKillSwitchPreflight).mockResolvedValueOnce({
      blocked: true,
      reason: '매장 킬스위치 활성화',
    })

    const result = await sendCommentReply(
      baseComment,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn().mockResolvedValue({
          accessToken: 'valid-token',
          accountHandle: '@sohee.ai',
          grantedScopes: ['instagram_manage_comments'],
        }),
      }
    )

    expect(result.sent).toBe(false)
    expect(result.reason).toContain('킬스위치')
    expect(mockRepo.updateCommentStatus).not.toHaveBeenCalled()
  })

  it('Invariant 1: blocks sending when required scope is missing', async () => {
    const result = await sendCommentReply(
      baseComment,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn().mockResolvedValue({
          accessToken: 'valid-token',
          grantedScopes: ['instagram_basic', 'instagram_content_publish'], // missing instagram_manage_comments
        }),
      }
    )

    expect(result.sent).toBe(false)
    expect(result.reason).toContain('댓글 관리 권한')
    expect(mockRepo.updateCommentStatus).not.toHaveBeenCalled()
  })

  it('Invariant 2: blocks sending when draft was edited after approval (fingerprint mismatch)', async () => {
    mockRepo.findDraftByCommentId = vi.fn().mockResolvedValueOnce({
      id: 'dr-100',
      workspace_id: TEST_WS_ID,
      comment_id: 'cm-100',
      draft_text: '수정된 다른 문안',
      approved_fingerprint: computeApprovalFingerprint(TEST_WS_ID, 'cm-100', '이전 승인 문안'),
      approved_by: 'user-1',
    })

    const result = await sendCommentReply(
      baseComment,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn(),
      }
    )

    expect(result.sent).toBe(false)
    expect(result.reason).toContain('일치하지 않습니다')
    expect(mockRepo.updateCommentStatus).not.toHaveBeenCalled()
  })

  it('Invariant 3: blocks duplicate sending when comment is already SENT', async () => {
    const sentComment: SocialComment = { ...baseComment, status: 'SENT' }

    const result = await sendCommentReply(
      sentComment,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn(),
      }
    )

    expect(result.sent).toBe(false)
    expect(result.reason).toContain('이미 답글이 등록된')
  })

  it('Invariant 3: transitions to NEEDS_CHECK on provider exception and never auto-retries', async () => {
    const { createInstagramProvider } = await import('@/lib/providers/meta-api')
    vi.mocked(createInstagramProvider).mockReturnValueOnce({
      sendCommentReply: vi.fn().mockRejectedValue(new Error('Meta Network 500')),
    } as any)

    const result = await sendCommentReply(
      baseComment,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn().mockResolvedValue({
          accessToken: 'valid-token',
          accountHandle: '@sohee.ai',
          grantedScopes: ['instagram_manage_comments'],
        }),
      }
    )

    expect(result.sent).toBe(false)
    expect(result.status).toBe('NEEDS_CHECK')
    expect(result.reason).toEqual(expect.stringContaining('답글이 올라갔는지 확인해 주세요'))
    expect(mockRepo.updateCommentStatus).toHaveBeenCalledWith(
      TEST_WS_ID,
      'cm-100',
      'NEEDS_CHECK',
      expect.stringContaining('답글이 올라갔는지 확인해 주세요')
    )
  })

  it('Invariant 3: transitions to NEEDS_CHECK when readback GET fails to verify presence', async () => {
    const { getInstagramCommentReplyReadback } = await import('@/lib/providers/meta-api')
    vi.mocked(getInstagramCommentReplyReadback).mockResolvedValueOnce({
      isLive: false,
      replyId: 'ig-reply-123',
      observedAt: new Date().toISOString(),
      error: 'Not found',
    })

    const result = await sendCommentReply(
      baseComment,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn().mockResolvedValue({
          accessToken: 'valid-token',
          accountHandle: '@sohee.ai',
          grantedScopes: ['instagram_manage_comments'],
        }),
      }
    )

    expect(result.sent).toBe(false)
    expect(result.status).toBe('NEEDS_CHECK')
    expect(result.reason).toEqual(expect.stringContaining('답글이 올라갔는지 확인해 주세요'))
    expect(mockRepo.updateCommentStatus).toHaveBeenCalledWith(
      TEST_WS_ID,
      'cm-100',
      'NEEDS_CHECK',
      expect.stringContaining('답글이 올라갔는지 확인해 주세요')
    )
  })

  it('succeeds when provider call succeeds and readback GET verifies presence', async () => {
    const result = await sendCommentReply(
      baseComment,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn().mockResolvedValue({
          accessToken: 'valid-token',
          accountHandle: '@sohee.ai',
          grantedScopes: ['instagram_manage_comments'],
        }),
      }
    )

    expect(result.sent).toBe(true)
    expect(result.status).toBe('SENT')
    expect(result.providerReplyId).toBe('ig-reply-123')

    const { createInstagramProvider, getInstagramCommentReplyReadback } = await import('@/lib/providers/meta-api')
    const providerInstance = vi.mocked(createInstagramProvider).mock.results[0]?.value
    expect(providerInstance?.sendCommentReply).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: baseComment.provider_comment_id,
        accessToken: 'valid-token',
        text: '감사합니다!',
      })
    )
    expect(getInstagramCommentReplyReadback).toHaveBeenCalledWith(
      expect.objectContaining({
        replyId: 'ig-reply-123',
        accessToken: 'valid-token',
      })
    )

    expect(mockRepo.updateCommentStatus).toHaveBeenCalledWith(TEST_WS_ID, 'cm-100', 'SENT', null)
    expect(mockRepo.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'manual_send',
        actor: 'owner',
        readback_verified: true,
        details: expect.objectContaining({
          draftFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
          draftLength: expect.any(Number),
        }),
      })
    )
  })

  it('scrubs draftText and personal data from audit details and records draftFingerprint & draftLength', async () => {
    process.env.ENGAGEMENT_SEND_ENABLED = '1'
    process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '*'

    await sendCommentReply(
      baseComment,
      { type: 'manager', userId: 'user-mgr' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn().mockResolvedValue({
          accessToken: 'valid-token',
          accountHandle: '@sohee.ai',
          grantedScopes: ['instagram_manage_comments'],
        }),
      }
    )

    const auditCall = vi.mocked(mockRepo.recordAudit).mock.calls.find(
      (c) => c[0].action === 'manual_send' && c[0].comment_id === 'cm-100'
    )
    expect(auditCall).toBeDefined()
    const details = auditCall![0].details
    expect(details).not.toHaveProperty('draftText')
    expect(details).not.toHaveProperty('commentText')
    expect(details).not.toHaveProperty('authorHandle')
    expect(details).toHaveProperty('draftFingerprint')
    expect(details).toHaveProperty('draftLength')
    expect(details.draftLength).toBe('감사합니다!'.length)
  })

  it('Invariant 1: blocks sending when workspace is not in ENGAGEMENT_WORKSPACE_ALLOWLIST, even if flag is 1', async () => {
    process.env.ENGAGEMENT_SEND_ENABLED = '1'
    process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '00000000-0000-4000-8000-0000000000a2' // other workspace

    const { createInstagramProvider } = await import('@/lib/providers/meta-api')
    const providerInstance = createInstagramProvider({} as any)
    vi.mocked(providerInstance.sendCommentReply).mockClear()

    const result = await sendCommentReply(
      baseComment,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn().mockResolvedValue({
          accessToken: 'valid-token',
          accountHandle: '@sohee.ai',
          grantedScopes: ['instagram_manage_comments'],
        }),
      }
    )

    expect(result.sent).toBe(false)
    expect(result.status).toBe(baseComment.status)
    expect(result.reason).toBe('이 워크스페이스에서는 아직 소통함 발송을 열지 않았어요.')
    expect(mockRepo.updateCommentStatus).not.toHaveBeenCalled()
    expect(providerInstance.sendCommentReply).not.toHaveBeenCalled()
  })

  it('refuses to send reply if comment was authored by the connected account itself (self-comment gate)', async () => {
    process.env.ENGAGEMENT_SEND_ENABLED = '1'
    process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '*'

    const { createInstagramProvider } = await import('@/lib/providers/meta-api')
    const providerInstance = vi.mocked(createInstagramProvider).mock.results[0]?.value
    if (providerInstance) vi.mocked(providerInstance.sendCommentReply).mockClear()

    const { CanonicalActionLedgerService } = await import('@/features/external-actions/canonical-action-ledger')
    vi.mocked(CanonicalActionLedgerService.startAttempt).mockClear()

    const selfComment: SocialComment = {
      ...baseComment,
      id: 'cm-self-test',
      author_handle: 'sohee.ai',
      author_id: '17841441250302004',
      comment_text: '안녕하세요! 소중한 댓글 감사드립니다.',
    }
    const draftText = '스스로에게 답글'
    mockRepo.findDraftByCommentId = vi.fn().mockResolvedValue({
      id: 'df-self',
      comment_id: 'cm-self-test',
      draft_text: draftText,
      approved_fingerprint: computeApprovalFingerprint(TEST_WS_ID, 'cm-self-test', draftText),
    })

    const result = await sendCommentReply(
      selfComment,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn().mockResolvedValue({
          accessToken: 'valid-token',
          externalAccountId: '17841441250302004',
          accountHandle: '@sohee.ai',
          grantedScopes: ['instagram_manage_comments'],
        }),
      }
    )

    expect(result.sent).toBe(false)
    expect(result.reason).toContain('본인 계정')
    expect(CanonicalActionLedgerService.startAttempt).not.toHaveBeenCalled()
    if (providerInstance) {
      expect(providerInstance.sendCommentReply).not.toHaveBeenCalled()
    }
  })

  it('fails closed when channel_connections query via adminClient returns an error', async () => {
    process.env.ENGAGEMENT_SEND_ENABLED = '1'
    process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '*'

    const mockAdminClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'DB connection lost' },
              }),
            }),
          }),
        }),
      }),
    }

    const result = await sendCommentReply(
      baseComment,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn().mockResolvedValue({
          accessToken: 'valid-token',
          externalAccountId: '17841441250302004',
          grantedScopes: ['instagram_manage_comments'],
        }),
        adminClient: mockAdminClient,
      }
    )

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('채널 연결 정보를 확인할 수 없습니다. [채널 연동] 메뉴에서 계정을 확인해 주세요.')
  })

  it('fails closed when channel_connections query returns null data without error (null conn noerror)', async () => {
    process.env.ENGAGEMENT_SEND_ENABLED = '1'
    process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '*'

    const { createInstagramProvider } = await import('@/lib/providers/meta-api')
    const providerInstance = vi.mocked(createInstagramProvider).mock.results[0]?.value
    if (providerInstance) vi.mocked(providerInstance.sendCommentReply).mockClear()

    const { CanonicalActionLedgerService } = await import('@/features/external-actions/canonical-action-ledger')
    vi.mocked(CanonicalActionLedgerService.startAttempt).mockClear()

    const mockAdminClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: null,
              }),
            }),
          }),
        }),
      }),
    }

    const result = await sendCommentReply(
      baseComment,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn().mockResolvedValue({
          accessToken: 'valid-token',
          externalAccountId: '17841441250302004',
          grantedScopes: ['instagram_manage_comments'],
        }),
        adminClient: mockAdminClient,
      }
    )

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('채널 연결 정보를 확인할 수 없습니다. [채널 연동] 메뉴에서 계정을 확인해 주세요.')
    expect(CanonicalActionLedgerService.startAttempt).not.toHaveBeenCalled()
    if (providerInstance) {
      expect(providerInstance.sendCommentReply).not.toHaveBeenCalled()
    }
  })

  it('detects self-comment when account_label is empty but profile_metadata.username matches author (label빈/username=own)', async () => {
    process.env.ENGAGEMENT_SEND_ENABLED = '1'
    process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '*'

    const { createInstagramProvider } = await import('@/lib/providers/meta-api')
    const providerInstance = vi.mocked(createInstagramProvider).mock.results[0]?.value
    if (providerInstance) vi.mocked(providerInstance.sendCommentReply).mockClear()

    const { CanonicalActionLedgerService } = await import('@/features/external-actions/canonical-action-ledger')
    vi.mocked(CanonicalActionLedgerService.startAttempt).mockClear()

    const mockAdminClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  account_label: null,
                  profile_metadata: { username: 'tester' }, // matches baseComment.author_handle
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
    }

    const result = await sendCommentReply(
      baseComment,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn().mockResolvedValue({
          accessToken: 'valid-token',
          externalAccountId: '17841441250302004',
          grantedScopes: ['instagram_manage_comments'],
        }),
        adminClient: mockAdminClient,
      }
    )

    expect(result.sent).toBe(false)
    expect(result.reason).toContain('본인 계정')
    expect(CanonicalActionLedgerService.startAttempt).not.toHaveBeenCalled()
    if (providerInstance) {
      expect(providerInstance.sendCommentReply).not.toHaveBeenCalled()
    }
  })

  it('fails closed when no comparable identity pair exists (비교식별정보전무)', async () => {
    process.env.ENGAGEMENT_SEND_ENABLED = '1'
    process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '*'

    const { createInstagramProvider } = await import('@/lib/providers/meta-api')
    const providerInstance = vi.mocked(createInstagramProvider).mock.results[0]?.value
    if (providerInstance) vi.mocked(providerInstance.sendCommentReply).mockClear()

    const { CanonicalActionLedgerService } = await import('@/features/external-actions/canonical-action-ledger')
    vi.mocked(CanonicalActionLedgerService.startAttempt).mockClear()

    const anonymousComment: SocialComment = {
      ...baseComment,
      author_handle: '',
      author_id: null,
    }

    const result = await sendCommentReply(
      anonymousComment,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn().mockResolvedValue({
          accessToken: 'valid-token',
          grantedScopes: ['instagram_manage_comments'],
        }),
      }
    )

    expect(result.sent).toBe(false)
    expect(result.reason).toContain('댓글 작성자 및 계정 식별 정보를 확인할 수 없어')
    expect(CanonicalActionLedgerService.startAttempt).not.toHaveBeenCalled()
    if (providerInstance) {
      expect(providerInstance.sendCommentReply).not.toHaveBeenCalled()
    }
  })

  it('fails closed and blocks provider/ledger when author/account strings contain only whitespace', async () => {
    process.env.ENGAGEMENT_SEND_ENABLED = '1'
    process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '*'

    const { createInstagramProvider } = await import('@/lib/providers/meta-api')
    const providerInstance = vi.mocked(createInstagramProvider).mock.results[0]?.value
    if (providerInstance) vi.mocked(providerInstance.sendCommentReply).mockClear()

    const { CanonicalActionLedgerService } = await import('@/features/external-actions/canonical-action-ledger')
    vi.mocked(CanonicalActionLedgerService.startAttempt).mockClear()

    const whitespaceComment: SocialComment = {
      ...baseComment,
      author_handle: '   ',
      author_id: '   ',
    }

    const result = await sendCommentReply(
      whitespaceComment,
      { type: 'owner', userId: 'user-1' },
      {
        repo: mockRepo,
        getChannelCredential: vi.fn().mockResolvedValue({
          accessToken: 'valid-token',
          accountHandle: '   ',
          externalAccountId: '   ',
          grantedScopes: ['instagram_manage_comments'],
        }),
      }
    )

    expect(result.sent).toBe(false)
    expect(result.reason).toContain('댓글 작성자 및 계정 식별 정보를 확인할 수 없어')
    expect(CanonicalActionLedgerService.startAttempt).not.toHaveBeenCalled()
    if (providerInstance) {
      expect(providerInstance.sendCommentReply).not.toHaveBeenCalled()
    }
  })
})
