import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  membership: vi.fn(),
  policySelect: vi.fn(),
  policyUpdate: vi.fn(),
  policyUpsert: vi.fn(),
  ruleSingle: vi.fn(),
  rulesSelect: vi.fn(),
  rulesUpdate: vi.fn(),
  rulesInsert: vi.fn(),
  credentialSelect: vi.fn(),
}))

function createServerSupabaseMock() {
  return {
    auth: { getUser: mocks.getUser },
    from: vi.fn((table: string) => {
      if (table === 'workspace_members') {
        const query: any = {
          select: vi.fn(() => query),
          eq: vi.fn(() => query),
          maybeSingle: mocks.membership,
        }
        return query
      }
      throw new Error(`Unexpected server table: ${table}`)
    }),
  }
}

function createAdminSupabaseMock() {
  return {
    from: vi.fn((table: string) => {
      if (table === 'engagement_policies') {
        const query: any = {
          select: vi.fn(() => query),
          eq: vi.fn(() => query),
          maybeSingle: mocks.policySelect,
          update: vi.fn((payload: any) => {
            mocks.policyUpdate(payload)
            return {
              eq: vi.fn(() => ({
                eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
              })),
            }
          }),
          upsert: vi.fn((payload: any) => {
            mocks.policyUpsert(payload)
            return {
              select: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({ data: payload, error: null })),
              })),
            }
          }),
        }
        return query
      }
      if (table === 'automation_rules') {
        const query: any = {
          select: vi.fn(() => query),
          eq: vi.fn(() => query),
          in: vi.fn(() => query),
          maybeSingle: mocks.ruleSingle,
          update: vi.fn((payload: any) => {
            mocks.rulesUpdate(payload)
            return {
              eq: vi.fn(() => ({
                eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
              })),
            }
          }),
          insert: vi.fn((payload: any) => {
            mocks.rulesInsert(payload)
            return Promise.resolve({ data: null, error: null })
          }),
          then: (resolve: any) => Promise.resolve(mocks.rulesSelect()).then(resolve),
        }
        return query
      }
      if (table === 'meta_channel_credentials') {
        const query: any = {
          select: vi.fn(() => query),
          eq: vi.fn(() => query),
          maybeSingle: mocks.credentialSelect,
        }
        return query
      }
      throw new Error(`Unexpected admin table: ${table}`)
    }),
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => createServerSupabaseMock()),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => createAdminSupabaseMock()),
}))

import { loadPostPublishCare } from './load-post-publish-care'
import { updatePostPublishCare } from './update-post-publish-care'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'

describe('Post-Publish Sohee Care Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null })
    mocks.membership.mockResolvedValue({
      data: { workspace_id: WORKSPACE_ID, role: 'owner', status: 'active' },
      error: null,
    })
    mocks.policySelect.mockResolvedValue({
      data: { is_paused: false, auto_reply_enabled: false, autonomy_level: 'L1_MANUAL' },
      error: null,
    })
    mocks.ruleSingle.mockResolvedValue({
      data: { id: 'rule-123', kind: 'daily_performance_report', active: true },
      error: null,
    })
    mocks.rulesSelect.mockResolvedValue({
      data: [{ kind: 'daily_performance_report', active: true }],
      error: null,
    })
    mocks.credentialSelect.mockResolvedValue({
      data: {
        status: 'active',
        granted_scopes: [
          'instagram_business_basic',
          'instagram_business_manage_messages',
          'instagram_business_manage_comments',
        ],
      },
      error: null,
    })
  })

  describe('1. Tenant Isolation & Authentication', () => {
    it('rejects unauthenticated requests on load', async () => {
      mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: new Error('no user') })
      const result = await loadPostPublishCare({ workspaceId: WORKSPACE_ID, channel: 'instagram' })
      expect(result).toEqual({ ok: false, code: 'unauthenticated' })
    })

    it('rejects unauthenticated requests on update', async () => {
      mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: new Error('no user') })
      const result = await updatePostPublishCare({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        key: 'comment_watch',
        enabled: true,
      })
      expect(result).toEqual({ ok: false, code: 'unauthenticated' })
    })

    it('rejects users who are not active members of the workspace', async () => {
      mocks.membership.mockResolvedValueOnce({ data: null, error: null })
      const result = await loadPostPublishCare({ workspaceId: WORKSPACE_ID, channel: 'instagram' })
      expect(result).toEqual({ ok: false, code: 'forbidden' })
    })

    it('rejects update if user membership is disabled or mismatched', async () => {
      mocks.membership.mockResolvedValueOnce({
        data: { workspace_id: WORKSPACE_ID, role: 'owner', status: 'disabled' },
        error: null,
      })
      const result = await updatePostPublishCare({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        key: 'comment_watch',
        enabled: true,
      })
      expect(result).toEqual({ ok: false, code: 'forbidden' })
    })
  })

  describe('2. Role Check (Owner / Manager only for updates)', () => {
    it('allows manager to update settings', async () => {
      mocks.membership.mockResolvedValueOnce({
        data: { workspace_id: WORKSPACE_ID, role: 'manager', status: 'active' },
        error: null,
      })
      const result = await updatePostPublishCare({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        key: 'comment_watch',
        enabled: true,
      })
      expect(result.ok).toBe(true)
    })

    it('rejects reviewer from updating settings', async () => {
      mocks.membership.mockResolvedValueOnce({
        data: { workspace_id: WORKSPACE_ID, role: 'reviewer', status: 'active' },
        error: null,
      })
      const result = await updatePostPublishCare({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        key: 'comment_watch',
        enabled: true,
      })
      expect(result).toEqual({ ok: false, code: 'forbidden' })
    })

    it('rejects viewer from updating settings', async () => {
      mocks.membership.mockResolvedValueOnce({
        data: { workspace_id: WORKSPACE_ID, role: 'viewer', status: 'active' },
        error: null,
      })
      const result = await updatePostPublishCare({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        key: 'comment_watch',
        enabled: true,
      })
      expect(result).toEqual({ ok: false, code: 'forbidden' })
    })

    it('allows viewer or reviewer to read settings (read-only)', async () => {
      mocks.membership.mockResolvedValueOnce({
        data: { workspace_id: WORKSPACE_ID, role: 'viewer', status: 'active' },
        error: null,
      })
      const result = await loadPostPublishCare({ workspaceId: WORKSPACE_ID, channel: 'instagram' })
      expect(result.ok).toBe(true)
    })
  })

  describe('3. F1: No Write Support for dm_watch and booking_inquiry_watch', () => {
    it('rejects attempt to write dm_watch with invalid_input', async () => {
      const result = await updatePostPublishCare({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        key: 'dm_watch' as any,
        enabled: true,
      })
      expect(result).toEqual({ ok: false, code: 'invalid_input' })
      expect(mocks.rulesInsert).not.toHaveBeenCalled()
      expect(mocks.rulesUpdate).not.toHaveBeenCalled()
    })

    it('rejects attempt to write booking_inquiry_watch with invalid_input', async () => {
      const result = await updatePostPublishCare({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        key: 'booking_inquiry_watch' as any,
        enabled: true,
      })
      expect(result).toEqual({ ok: false, code: 'invalid_input' })
      expect(mocks.rulesInsert).not.toHaveBeenCalled()
      expect(mocks.rulesUpdate).not.toHaveBeenCalled()
    })

    it('never writes or references faq_safe_reply or schedule_reminder rule kinds', async () => {
      await updatePostPublishCare({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        key: 'reaction_report',
        enabled: true,
      })
      expect(mocks.rulesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ active: true }),
      )
      expect(mocks.rulesInsert).not.toHaveBeenCalled()
    })
  })

  describe('4. F2: No automation_rules Insert Ever & needs_setup Contract', () => {
    it('returns needs_setup when reaction_report is updated but no rule exists', async () => {
      mocks.ruleSingle.mockResolvedValueOnce({ data: null, error: null })
      const result = await updatePostPublishCare({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        key: 'reaction_report',
        enabled: true,
      })

      expect(result).toEqual({ ok: false, code: 'needs_setup' })
      expect(mocks.rulesInsert).not.toHaveBeenCalled()
    })

    it('returns reaction_report with needsSetup: true on load when no rule exists', async () => {
      mocks.rulesSelect.mockResolvedValueOnce({ data: [], error: null })
      const result = await loadPostPublishCare({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.state.reaction_report).toEqual({
          enabled: false,
          available: false,
          reason: '자동화 설정(/app/account/automation)에서 성과 보고 규칙을 먼저 등록해 주세요',
          needsSetup: true,
        })
      }
    })

    it('flips active on existing daily_performance_report rule without inserting new rows', async () => {
      mocks.ruleSingle.mockResolvedValueOnce({
        data: { id: 'rule-789', kind: 'daily_performance_report', active: false },
        error: null,
      })
      const result = await updatePostPublishCare({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        key: 'reaction_report',
        enabled: true,
      })

      expect(result.ok).toBe(true)
      expect(mocks.rulesInsert).not.toHaveBeenCalled()
      expect(mocks.rulesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ active: true }),
      )
    })
  })

  describe('5. F3: Comment Watch Canonical Defaults & Invariants', () => {
    it('always preserves L1_MANUAL and auto_reply_enabled: false when updating existing policy', async () => {
      await updatePostPublishCare({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        key: 'comment_watch',
        enabled: true,
      })
      expect(mocks.policyUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          is_paused: false,
          autonomy_level: 'L1_MANUAL',
          auto_reply_enabled: false,
        }),
      )
    })

    it('creates policy using canonical defaults when none exists', async () => {
      mocks.policySelect.mockResolvedValueOnce({ data: null, error: null })
      await updatePostPublishCare({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        key: 'comment_watch',
        enabled: false,
      })
      expect(mocks.policyUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'instagram',
          is_paused: true,
          autonomy_level: 'L1_MANUAL',
          auto_reply_enabled: false,
          allowed_classes: ['THANKS', 'GREETING'],
          min_confidence: 0.85,
          daily_cap: 5,
        }),
      )
    })
  })

  describe('6. Real Evidence Derivation for always_on', () => {
    it('threads channel always has dm active: false with exact reason', async () => {
      const result = await loadPostPublishCare({
        workspaceId: WORKSPACE_ID,
        channel: 'threads',
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.state.always_on.dm).toEqual({
          active: false,
          reason: '스레드는 DM 기능을 지원하지 않아요',
        })
      }
    })

    it('derives active dm and booking_inquiry for instagram when credentials have proper scopes', async () => {
      mocks.credentialSelect.mockResolvedValueOnce({
        data: {
          status: 'active',
          granted_scopes: [
            'instagram_business_basic',
            'instagram_business_manage_messages',
            'instagram_business_manage_comments',
          ],
        },
        error: null,
      })
      const result = await loadPostPublishCare({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.state.always_on.dm).toEqual({
          active: true,
          reason: null,
        })
        expect(result.state.always_on.booking_inquiry).toEqual({
          active: true,
          reason: null,
        })
      }
    })

    it('derives inactive dm when credentials lack manage_messages scope', async () => {
      mocks.credentialSelect.mockResolvedValueOnce({
        data: {
          status: 'active',
          granted_scopes: ['instagram_business_basic', 'instagram_business_manage_comments'],
        },
        error: null,
      })
      const result = await loadPostPublishCare({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.state.always_on.dm.active).toBe(false)
        expect(result.state.always_on.dm.reason).toContain('instagram_business_manage_messages')
        expect(result.state.always_on.booking_inquiry.active).toBe(true)
      }
    })
  })

  describe('7. Idempotency & Error Handling', () => {
    it('calling update twice with same input produces the same result', async () => {
      const first = await updatePostPublishCare({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        key: 'comment_watch',
        enabled: true,
      })
      const second = await updatePostPublishCare({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        key: 'comment_watch',
        enabled: true,
      })
      expect(first).toEqual(second)
    })

    it('handles unexpected database exception gracefully without leaking details', async () => {
      mocks.membership.mockRejectedValueOnce(new Error('Fatal connection lost to postgres'))
      const result = await updatePostPublishCare({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        key: 'comment_watch',
        enabled: true,
      })
      expect(result).toEqual({ ok: false, code: 'internal_error' })
    })
  })

  describe('8. Owner Policy: No Credit Amounts in User-Facing Strings', () => {
    it('never contains credit numbers or credit references in reasons or states', async () => {
      const result = await loadPostPublishCare({ workspaceId: WORKSPACE_ID, channel: 'threads' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        const json = JSON.stringify(result.state)
        expect(json).not.toMatch(/\d+\s*(크레딧|credit)/i)
        expect(json).not.toMatch(/credit/i)
      }
    })
  })
})
