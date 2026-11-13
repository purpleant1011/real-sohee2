import { describe, expect, it, vi, beforeEach } from 'vitest'
import { GET as getThreads } from './threads/route'
import { POST as postDraft, PATCH as patchDraft } from './threads/[threadId]/draft/route'
import { POST as postSend } from './threads/[threadId]/send/route'
import { POST as postDismiss } from './threads/[threadId]/dismiss/route'
import {
  computeDmApprovalFingerprint,
  DM_EXPIRED_KOREAN_MESSAGE,
} from '@/features/engagement/dm/options-generator'

// Mock route auth
const mockAuth = vi.fn()
vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: (...args: any[]) => mockAuth(...args),
  isResponse: (v: unknown) => v instanceof Response,
}))

// Mock DM compose service
const mockThread = {
  id: 'th-1',
  workspace_id: 'ws-1',
  channel_connection_id: 'conn-1',
  channel: 'instagram',
  provider_thread_id: 'prov-th-1',
  customer_id: 'cust-1',
  customer_handle: 'tester',
  customer_name: '홍길동',
  last_message_at: new Date(Date.now() - 3600 * 1000).toISOString(),
  expires_at: new Date(Date.now() + 23 * 3600 * 1000).toISOString(),
  status: 'NEEDS_REPLY',
  last_message_text: '문의합니다',
}

const mockDraft = {
  id: 'dr-1',
  workspace_id: 'ws-1',
  thread_id: 'th-1',
  selected_option_id: 'opt_reservation',
  options: [
    { id: 'opt_reservation', label: '방문 및 예약 안내', draftText: '예약 안내드립니다.' },
    { id: 'opt_hours_location', label: '영업시간 및 위치 안내', draftText: '위치 안내드립니다.' },
  ],
  draft_text: '예약 안내드립니다.',
  approved_fingerprint: null,
}

const mockService = {
  repo: {
    listThreads: vi.fn().mockResolvedValue({
      threads: [mockThread],
      nextCursor: undefined,
    }),
    findThreadById: vi.fn().mockResolvedValue(mockThread),
    findDraftByThreadId: vi.fn().mockResolvedValue(mockDraft),
    saveDraft: vi.fn().mockResolvedValue(mockDraft),
    updateDraft: vi.fn().mockResolvedValue({ ...mockDraft, draft_text: '수정된 문안' }),
    approveDraft: vi.fn().mockResolvedValue({ ...mockDraft, approved_fingerprint: 'fp' }),
    updateThreadStatus: vi.fn().mockResolvedValue(undefined),
    recordAudit: vi.fn().mockResolvedValue(undefined),
  },
  generateDraftOptions: vi.fn().mockResolvedValue(mockDraft.options),
  send: vi.fn().mockResolvedValue({ sent: true, status: 'SENT', providerMessageId: 'prov-msg-1' }),
}

vi.mock('@/features/engagement/dm/compose', () => ({
  createInstagramDmService: () => mockService,
}))

describe('Instagram DM API Routes Authorization & Behavior', () => {
  const wsContext = {
    userId: 'u-1',
    workspaceId: 'ws-1',
    role: 'manager' as const,
    admin: {
      from: vi.fn().mockImplementation(() => {
        const chain: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          then: (resolve: any) => Promise.resolve({ data: [] }).then(resolve),
        }
        return chain
      }),
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(wsContext)
  })

  describe('GET /dm/threads', () => {
    const VALID_WS_ID = '00000000-0000-4000-8000-0000000000a1'

    it('returns 401 when unauthorized', async () => {
      mockAuth.mockResolvedValueOnce(new Response(JSON.stringify({ error: '로그인이 필요해요.' }), { status: 401 }))
      const req = new Request('http://localhost/api/workspaces/ws-1/engagement/dm/threads')
      const res = await getThreads(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })
      expect(res.status).toBe(401)
    })

    it('lists threads with enriched countdown information and send_enabled when allowed', async () => {
      const originalSend = process.env.ENGAGEMENT_SEND_ENABLED
      const originalAllowlist = process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST
      process.env.ENGAGEMENT_SEND_ENABLED = '1'
      process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '*'

      try {
        mockAuth.mockResolvedValueOnce({ ...wsContext, workspaceId: VALID_WS_ID })
        const req = new Request(`http://localhost/api/workspaces/${VALID_WS_ID}/engagement/dm/threads`)
        const res = await getThreads(req, { params: Promise.resolve({ workspaceId: VALID_WS_ID }) })
        expect(res.status).toBe(200)

        const body = await res.json()
        expect(body.items).toHaveLength(1)
        expect(body.items[0].countdown_text).toContain('시간 남음')
        expect(body.items[0].status_label).toBe('답장 필요')
        expect(body.items[0].channel_label).toBe('Instagram')
        expect(body.send_enabled).toBe(true)
      } finally {
        if (originalSend !== undefined) process.env.ENGAGEMENT_SEND_ENABLED = originalSend
        else delete process.env.ENGAGEMENT_SEND_ENABLED
        if (originalAllowlist !== undefined) process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = originalAllowlist
        else delete process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST
      }
    })

    it('reports send_enabled: false when workspace is not in allowlist', async () => {
      const originalSend = process.env.ENGAGEMENT_SEND_ENABLED
      const originalAllowlist = process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST
      process.env.ENGAGEMENT_SEND_ENABLED = '1'
      process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '00000000-0000-0000-0000-000000000000'

      try {
        mockAuth.mockResolvedValueOnce({ ...wsContext, workspaceId: VALID_WS_ID })
        const req = new Request(`http://localhost/api/workspaces/${VALID_WS_ID}/engagement/dm/threads`)
        const res = await getThreads(req, { params: Promise.resolve({ workspaceId: VALID_WS_ID }) })
        expect(res.status).toBe(200)

        const body = await res.json()
        expect(body.send_enabled).toBe(false)
      } finally {
        if (originalSend !== undefined) process.env.ENGAGEMENT_SEND_ENABLED = originalSend
        else delete process.env.ENGAGEMENT_SEND_ENABLED
        if (originalAllowlist !== undefined) process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = originalAllowlist
        else delete process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST
      }
    })
  })

  describe('POST & PATCH /dm/threads/[threadId]/draft', () => {
    it('POST: selects a direction option and updates draft', async () => {
      const req = new Request('http://localhost/api/workspaces/ws-1/engagement/dm/threads/th-1/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionId: 'opt_hours_location' }),
      })

      const res = await postDraft(req, { params: Promise.resolve({ workspaceId: 'ws-1', threadId: 'th-1' }) })
      expect(res.status).toBe(200)
      expect(mockService.repo.saveDraft).toHaveBeenCalled()
      expect(mockService.repo.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'select_option' })
      )
    })

    it('PATCH: validates draft text max length (1000 characters)', async () => {
      const tooLongText = 'a'.repeat(1001)
      const req = new Request('http://localhost/api/workspaces/ws-1/engagement/dm/threads/th-1/draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftText: tooLongText }),
      })

      const res = await patchDraft(req, { params: Promise.resolve({ workspaceId: 'ws-1', threadId: 'th-1' }) })
      expect(res.status).toBe(422)
    })

    it('PATCH: successfully updates draft text', async () => {
      const req = new Request('http://localhost/api/workspaces/ws-1/engagement/dm/threads/th-1/draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftText: '수정된 문안입니다.' }),
      })

      const res = await patchDraft(req, { params: Promise.resolve({ workspaceId: 'ws-1', threadId: 'th-1' }) })
      expect(res.status).toBe(200)
      expect(mockService.repo.updateDraft).toHaveBeenCalled()
    })

    it('POST (select): scrubs draftText from audit details and records draftFingerprint & draftLength', async () => {
      const req = new Request('http://localhost/api/workspaces/ws-1/engagement/dm/threads/th-1/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionId: 'opt_hours_location' }),
      })

      const res = await postDraft(req, { params: Promise.resolve({ workspaceId: 'ws-1', threadId: 'th-1' }) })
      expect(res.status).toBe(200)

      const auditCall = vi.mocked(mockService.repo.recordAudit).mock.calls.find(
        ([record]) => record.action === 'select_option'
      )
      expect(auditCall).toBeDefined()
      const details = auditCall![0].details as Record<string, unknown>
      expect(details).not.toHaveProperty('draftText')
      expect(details).toHaveProperty('draftFingerprint')
      expect(details.draftFingerprint).toBe(
        computeDmApprovalFingerprint('ws-1', 'th-1', '위치 안내드립니다.')
      )
      expect(details.draftLength).toBe('위치 안내드립니다.'.length)
      expect(details.optionId).toBe('opt_hours_location')
    })

    it('PATCH (edit): scrubs draftText from audit details and records draftFingerprint & draftLength', async () => {
      const req = new Request('http://localhost/api/workspaces/ws-1/engagement/dm/threads/th-1/draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftText: '수정된 문안입니다.' }),
      })

      const res = await patchDraft(req, { params: Promise.resolve({ workspaceId: 'ws-1', threadId: 'th-1' }) })
      expect(res.status).toBe(200)

      const auditCall = vi.mocked(mockService.repo.recordAudit).mock.calls.find(
        ([record]) => record.action === 'edit_draft'
      )
      expect(auditCall).toBeDefined()
      const details = auditCall![0].details as Record<string, unknown>
      expect(details).not.toHaveProperty('draftText')
      expect(details).toHaveProperty('draftFingerprint')
      expect(details.draftFingerprint).toBe(
        computeDmApprovalFingerprint('ws-1', 'th-1', '수정된 문안')
      )
      expect(details.draftLength).toBe('수정된 문안'.length)
    })

    it('POST (regenerate): scrubs draftText from audit details and records draftFingerprint & draftLength', async () => {
      const req = new Request('http://localhost/api/workspaces/ws-1/engagement/dm/threads/th-1/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const res = await postDraft(req, { params: Promise.resolve({ workspaceId: 'ws-1', threadId: 'th-1' }) })
      expect(res.status).toBe(200)

      const auditCall = vi.mocked(mockService.repo.recordAudit).mock.calls.find(
        ([record]) => record.action === 'generate_draft'
      )
      expect(auditCall).toBeDefined()
      const details = auditCall![0].details as Record<string, unknown>
      expect(details).not.toHaveProperty('draftText')
      expect(details).toHaveProperty('draftFingerprint')
      expect(details.draftFingerprint).toBe(
        computeDmApprovalFingerprint('ws-1', 'th-1', mockDraft.options[0].draftText)
      )
      expect(details.draftLength).toBe(mockDraft.options[0].draftText.length)
      expect(details.optionsCount).toBe(mockDraft.options.length)
    })
  })

  describe('POST /dm/threads/[threadId]/send', () => {
    it('enforces 24-hour window policy (Hard Invariant 2)', async () => {
      mockService.repo.findThreadById.mockResolvedValueOnce({
        ...mockThread,
        expires_at: new Date(Date.now() - 3600 * 1000).toISOString(), // expired
      })

      const req = new Request('http://localhost/api/workspaces/ws-1/engagement/dm/threads/th-1/send', {
        method: 'POST',
      })

      const res = await postSend(req, { params: Promise.resolve({ workspaceId: 'ws-1', threadId: 'th-1' }) })
      expect(res.status).toBe(422)
      const body = await res.json()
      expect(body.status).toBe('EXPIRED')
      expect(body.error).toBe(DM_EXPIRED_KOREAN_MESSAGE)
    })

    it('successfully approves fingerprint and sends DM', async () => {
      const fp = computeDmApprovalFingerprint('ws-1', 'th-1', mockDraft.draft_text)
      const req = new Request('http://localhost/api/workspaces/ws-1/engagement/dm/threads/th-1/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedFingerprint: fp }),
      })

      const res = await postSend(req, { params: Promise.resolve({ workspaceId: 'ws-1', threadId: 'th-1' }) })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.ok).toBe(true)
      expect(body.status).toBe('SENT')
      expect(mockService.send).toHaveBeenCalled()
    })

    it('rejects with 409 when expectedFingerprint mismatches current draft', async () => {
      const req = new Request('http://localhost/api/workspaces/ws-1/engagement/dm/threads/th-1/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedFingerprint: 'invalid-mismatched-fingerprint' }),
      })

      const res = await postSend(req, { params: Promise.resolve({ workspaceId: 'ws-1', threadId: 'th-1' }) })
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.error).toContain('승인된 문안과 현재 초안이 일치하지 않습니다')
    })

    it('rejects with 409 when customer message arrives but expectedSourceMessageId is missing', async () => {
      const mockCustomerMsg = { id: 'msg-cust-123', sent_at: '2026-10-16T12:00:00Z' }
      mockAuth.mockResolvedValueOnce({
        ...wsContext,
        admin: {
          from: vi.fn().mockImplementation(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: mockCustomerMsg, error: null }),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
            then: (resolve: any) => Promise.resolve({ data: [] }).then(resolve),
          })),
        },
      })

      const fp = computeDmApprovalFingerprint('ws-1', 'th-1', mockDraft.draft_text)
      const req = new Request('http://localhost/api/workspaces/ws-1/engagement/dm/threads/th-1/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedFingerprint: fp }), // missing expectedSourceMessageId
      })

      const res = await postSend(req, { params: Promise.resolve({ workspaceId: 'ws-1', threadId: 'th-1' }) })
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.error).toContain('기준 정보가 없습니다')
    })

    it('외부 전송은 확인됐지만 로컬 정산이 실패하면 200 성공 대신 422 대사 확인으로 응답한다', async () => {
      const fp = computeDmApprovalFingerprint('ws-1', 'th-1', mockDraft.draft_text)
      mockService.send.mockResolvedValueOnce({
        sent: true,
        status: 'NEEDS_CHECK',
        providerMessageId: 'prov-msg-1',
        providerOutcome: 'READBACK_VERIFIED',
        localOutcome: 'RECONCILIATION_REQUIRED',
        reason: '인스타그램에 답장이 정상 전송되었으나, 로컬 저장소 정산에 실패했습니다 (감사 로그 저장 실패). 대사 확인이 필요합니다.',
      })

      const req = new Request('http://localhost/api/workspaces/ws-1/engagement/dm/threads/th-1/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedFingerprint: fp }),
      })

      const res = await postSend(req, { params: Promise.resolve({ workspaceId: 'ws-1', threadId: 'th-1' }) })
      expect(res.status).toBe(422)
      const body = await res.json()
      expect(body.ok).toBe(false)
      expect(body.status).toBe('NEEDS_CHECK')
      expect(body.reconciliationRequired).toBe(true)
      expect(body.deliveryVerified).toBe(true)
      expect(body.providerMessageId).toBe('prov-msg-1')
    })
  })

  describe('POST /dm/threads/[threadId]/dismiss', () => {
    it('dismisses thread and records audit', async () => {
      const req = new Request('http://localhost/api/workspaces/ws-1/engagement/dm/threads/th-1/dismiss', {
        method: 'POST',
      })

      const res = await postDismiss(req, { params: Promise.resolve({ workspaceId: 'ws-1', threadId: 'th-1' }) })
      expect(res.status).toBe(200)
      expect(mockService.repo.updateThreadStatus).toHaveBeenCalledWith('ws-1', 'th-1', 'DISMISSED')
      expect(mockService.repo.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'dismiss' })
      )
    })
  })
})
