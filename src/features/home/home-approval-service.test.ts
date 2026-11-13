import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchPendingHomeApprovals,
  executeBatchHomeApprovals,
} from './home-approval-service'
import { computeApprovalFingerprint } from '@/features/engagement/draft'
import { computeDmApprovalFingerprint } from '@/features/engagement/dm/options-generator'

// DM 전송 게이트의 실제 동작은 그대로 두고, 결과 분류만 검증할 수 있도록 override 지점을 둔다.
const dmSendOverride = vi.hoisted(() => ({ impl: null as null | ((...args: any[]) => any) }))

vi.mock('@/features/engagement/dm/compose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/engagement/dm/compose')>()
  return {
    ...actual,
    createInstagramDmService: (adminClient: any) =>
      dmSendOverride.impl ? { send: dmSendOverride.impl } : actual.createInstagramDmService(adminClient),
  }
})

describe('home-approval-service', () => {
  it('keeps compliment cards pending in L2 mode and never claims auto-handling', async () => {
    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'engagement_policies') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { autonomy_level: 'L2_ASSISTED' },
            }),
          }
        }
        if (table === 'social_comments') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'c1',
                  channel: 'instagram',
                  author_handle: 'happy_user',
                  comment_text: '감사합니다 너무 좋아요!',
                  classification: 'THANKS',
                  status: 'DRAFTED',
                  created_at: '2026-10-15T01:00:00Z',
                },
                {
                  id: 'c2',
                  channel: 'threads',
                  author_handle: 'asker',
                  comment_text: '얼마인가요?',
                  classification: 'QUESTION',
                  status: 'DRAFTED',
                  created_at: '2026-10-15T02:00:00Z',
                },
              ],
            }),
          }
        }
        if (table === 'comment_reply_drafts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                { comment_id: 'c1', draft_text: '감사합니다!' },
                { comment_id: 'c2', draft_text: '가격은 5만원입니다.' },
              ],
            }),
          }
        }
        if (table === 'marketing_missions') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'm1',
                  status: 'AWAITING_APPROVAL',
                  metadata: {
                    topic: '환절기 스킨케어 꿀팁',
                    caption: '가을철 피부 건조함을 꽉 잡아주는 1:1 맞춤 진정 케어 프로그램이에요.',
                  },
                  created_at: '2026-10-15T03:00:00Z',
                },
              ],
            }),
          }
        }
        if (table === 'instagram_dm_threads') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [] }),
          }
        }
        if (table === 'reservations') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [] }),
          }
        }
        return { select: vi.fn().mockReturnThis() }
      }),
    }

    const res = await fetchPendingHomeApprovals(mockAdmin, 'ws-123')
    expect(res.autonomyLevel).toBe('L2')
    expect(res.autoHandledCount).toBe(0)
    expect(res.autoHandledLabel).toBeUndefined()
    expect(res.items.some((i) => i.id === 'comment:c2')).toBe(true)
    expect(res.items.some((i) => i.id === 'post:m1')).toBe(true)
    // Truthful gate: fake proposal items without backing records are not included in actual approvals
    expect(res.items.some((i) => i.id.startsWith('proposal:'))).toBe(false)
    expect(res.items.some((i) => i.id === 'comment:c1')).toBe(true)

    // 승인 화면이 검증할 수 있도록 미리보기 지문을 DTO에 내려준다 (실제 초안 텍스트 기준)
    const c1Item = res.items.find((i) => i.id === 'comment:c1')
    expect(c1Item?.metadata?.approvalFingerprint).toBe(
      computeApprovalFingerprint('ws-123', 'c1', '감사합니다!')
    )
  })

  it('includes all items in L1 mode without auto-handling', async () => {
    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'engagement_policies') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { autonomy_level: 'L1_MANUAL' },
            }),
          }
        }
        if (table === 'social_comments') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'c1',
                  channel: 'instagram',
                  author_handle: 'happy_user',
                  comment_text: '감사합니다 너무 좋아요!',
                  classification: 'THANKS',
                  status: 'DRAFTED',
                  created_at: '2026-10-15T01:00:00Z',
                },
              ],
            }),
          }
        }
        if (table === 'comment_reply_drafts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [{ comment_id: 'c1', draft_text: '감사합니다!' }],
            }),
          }
        }
        if (table === 'marketing_missions' || table === 'instagram_dm_threads') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [] }),
          }
        }
        if (table === 'reservations') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [] }),
          }
        }
        return { select: vi.fn().mockReturnThis() }
      }),
    }

    const res = await fetchPendingHomeApprovals(mockAdmin, 'ws-123')
    expect(res.autonomyLevel).toBe('L1')
    expect(res.autoHandledCount).toBe(0)
    expect(res.items.some((i) => i.id === 'comment:c1')).toBe(true)
    expect(res.items.some((i) => i.id.startsWith('proposal:'))).toBe(false)
  })

  it('executes batch approval update on targets with verified fingerprints and CAS', async () => {
    const selectAfterUpdate = vi.fn().mockResolvedValue({ data: [{ id: 'updated-1' }], error: null })
    let draftRow: { id: string; draft_text: string; approved_fingerprint: string | null } = {
      id: 'd1',
      draft_text: '답글',
      approved_fingerprint: null,
    }
    const updateSpy = vi.fn((patch: Record<string, unknown>) => {
      if (patch && 'approved_fingerprint' in patch) {
        draftRow = { ...draftRow, ...(patch as Partial<typeof draftRow>) }
      }
      return {
        eq: vi.fn().mockReturnThis(),
        select: selectAfterUpdate,
      }
    })
    const mockAdmin = {
      from: vi.fn((table: string) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockImplementation(async () => {
          if (table === 'social_comments') {
            return { data: { id: 'c1', status: 'DRAFTED' } }
          }
          if (table === 'comment_reply_drafts') {
            return { data: { ...draftRow } }
          }
          if (table === 'marketing_missions') {
            return { data: { id: 'p1', status: 'AWAITING_APPROVAL' } }
          }
          return { data: null }
        }),
        update: updateSpy,
      })),
    }

    const result = await executeBatchHomeApprovals(
      mockAdmin,
      'ws-123',
      {
        action: 'approve',
        itemIds: ['comment:c1', 'post:p1'],
        fingerprints: { 'comment:c1': computeApprovalFingerprint('ws-123', 'c1', '답글') },
      },
      'user-1'
    )

    expect(result.processedCount).toBe(2)
    expect(result.succeededIds).toEqual(['comment:c1', 'post:p1'])
    expect(result.reconciliationRequiredIds).toHaveLength(0)
    expect(updateSpy).toHaveBeenCalled()
  })

  it('strictly rejects comment approval when the client fingerprint is missing or mismatched', async () => {
    const updateSpy = vi.fn(() => ({
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({ data: [{ id: 'd1' }], error: null }),
    }))
    const mockAdmin = {
      from: vi.fn((table: string) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockImplementation(async () => {
          if (table === 'social_comments') {
            return { data: { id: 'c1', status: 'DRAFTED' } }
          }
          if (table === 'comment_reply_drafts') {
            return { data: { id: 'd1', draft_text: '실제 초안 텍스트' } }
          }
          return { data: null }
        }),
        update: updateSpy,
      })),
    }

    const missing = await executeBatchHomeApprovals(
      mockAdmin,
      'ws-123',
      { action: 'approve', itemIds: ['comment:c1'] },
      'user-1'
    )
    expect(missing.failedIds).toContain('comment:c1')
    expect(missing.succeededIds).toHaveLength(0)

    const mismatched = await executeBatchHomeApprovals(
      mockAdmin,
      'ws-123',
      {
        action: 'approve',
        itemIds: ['comment:c1'],
        fingerprints: { 'comment:c1': 'stale_fingerprint_from_old_preview' },
      },
      'user-1'
    )
    expect(mismatched.failedIds).toContain('comment:c1')
    expect(mismatched.succeededIds).toHaveLength(0)

    // 어떤 승인 요청도 초안 승인 업데이트로 이어지지 않아야 한다
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('fails comment approval when the draft CAS update affects 0 rows (concurrent edit)', async () => {
    const mockAdmin = {
      from: vi.fn((table: string) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockImplementation(async () => {
          if (table === 'social_comments') {
            return { data: { id: 'c1', status: 'DRAFTED' } }
          }
          if (table === 'comment_reply_drafts') {
            return { data: { id: 'd1', draft_text: '원래 초안' } }
          }
          return { data: null }
        }),
        update: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      })),
    }

    const result = await executeBatchHomeApprovals(
      mockAdmin,
      'ws-123',
      {
        action: 'approve',
        itemIds: ['comment:c1'],
        fingerprints: { 'comment:c1': computeApprovalFingerprint('ws-123', 'c1', '원래 초안') },
      },
      'user-1'
    )

    expect(result.failedIds).toContain('comment:c1')
    expect(result.succeededIds).toHaveLength(0)
  })

  it('compensates the draft approval when the comment status update affects 0 rows', async () => {
    const draftPatches: Array<Record<string, unknown>> = []
    const mockAdmin = {
      from: vi.fn((table: string) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockImplementation(async () => {
          if (table === 'social_comments') {
            return { data: { id: 'c1', status: 'DRAFTED' } }
          }
          if (table === 'comment_reply_drafts') {
            return { data: { id: 'd1', draft_text: '초안' } }
          }
          return { data: null }
        }),
        update: vi.fn((patch: Record<string, unknown>) => {
          if (table === 'comment_reply_drafts') {
            draftPatches.push(patch)
            return {
              eq: vi.fn().mockReturnThis(),
              select: vi.fn().mockResolvedValue({ data: [{ id: 'd1' }], error: null }),
            }
          }
          return {
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockResolvedValue({ data: [], error: null }),
          }
        }),
      })),
    }

    const result = await executeBatchHomeApprovals(
      mockAdmin,
      'ws-123',
      {
        action: 'approve',
        itemIds: ['comment:c1'],
        fingerprints: { 'comment:c1': computeApprovalFingerprint('ws-123', 'c1', '초안') },
      },
      'user-1'
    )

    expect(result.failedIds).toContain('comment:c1')
    expect(result.succeededIds).toHaveLength(0)
    expect(result.reconciliationRequiredIds).toHaveLength(0)
    // 첫 쓰기(지문 바인딩)를 되돌리는 보상 업데이트가 반드시 나가야 한다
    expect(draftPatches).toHaveLength(2)
    expect(draftPatches[1]?.approved_fingerprint).toBeNull()
    expect(draftPatches[1]?.approved_by).toBeNull()
  })

  it('reports reconciliation when the compensating draft revert itself fails', async () => {
    const mockAdmin = {
      from: vi.fn((table: string) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockImplementation(async () => {
          if (table === 'social_comments') {
            return { data: { id: 'c1', status: 'DRAFTED' } }
          }
          if (table === 'comment_reply_drafts') {
            return { data: { id: 'd1', draft_text: '초안' } }
          }
          return { data: null }
        }),
        update: vi.fn((patch: Record<string, unknown>) => {
          if (table === 'comment_reply_drafts') {
            if (patch?.approved_fingerprint === null) {
              // 보상 되돌리기 실패 (await 시 error 반환)
              const failing: any = {
                eq: vi.fn(),
                then: (resolve: (v: unknown) => void) => resolve({ error: { message: 'revert failed' } }),
              }
              failing.eq.mockReturnValue(failing)
              return failing
            }
            return {
              eq: vi.fn().mockReturnThis(),
              select: vi.fn().mockResolvedValue({ data: [{ id: 'd1' }], error: null }),
            }
          }
          return {
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockResolvedValue({ data: [], error: null }),
          }
        }),
      })),
    }

    const result = await executeBatchHomeApprovals(
      mockAdmin,
      'ws-123',
      {
        action: 'approve',
        itemIds: ['comment:c1'],
        fingerprints: { 'comment:c1': computeApprovalFingerprint('ws-123', 'c1', '초안') },
      },
      'user-1'
    )

    // 반쯤 적용된 상태를 단정할 수 없으므로 단순 실패가 아니라 대조 필요로 보고한다
    expect(result.reconciliationRequiredIds).toContain('comment:c1')
    expect(result.failedIds).not.toContain('comment:c1')
    expect(result.succeededIds).toHaveLength(0)
  })

  it('rolls back both writes when the draft changes between the CAS bind and the status update', async () => {
    let draftReads = 0
    const commentPatches: Array<Record<string, unknown>> = []
    const draftPatches: Array<Record<string, unknown>> = []
    const mockAdmin = {
      from: vi.fn((table: string) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockImplementation(async () => {
          if (table === 'social_comments') {
            return { data: { id: 'c1', status: 'DRAFTED' } }
          }
          if (table === 'comment_reply_drafts') {
            draftReads++
            // 두 번째 읽기는 승인 직전에 동시 편집된 상태를 흉내낸다
            if (draftReads > 1) {
              return { data: { draft_text: '동시 편집된 초안', approved_fingerprint: null } }
            }
            return { data: { id: 'd1', draft_text: '원래 초안' } }
          }
          return { data: null }
        }),
        update: vi.fn((patch: Record<string, unknown>) => {
          if (table === 'social_comments') commentPatches.push(patch)
          if (table === 'comment_reply_drafts') draftPatches.push(patch)
          return {
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockResolvedValue({ data: [{ id: table === 'social_comments' ? 'c1' : 'd1' }], error: null }),
          }
        }),
      })),
    }

    const result = await executeBatchHomeApprovals(
      mockAdmin,
      'ws-123',
      {
        action: 'approve',
        itemIds: ['comment:c1'],
        fingerprints: { 'comment:c1': computeApprovalFingerprint('ws-123', 'c1', '원래 초안') },
      },
      'user-1'
    )

    expect(result.failedIds).toContain('comment:c1')
    expect(result.succeededIds).toHaveLength(0)
    // 승인 되돌림 + 승인 지문 되돌림 둘 다 나가야 한다
    expect(commentPatches).toEqual([{ status: 'APPROVED' }, { status: 'DRAFTED' }])
    expect(draftPatches).toHaveLength(2)
    expect(draftPatches[1]?.approved_fingerprint).toBeNull()
  })

  it('rejects comment approval from another workspace', async () => {
    const mockAdmin = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    }

    const result = await executeBatchHomeApprovals(
      mockAdmin,
      'ws-target',
      {
        action: 'approve',
        itemIds: ['comment:c-other-ws'],
        fingerprints: { 'comment:c-other-ws': 'some-fp' },
      },
      'user-1'
    )

    expect(result.failedIds).toContain('comment:c-other-ws')
    expect(result.succeededIds).toHaveLength(0)
  })

  it('filters out dummy posts and deduplicates identical captions', async () => {
    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'engagement_policies') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          }
        }
        if (table === 'knowledge_facts' || table === 'knowledge_sources') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            count: 0,
            head: true,
          }
        }
        if (table === 'marketing_missions') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'dummy-1',
                  status: 'AWAITING_APPROVAL',
                  metadata: { caption: '소희가 작성한 매장 소식 콘텐츠입니다.' },
                },
                {
                  id: 'valid-1',
                  status: 'AWAITING_APPROVAL',
                  metadata: {
                    topic: '가을 힐링 케어',
                    caption: '환절기 건조한 날씨에 피부 장벽을 편안하게 채워드리는 가을 힐링 프로그램이에요.',
                  },
                },
                {
                  id: 'duplicate-1',
                  status: 'AWAITING_APPROVAL',
                  metadata: {
                    topic: '가을 힐링 케어 복사본',
                    caption: '환절기 건조한 날씨에 피부 장벽을 편안하게 채워드리는 가을 힐링 프로그램이에요.',
                  },
                },
              ],
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [] }),
        }
      }),
    }

    const res = await fetchPendingHomeApprovals(mockAdmin, 'ws-123')
    expect(res.knowledgeStatus?.needsKnowledgePrompt).toBe(true)
    // dummy-1은 필터링되고, duplicate-1은 중복 제거되어 valid-1만 post 항목으로 남아야 함
    const postItems = res.items.filter((i) => i.category === 'post_publish')
    expect(postItems.length).toBe(1)
    expect(postItems[0].id).toBe('post:valid-1')
  })

  it('fails DM approval when sending is disabled or send fails (truthful send gate)', async () => {
    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'instagram_dm_threads') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 't1',
                workspace_id: 'ws-123',
                customer_handle: 'user1',
                customer_id: 'cust-1',
                channel_connection_id: 'conn-1',
                status: 'NEEDS_REPLY',
                expires_at: new Date(Date.now() + 3600000).toISOString(),
              },
            }),
            update: vi.fn().mockResolvedValue({ error: null }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        }
      }),
    }

    // Default process.env.ENGAGEMENT_SEND_ENABLED is not '1' in test environment
    const result = await executeBatchHomeApprovals(
      mockAdmin,
      'ws-123',
      { action: 'approve', itemIds: ['dm:t1'] },
      'user-1'
    )

    expect(result.failedIds).toContain('dm:t1')
    expect(result.succeededIds).not.toContain('dm:t1')
  })

  it('fails unknown or unsupported proposal IDs instead of silently succeeding', async () => {
    const mockAdmin = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        update: vi.fn().mockResolvedValue({ error: null }),
      })),
    }

    const result = await executeBatchHomeApprovals(
      mockAdmin,
      'ws-123',
      { action: 'approve', itemIds: ['proposal:counter-1', 'unknown:xyz'] },
      'user-1'
    )

    expect(result.failedIds).toContain('proposal:counter-1')
    expect(result.failedIds).toContain('unknown:xyz')
    expect(result.succeededIds).toHaveLength(0)
  })

  it('fails closed and rejects arbitrary reservation creation on DM approval', async () => {
    const insertSpy = vi.fn().mockResolvedValue({ error: null })
    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'reservations') {
          return { insert: insertSpy }
        }
        if (table === 'instagram_dm_threads') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 't1',
                workspace_id: 'ws-123',
                customer_handle: 'user1',
                status: 'NEEDS_REPLY',
              },
            }),
            update: vi.fn().mockResolvedValue({ error: null }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        }
      }),
    }

    const result = await executeBatchHomeApprovals(
      mockAdmin,
      'ws-123',
      { action: 'approve', itemIds: ['dm:t1'], createBooking: true },
      'user-1'
    )

    // Arbitrary reservation must NOT be created from home approval hub
    expect(insertSpy).not.toHaveBeenCalled()
    // createBooking: true must reject the entire request
    expect(result.failedIds).toContain('dm:t1')
  })

  it('refuses all: true for DM items to avoid blind sending of uninspected new DMs', async () => {
    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'engagement_policies') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          }
        }
        if (table === 'instagram_dm_threads') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'thread-auto',
                  status: 'NEEDS_REPLY',
                  customer_handle: 'user_auto',
                  last_message_at: '2026-10-15T00:00:00Z',
                },
              ],
            }),
          }
        }
        if (table === 'instagram_dm_drafts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [{ thread_id: 'thread-auto', draft_text: '초안' }],
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [] }),
        }
      }),
    }

    const result = await executeBatchHomeApprovals(
      mockAdmin,
      'ws-123',
      { action: 'approve', all: true },
      'user-1'
    )

    // All DMs under all:true must be rejected by server
    expect(result.failedIds).toContain('dm:thread-auto')
  })

  it('rejects DM approval when client fingerprint does not match current DB draft', async () => {
    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'instagram_dm_threads') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 't-fp',
                workspace_id: 'ws-123',
                customer_handle: 'user_fp',
                status: 'NEEDS_REPLY',
              },
            }),
          }
        }
        if (table === 'instagram_dm_drafts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'd-fp', draft_text: '서버 최신 초안' },
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        }
      }),
    }

    const result = await executeBatchHomeApprovals(
      mockAdmin,
      'ws-123',
      {
        action: 'approve',
        itemIds: ['dm:t-fp'],
        fingerprints: { 'dm:t-fp': 'stale_fingerprint_from_old_preview' },
      },
      'user-1'
    )

    expect(result.failedIds).toContain('dm:t-fp')
  })

  it('rejects DM approval when fingerprint is missing completely (strict fail-closed)', async () => {
    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'instagram_dm_threads') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 't-nofp',
                workspace_id: 'ws-123',
                customer_handle: 'user_nofp',
                status: 'NEEDS_REPLY',
              },
            }),
          }
        }
        if (table === 'instagram_dm_drafts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'd-nofp', draft_text: '초안 내용' },
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        }
      }),
    }

    const result = await executeBatchHomeApprovals(
      mockAdmin,
      'ws-123',
      {
        action: 'approve',
        itemIds: ['dm:t-nofp'],
        // fingerprints is completely missing
      },
      'user-1'
    )

    expect(result.failedIds).toContain('dm:t-nofp')
    expect(result.succeededIds).not.toContain('dm:t-nofp')
  })

  it('fails DM approval when CAS bind update affects 0 rows due to concurrent modification', async () => {
    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'instagram_dm_threads') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 't-cas',
                workspace_id: 'ws-123',
                customer_handle: 'user_cas',
                status: 'NEEDS_REPLY',
              },
            }),
          }
        }
        if (table === 'instagram_dm_drafts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'd-cas', draft_text: '초안' },
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnThis(),
              select: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        }
      }),
    }

    const fingerprint = computeDmApprovalFingerprint('ws-123', 't-cas', '초안')
    const result = await executeBatchHomeApprovals(
      mockAdmin,
      'ws-123',
      {
        action: 'approve',
        itemIds: ['dm:t-cas'],
        fingerprints: { 'dm:t-cas': fingerprint },
      },
      'user-1'
    )

    expect(result.failedIds).toContain('dm:t-cas')
    expect(result.succeededIds).toHaveLength(0)
  })

  describe('DM 승인 결과 분류', () => {
    afterEach(() => {
      dmSendOverride.impl = null
    })

    function createDmApprovalAdmin(threadId: string, draftText: string) {
      return {
        from: vi.fn((table: string) => {
          if (table === 'instagram_dm_threads') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: threadId,
                  workspace_id: 'ws-123',
                  customer_id: 'cust-1',
                  customer_handle: 'user_dm',
                  status: 'NEEDS_REPLY',
                },
              }),
            }
          }
          if (table === 'instagram_dm_drafts') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: `d-${threadId}`, draft_text: draftText },
              }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnThis(),
                select: vi.fn().mockResolvedValue({ data: [{ id: `d-${threadId}` }], error: null }),
              }),
            }
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          }
        }),
      }
    }

    async function approveDm(threadId: string, draftText: string) {
      return executeBatchHomeApprovals(
        createDmApprovalAdmin(threadId, draftText),
        'ws-123',
        {
          action: 'approve',
          itemIds: [`dm:${threadId}`],
          fingerprints: { [`dm:${threadId}`]: computeDmApprovalFingerprint('ws-123', threadId, draftText) },
        },
        'user-1'
      )
    }

    it('불확실한 전송 결과는 재시도 가능한 실패가 아니라 대조 필요로만 분류한다', async () => {
      dmSendOverride.impl = async () => ({
        sent: false,
        status: 'NEEDS_CHECK',
        providerOutcome: 'ACCEPTED_BUT_UNVERIFIED',
        localOutcome: 'PERSISTENCE_FAILED',
        reason: '전송 여부 확인 실패',
      })

      const result = await approveDm('t-uncertain', '안녕하세요')

      expect(result.reconciliationRequiredIds).toEqual(['dm:t-uncertain'])
      expect(result.failedIds).toEqual([])
      expect(result.succeededIds).toEqual([])
      expect(result.processedCount).toBe(0)
    })

    it('외부 전송은 확인됐지만 로컬 정산이 실패한 건도 대조 필요로만 분류한다', async () => {
      dmSendOverride.impl = async () => ({
        sent: true,
        status: 'NEEDS_CHECK',
        providerOutcome: 'READBACK_VERIFIED',
        localOutcome: 'RECONCILIATION_REQUIRED',
        reason: '로컬 정산 실패',
      })

      const result = await approveDm('t-unsettled', '안녕하세요')

      expect(result.reconciliationRequiredIds).toEqual(['dm:t-unsettled'])
      expect(result.failedIds).toEqual([])
      expect(result.succeededIds).toEqual([])
    })

    it('전송이 확인되지 않은 명확한 실패는 그대로 실패로 남긴다', async () => {
      dmSendOverride.impl = async () => ({
        sent: false,
        status: 'NEEDS_CHECK',
        providerOutcome: 'DELIVERY_FAILED',
        reason: '전송 실패',
      })

      const result = await approveDm('t-failed', '안녕하세요')

      expect(result.failedIds).toEqual(['dm:t-failed'])
      expect(result.reconciliationRequiredIds).toEqual([])
      expect(result.succeededIds).toEqual([])
    })

    it('readback과 로컬 정산이 모두 확인된 경우에만 성공으로 기록한다', async () => {
      dmSendOverride.impl = async () => ({
        sent: true,
        status: 'SENT',
        providerOutcome: 'READBACK_VERIFIED',
        localOutcome: 'RECORDED',
      })

      const result = await approveDm('t-ok', '안녕하세요')

      expect(result.succeededIds).toEqual(['dm:t-ok'])
      expect(result.failedIds).toEqual([])
      expect(result.reconciliationRequiredIds).toEqual([])
      expect(result.processedCount).toBe(1)
    })
  })

  it('fails DM dismiss when thread status update affects 0 rows due to race condition', async () => {
    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'instagram_dm_threads') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 't-race',
                workspace_id: 'ws-123',
                status: 'NEEDS_REPLY',
              },
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnThis(),
              select: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        }
      }),
    }

    const result = await executeBatchHomeApprovals(
      mockAdmin,
      'ws-123',
      {
        action: 'dismiss',
        itemIds: ['dm:t-race'],
      },
      'user-1'
    )

    expect(result.failedIds).toContain('dm:t-race')
    expect(result.succeededIds).toHaveLength(0)
  })

  it('prevents overwriting already SENT thread to DISMISSED or re-approving', async () => {
    const updateSpy = vi.fn().mockResolvedValue({ error: null })
    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'instagram_dm_threads') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 't-sent',
                workspace_id: 'ws-123',
                status: 'SENT',
              },
            }),
            update: updateSpy,
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        }
      }),
    }

    const result = await executeBatchHomeApprovals(
      mockAdmin,
      'ws-123',
      { action: 'dismiss', itemIds: ['dm:t-sent'] },
      'user-1'
    )

    expect(result.failedIds).toContain('dm:t-sent')
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('does not include fabricated revenue numbers or fake 2026-10-20 bookings in pending items', async () => {
    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'engagement_policies') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          }
        }
        if (table === 'knowledge_facts' || table === 'knowledge_sources') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            count: 5,
            head: true,
          }
        }
        if (table === 'instagram_dm_threads') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'thread-inquiry',
                  customer_handle: 'guest_1',
                  last_message_text: '내일 예약 가능한가요?',
                  last_message_at: '2026-10-15T10:00:00Z',
                  status: 'NEEDS_REPLY',
                },
              ],
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [] }),
        }
      }),
    }

    const res = await fetchPendingHomeApprovals(mockAdmin, 'ws-123')
    const dmItem = res.items.find((i) => i.id === 'dm:thread-inquiry')
    if (dmItem) {
      // Must not have fabricated booking date or fake guaranteed revenue
      expect(dmItem.suggestedBooking?.date).not.toBe('2026-10-20')
      expect(dmItem.roiImpact?.value).not.toContain('₩80,000 확정')
      expect(dmItem.roiImpact?.value).not.toContain('전환율 100%')
    }
  })
})
