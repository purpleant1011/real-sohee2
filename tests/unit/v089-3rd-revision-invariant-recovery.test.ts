import { describe, it, expect, vi } from 'vitest';
import { checkKillSwitchPreflight } from '@/lib/safety/kill-switch-guard';
import { calculateEffectiveCapability } from '@/lib/channels/capability-engine';

describe('V0.8.9 3차 수정 검증 테스트 (ANI-573 ~ ANI-593)', () => {
  describe('ANI-581: Kill Switch Preflight Guard', () => {
    it('글로벌 킬스위치가 활성화되어 있으면 외부 발행을 즉시 차단해야 한다', async () => {
      const mockSupabase: any = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'ks-1',
                  scope: 'GLOBAL',
                  target_id: 'ALL',
                  reason: '긴급 시스템 점검',
                  is_active: true
                }
              ],
              error: null
            })
          })
        })
      };

      const result = await checkKillSwitchPreflight(mockSupabase, {
        workspaceId: 'ws-123',
        channel: 'INSTAGRAM'
      });

      expect(result.blocked).toBe(true);
      expect(result.scope).toBe('GLOBAL');
      expect(result.reason).toContain('전사 시스템 긴급 킬스위치');
    });

    it('해당 채널 킬스위치가 켜져 있으면 해당 채널만 차단되어야 한다', async () => {
      const mockSupabase: any = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'ks-2',
                  scope: 'CHANNEL',
                  target_id: 'INSTAGRAM',
                  reason: 'Meta Graph API 점검',
                  is_active: true
                }
              ],
              error: null
            })
          })
        })
      };

      const igResult = await checkKillSwitchPreflight(mockSupabase, {
        workspaceId: 'ws-123',
        channel: 'INSTAGRAM'
      });
      expect(igResult.blocked).toBe(true);
      expect(igResult.scope).toBe('CHANNEL');

      const blogResult = await checkKillSwitchPreflight(mockSupabase, {
        workspaceId: 'ws-123',
        channel: 'NAVER_BLOG'
      });
      expect(blogResult.blocked).toBe(false);
    });
  });

  describe('ANI-583: Channel Effective Capability Engine', () => {
    it('당근마켓은 항상 CAPABILITY_PENDING 상태를 반환해야 한다', async () => {
      const mockSupabase: any = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null })
          })
        })
      };

      const cap = await calculateEffectiveCapability(mockSupabase, 'ws-123', 'DAANGN');
      expect(cap.status).toBe('CAPABILITY_PENDING');
      expect(cap.canPublish).toBe(false);
      expect(cap.requiresUserAction).toBe(true);
    });

    it('미연동 인스타그램은 REQUIRES_CONNECTION을 반환해야 한다', async () => {
      const mockSupabase: any = {
        from: vi.fn((table: string) => {
          if (table === 'kill_switches') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: [], error: null })
              })
            };
          }
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
                })
              })
            })
          };
        })
      };

      const cap = await calculateEffectiveCapability(mockSupabase, 'ws-123', 'INSTAGRAM');
      expect(cap.status).toBe('REQUIRES_CONNECTION');
      expect(cap.canPublish).toBe(false);
    });
  });

  describe('ANI-575 & ANI-576: Signup Invariants & Zero-UUID Prevention', () => {
    it('TRIAL_READY가 아닌 상태에서는 트라이얼 활성화를 거부해야 한다', async () => {
      const { finalizeSignupAndActivateTrial } = await import('@/features/auth/signup-state-machine');

      const mockSupabase: any = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  user_id: 'u-1',
                  state: 'BUSINESS_PENDING',
                  agreements_completed: false
                }
              })
            })
          })
        })
      };

      await expect(
        finalizeSignupAndActivateTrial(mockSupabase, 'u-1', 'google')
      ).rejects.toThrow(/BUSINESS_PENDING/);
    });

    it('필수 약관 동의가 완료되지 않은 경우 트라이얼 활성화를 거부해야 한다', async () => {
      const { finalizeSignupAndActivateTrial } = await import('@/features/auth/signup-state-machine');

      const mockSupabase: any = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  user_id: 'u-1',
                  state: 'TRIAL_READY',
                  business_verified_at: new Date().toISOString(),
                  agreements_completed: false
                }
              })
            })
          })
        })
      };

      await expect(
        finalizeSignupAndActivateTrial(mockSupabase, 'u-1', 'google')
      ).rejects.toThrow(/필수 약관 및 채널 위임 동의가 완료되지 않아/);
    });
  });

  describe('ANI-591: UX Truth Consistency (Free Taste 50 Energy Standard)', () => {
    it('Credit Economy 플랜 설정의 기본 무료 체험이 50 Energy (5,000 SC)여야 한다', async () => {
      const { PLAN_CONFIGS } = await import('@/features/marketing-agent/engine/credit-economy');
      expect(PLAN_CONFIGS.FREE_TASTE.weeklyCapacitySC).toBe(5000);
      expect(PLAN_CONFIGS.FREE_TASTE.name).toContain('50 Energy');
    });
  });
});
