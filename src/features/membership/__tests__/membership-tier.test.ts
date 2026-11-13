import { describe, it, expect, vi } from 'vitest'
import {
  getMembershipTier,
  isFormalMember,
  FormalMembershipRequiredError,
  TRIAL_FIRST_POST_LIMIT,
  FORMAL_MEMBERSHIP_NOTICE,
} from '../membership-tier'

describe('membership-tier feature unit tests', () => {
  it('exports correct constants and error specifications', () => {
    expect(TRIAL_FIRST_POST_LIMIT).toBe(2)
    expect(FORMAL_MEMBERSHIP_NOTICE).toBe('정식 회원 전용 기능이에요. 사업자 인증이 승인되면 바로 쓸 수 있어요.')

    const err = new FormalMembershipRequiredError()
    expect(err.name).toBe('FormalMembershipRequiredError')
    expect(err.code).toBe('FORMAL_MEMBERSHIP_REQUIRED')
    expect(err.statusCode).toBe(403)
    expect(err.status).toBe(403)
    expect(err.message).toBe('정식 회원 전용 기능이에요. 사업자 인증이 승인되면 바로 쓸 수 있어요.')
  })

  it('correctly evaluates isFormalMember', () => {
    expect(isFormalMember('FORMAL')).toBe(true)
    expect(isFormalMember('TRIAL')).toBe(false)
    expect(isFormalMember('PENDING_REVIEW')).toBe(false)
    expect(isFormalMember('REJECTED')).toBe(false)
    expect(isFormalMember(null)).toBe(false)
    expect(isFormalMember(undefined)).toBe(false)
  })

  describe('getMembershipTier RPC caller', () => {
    it('returns RPC data when successful', async () => {
      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({ data: 'FORMAL', error: null }),
      }

      const tier = await getMembershipTier(mockSupabase, 'ws-123')
      expect(tier).toBe('FORMAL')
      expect(mockSupabase.rpc).toHaveBeenCalledWith('get_workspace_membership_tier', {
        p_workspace_id: 'ws-123',
      })
    })

    it('returns TRIAL if RPC returns unexpected value', async () => {
      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({ data: 'UNKNOWN_VALUE', error: null }),
      }

      const tier = await getMembershipTier(mockSupabase, 'ws-123')
      expect(tier).toBe('TRIAL')
    })

    it('fails closed to TRIAL when RPC returns error', async () => {
      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({ data: null, error: new Error('RPC failure') }),
      }

      const tier = await getMembershipTier(mockSupabase, 'ws-123')
      expect(tier).toBe('TRIAL')
    })

    it('fails closed to TRIAL when RPC fails with permission denied (42501)', async () => {
      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { code: '42501', message: 'permission denied for function get_workspace_membership_tier' },
        }),
      }

      const tier = await getMembershipTier(mockSupabase, 'ws-123')
      expect(tier).toBe('TRIAL')
    })

    it('fails closed to TRIAL when RPC throws exception', async () => {
      const mockSupabase = {
        rpc: vi.fn().mockRejectedValue(new Error('Network offline')),
      }

      const tier = await getMembershipTier(mockSupabase, 'ws-123')
      expect(tier).toBe('TRIAL')
    })

    it('fails closed to TRIAL when supabase client or workspaceId is missing', async () => {
      expect(await getMembershipTier(null, 'ws-123')).toBe('TRIAL')
      expect(await getMembershipTier({} as any, '')).toBe('TRIAL')
    })

    describe('expanded formal membership evaluation (business verified OR connected channel OR paid)', () => {
      it('returns FORMAL when Instagram is connected even without business verification', async () => {
        const mockSupabase = {
          rpc: vi.fn().mockResolvedValue({ data: 'TRIAL', error: null }),
          from: vi.fn((table: string) => {
            if (table === 'channel_connections') {
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                in: vi.fn().mockResolvedValue({
                  data: [{ channel: 'instagram', status: 'connected', account_label: '@my_cafe' }],
                  error: null,
                }),
              }
            }
            if (table === 'workspace_credit_states') {
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { purchased_credits: 0, commercial_state: 'TRIAL_ACTIVE' },
                  error: null,
                }),
              }
            }
            return { select: vi.fn().mockReturnThis() }
          }),
        }

        const tier = await getMembershipTier(mockSupabase, 'ws-123')
        expect(tier).toBe('FORMAL')
      })

      it('returns FORMAL when Threads is verified even without business verification', async () => {
        const mockSupabase = {
          rpc: vi.fn().mockResolvedValue({ data: 'PENDING_REVIEW', error: null }),
          from: vi.fn((table: string) => {
            if (table === 'channel_connections') {
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                in: vi.fn().mockResolvedValue({
                  data: [{ channel: 'threads', status: 'verified', account_label: '@my_threads' }],
                  error: null,
                }),
              }
            }
            if (table === 'workspace_credit_states') {
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { purchased_credits: 0, commercial_state: 'TRIAL_ACTIVE' },
                  error: null,
                }),
              }
            }
            return { select: vi.fn().mockReturnThis() }
          }),
        }

        const tier = await getMembershipTier(mockSupabase, 'ws-123')
        expect(tier).toBe('FORMAL')
      })

      it('returns FORMAL when purchased_credits > 0 even without connected channels or business verification', async () => {
        const mockSupabase = {
          rpc: vi.fn().mockResolvedValue({ data: 'TRIAL', error: null }),
          from: vi.fn((table: string) => {
            if (table === 'channel_connections') {
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                in: vi.fn().mockResolvedValue({ data: [], error: null }),
              }
            }
            if (table === 'workspace_credit_states') {
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { purchased_credits: 500, commercial_state: 'TRIAL_ACTIVE' },
                  error: null,
                }),
              }
            }
            return { select: vi.fn().mockReturnThis() }
          }),
        }

        const tier = await getMembershipTier(mockSupabase, 'ws-123')
        expect(tier).toBe('FORMAL')
      })

      it('returns FORMAL when commercial_state is ACTIVE', async () => {
        const mockSupabase = {
          rpc: vi.fn().mockResolvedValue({ data: 'TRIAL', error: null }),
          from: vi.fn((table: string) => {
            if (table === 'channel_connections') {
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                in: vi.fn().mockResolvedValue({ data: [], error: null }),
              }
            }
            if (table === 'workspace_credit_states') {
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { purchased_credits: 0, commercial_state: 'ACTIVE' },
                  error: null,
                }),
              }
            }
            return { select: vi.fn().mockReturnThis() }
          }),
        }

        const tier = await getMembershipTier(mockSupabase, 'ws-123')
        expect(tier).toBe('FORMAL')
      })

      it('returns TRIAL when unverified, no channels connected, and no payments', async () => {
        const mockSupabase = {
          rpc: vi.fn().mockResolvedValue({ data: 'TRIAL', error: null }),
          from: vi.fn((table: string) => {
            if (table === 'channel_connections') {
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                in: vi.fn().mockResolvedValue({ data: [], error: null }),
              }
            }
            if (table === 'workspace_credit_states') {
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { purchased_credits: 0, commercial_state: 'TRIAL_ACTIVE' },
                  error: null,
                }),
              }
            }
            return { select: vi.fn().mockReturnThis() }
          }),
        }

        const tier = await getMembershipTier(mockSupabase, 'ws-123')
        expect(tier).toBe('TRIAL')
      })
    })
  })
})
