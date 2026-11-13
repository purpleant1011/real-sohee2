import { describe, expect, it, vi } from 'vitest'
import { GET as getComments } from './comments/route'
import { POST as postDraft, PATCH as patchDraft } from './comments/[commentId]/draft/route'
import { POST as postSend } from './comments/[commentId]/send/route'
import { POST as postDismiss } from './comments/[commentId]/dismiss/route'
import { GET as getPolicy, PUT as putPolicy } from './policy/route'
import { POST as runInternalEngagement } from '@/app/api/internal/engagement/run/route'

// Mock route auth
const mockAuth = vi.fn()
vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: (...args: any[]) => mockAuth(...args),
  isResponse: (v: unknown) => v instanceof Response,
}))

// Mock compose service
const mockService = {
  repo: {
    listComments: vi.fn().mockResolvedValue({
      comments: [
        {
          id: 'cm-1',
          workspace_id: 'ws-1',
          channel: 'instagram',
          status: 'RECEIVED',
          classification: 'THANKS',
          comment_text: '감사합니다',
          author_handle: 'tester',
        },
      ],
      nextCursor: undefined,
    }),
    findCommentById: vi.fn().mockResolvedValue({
      id: 'cm-1',
      workspace_id: 'ws-1',
      channel: 'instagram',
      author_handle: 'tester',
      comment_text: '감사합니다',
      status: 'RECEIVED',
    }),
    findDraftByCommentId: vi.fn().mockResolvedValue({
      id: 'dr-1',
      workspace_id: 'ws-1',
      comment_id: 'cm-1',
      draft_text: '초안',
      approved_fingerprint: null,
    }),
    saveDraft: vi.fn().mockResolvedValue({ id: 'dr-1', draft_text: '새초안' }),
    updateDraft: vi.fn().mockResolvedValue({ id: 'dr-1', draft_text: '수정초안' }),
    approveDraft: vi.fn().mockResolvedValue({ id: 'dr-1', draft_text: '초안', approved_fingerprint: 'fp' }),
    updateCommentStatus: vi.fn().mockResolvedValue(undefined),
    recordAudit: vi.fn().mockResolvedValue(undefined),
    findPolicy: vi.fn().mockResolvedValue({ auto_reply_enabled: false }),
    countAutoRepliesSentToday: vi.fn().mockResolvedValue(0),
    upsertPolicy: vi.fn().mockResolvedValue({ auto_reply_enabled: true }),
  },
  draft: vi.fn().mockResolvedValue({ draftText: '새초안', fingerprint: 'fp' }),
  send: vi.fn().mockResolvedValue({ sent: true, status: 'SENT', providerReplyId: 'rep-1' }),
  runCycle: vi.fn().mockResolvedValue({ classifiedCount: 1, draftedCount: 1, autoSentCount: 1, skippedCount: 0 }),
}

vi.mock('@/features/engagement/compose', () => ({
  createEngagementService: () => mockService,
}))

vi.mock('@/features/engagement/repository', () => ({
  SupabaseEngagementRepository: class {
    listComments = mockService.repo.listComments
    findCommentById = mockService.repo.findCommentById
    updateCommentStatus = mockService.repo.updateCommentStatus
    recordAudit = mockService.repo.recordAudit
    countAutoRepliesSentToday = mockService.repo.countAutoRepliesSentToday
    findPolicy = mockService.repo.findPolicy
    upsertPolicy = mockService.repo.upsertPolicy
  },
}))

const VALID_WS_ID = '00000000-0000-4000-8000-0000000000a1'

describe('Engagement API Routes Authorization & Validation', () => {
  const wsContext = {
    userId: 'u-1',
    workspaceId: VALID_WS_ID,
    role: 'manager' as const,
    admin: {
      from: () => ({
        select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: [] }) }) }),
      }),
    },
  }

  it('GET /comments: allows viewer role (200) and includes honest feature flags & Korean labels', async () => {
    const originalSend = process.env.ENGAGEMENT_SEND_ENABLED
    const originalCycle = process.env.ENGAGEMENT_CYCLE_ENABLED
    const originalAllowlist = process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST
    process.env.ENGAGEMENT_SEND_ENABLED = '1'
    process.env.ENGAGEMENT_CYCLE_ENABLED = '1'
    process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '*'

    try {
      mockAuth.mockResolvedValueOnce({ ...wsContext, role: 'viewer' })
      const req = new Request(`https://example.com/api/workspaces/${VALID_WS_ID}/engagement/comments`)
      const res = await getComments(req, { params: Promise.resolve({ workspaceId: VALID_WS_ID }) })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.items).toBeDefined()
      expect(json.send_enabled).toBe(true)
      expect(json.cycle_enabled).toBe(true)
      expect(json.items[0].channel_label).toBe('인스타그램')
      expect(json.items[0].account_label).toBe('연결된 계정')
      expect(json.items[0].status_label).toBe('새 댓글')
      expect(json.items[0].classification_label).toBe('감사')
    } finally {
      if (originalSend !== undefined) process.env.ENGAGEMENT_SEND_ENABLED = originalSend
      else delete process.env.ENGAGEMENT_SEND_ENABLED
      if (originalCycle !== undefined) process.env.ENGAGEMENT_CYCLE_ENABLED = originalCycle
      else delete process.env.ENGAGEMENT_CYCLE_ENABLED
      if (originalAllowlist !== undefined) process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = originalAllowlist
      else delete process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST
    }
  })

  it('GET /comments: reports false for send_enabled and cycle_enabled when flags are off', async () => {
    const originalSend = process.env.ENGAGEMENT_SEND_ENABLED
    const originalCycle = process.env.ENGAGEMENT_CYCLE_ENABLED
    const originalAllowlist = process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST
    process.env.ENGAGEMENT_SEND_ENABLED = '0'
    process.env.ENGAGEMENT_CYCLE_ENABLED = '0'
    process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '*'

    try {
      mockAuth.mockResolvedValueOnce({ ...wsContext, role: 'viewer' })
      const req = new Request(`https://example.com/api/workspaces/${VALID_WS_ID}/engagement/comments`)
      const res = await getComments(req, { params: Promise.resolve({ workspaceId: VALID_WS_ID }) })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.send_enabled).toBe(false)
      expect(json.cycle_enabled).toBe(false)
    } finally {
      if (originalSend !== undefined) process.env.ENGAGEMENT_SEND_ENABLED = originalSend
      else delete process.env.ENGAGEMENT_SEND_ENABLED
      if (originalCycle !== undefined) process.env.ENGAGEMENT_CYCLE_ENABLED = originalCycle
      else delete process.env.ENGAGEMENT_CYCLE_ENABLED
      if (originalAllowlist !== undefined) process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = originalAllowlist
      else delete process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST
    }
  })

  it('GET /comments: reports false for send_enabled and cycle_enabled when workspace is not in allowlist', async () => {
    const originalSend = process.env.ENGAGEMENT_SEND_ENABLED
    const originalCycle = process.env.ENGAGEMENT_CYCLE_ENABLED
    const originalAllowlist = process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST
    process.env.ENGAGEMENT_SEND_ENABLED = '1'
    process.env.ENGAGEMENT_CYCLE_ENABLED = '1'
    process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '00000000-0000-0000-0000-000000000000'

    try {
      mockAuth.mockResolvedValueOnce({ ...wsContext, role: 'viewer' })
      const req = new Request(`https://example.com/api/workspaces/${VALID_WS_ID}/engagement/comments`)
      const res = await getComments(req, { params: Promise.resolve({ workspaceId: VALID_WS_ID }) })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.send_enabled).toBe(false)
      expect(json.cycle_enabled).toBe(false)
    } finally {
      if (originalSend !== undefined) process.env.ENGAGEMENT_SEND_ENABLED = originalSend
      else delete process.env.ENGAGEMENT_SEND_ENABLED
      if (originalCycle !== undefined) process.env.ENGAGEMENT_CYCLE_ENABLED = originalCycle
      else delete process.env.ENGAGEMENT_CYCLE_ENABLED
      if (originalAllowlist !== undefined) process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = originalAllowlist
      else delete process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST
    }
  })

  it('POST /comments/[id]/draft: requires manager role (403 for viewer)', async () => {
    mockAuth.mockResolvedValueOnce(new Response(JSON.stringify({ error: '권한 없음' }), { status: 403 }))
    const req = new Request('https://example.com/api/workspaces/ws-1/engagement/comments/cm-1/draft', { method: 'POST' })
    const res = await postDraft(req, { params: Promise.resolve({ workspaceId: 'ws-1', commentId: 'cm-1' }) })
    expect(res.status).toBe(403)
  })

  it('POST /comments/[id]/draft: regenerates draft and scrubs draftText from audit details', async () => {
    mockAuth.mockResolvedValueOnce(wsContext)
    const req = new Request('https://example.com/api/workspaces/ws-1/engagement/comments/cm-1/draft', { method: 'POST' })
    const res = await postDraft(req, { params: Promise.resolve({ workspaceId: 'ws-1', commentId: 'cm-1' }) })
    expect(res.status).toBe(200)

    const auditCall = vi.mocked(mockService.repo.recordAudit).mock.calls.find(
      (c) => c[0].action === 'regenerate_draft' && c[0].comment_id === 'cm-1'
    )
    expect(auditCall).toBeDefined()
    const details = auditCall![0].details
    expect(details).not.toHaveProperty('draftText')
    expect(details).toHaveProperty('draftFingerprint')
    expect(details).toHaveProperty('draftLength')
  })

  it('PATCH /comments/[id]/draft: rejects invalid body with 422', async () => {
    mockAuth.mockResolvedValueOnce(wsContext)
    const req = new Request('https://example.com/api/workspaces/ws-1/engagement/comments/cm-1/draft', {
      method: 'PATCH',
      body: JSON.stringify({ draftText: '' }), // empty string rejected by min(1)
    })
    const res = await patchDraft(req, { params: Promise.resolve({ workspaceId: 'ws-1', commentId: 'cm-1' }) })
    expect(res.status).toBe(422)
  })

  it('PATCH /comments/[id]/draft: updates draft and scrubs draftText from audit details', async () => {
    mockAuth.mockResolvedValueOnce(wsContext)
    const req = new Request('https://example.com/api/workspaces/ws-1/engagement/comments/cm-1/draft', {
      method: 'PATCH',
      body: JSON.stringify({ draftText: '수정된 답글 문안입니다.' }),
    })
    const res = await patchDraft(req, { params: Promise.resolve({ workspaceId: 'ws-1', commentId: 'cm-1' }) })
    expect(res.status).toBe(200)

    const auditCall = vi.mocked(mockService.repo.recordAudit).mock.calls.find(
      (c) => c[0].action === 'edit_draft' && c[0].comment_id === 'cm-1'
    )
    expect(auditCall).toBeDefined()
    const details = auditCall![0].details
    expect(details).not.toHaveProperty('draftText')
    expect(details).toHaveProperty('draftFingerprint')
    expect(details).toHaveProperty('draftLength')
    expect(details.draftLength).toBe('수정초안'.length)
  })

  it.each([undefined, 'stale-fingerprint'])('POST /comments/[id]/send: rejects missing or stale review fingerprint (%s)', async expectedFingerprint => {
    mockAuth.mockResolvedValueOnce(wsContext)
    mockService.send.mockClear()
    mockService.repo.approveDraft.mockClear()
    const req = new Request('https://example.com/send', { method: 'POST', body: JSON.stringify({ expectedFingerprint }) })
    const res = await postSend(req, { params: Promise.resolve({ workspaceId: VALID_WS_ID, commentId: 'cm-1' }) })
    expect(res.status).toBe(409)
    expect(mockService.send).not.toHaveBeenCalled()
    expect(mockService.repo.approveDraft).not.toHaveBeenCalled()
  })

  it('POST /comments/[id]/send: allows manager and returns 200', async () => {
    mockAuth.mockResolvedValueOnce(wsContext)
    const { computeApprovalFingerprint } = await import('@/features/engagement/draft')
    const req = new Request('https://example.com/api/workspaces/ws-1/engagement/comments/cm-1/send', { method: 'POST', body: JSON.stringify({ expectedFingerprint: computeApprovalFingerprint(VALID_WS_ID, 'cm-1', '초안') }) })
    const res = await postSend(req, { params: Promise.resolve({ workspaceId: 'ws-1', commentId: 'cm-1' }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
  })

  it('POST /comments/[id]/dismiss: allows manager and returns 200', async () => {
    mockAuth.mockResolvedValueOnce(wsContext)
    const req = new Request('https://example.com/api/workspaces/ws-1/engagement/comments/cm-1/dismiss', { method: 'POST' })
    const res = await postDismiss(req, { params: Promise.resolve({ workspaceId: 'ws-1', commentId: 'cm-1' }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
  })

  it('GET /policy: allows viewer (200)', async () => {
    mockAuth.mockResolvedValueOnce({ ...wsContext, role: 'viewer' })
    const req = new Request('https://example.com/api/workspaces/ws-1/engagement/policy?channel=instagram')
    const res = await getPolicy(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })
    expect(res.status).toBe(200)
  })

  it('PUT /policy: validates schema (422 for invalid daily_cap)', async () => {
    mockAuth.mockResolvedValueOnce(wsContext)
    const req = new Request('https://example.com/api/workspaces/ws-1/engagement/policy', {
      method: 'PUT',
      body: JSON.stringify({ channel: 'instagram', daily_cap: 500 }), // daily_cap max is 100
    })
    const res = await putPolicy(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })
    expect(res.status).toBe(422)
  })

  it('POST /api/internal/engagement/run: rejects missing or invalid secret (404)', async () => {
    process.env.CRON_SECRET = 'a'.repeat(32)
    const req = new Request('https://example.com/api/internal/engagement/run', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong-secret' },
    })
    const res = await runInternalEngagement(req)
    expect(res.status).toBe(404)
  })
})
