import { describe, it, expect, vi } from 'vitest';
import {
  hashState,
  createOAuthTransaction,
  consumeOAuthTransaction,
  assertNoCrossWorkspaceBinding
} from '@/lib/channels/oauth-transaction-manager';
import {
  evaluateTokenHealth,
  disconnectChannelSafe
} from '@/lib/channels/token-lifecycle-manager';

describe('SNS Channel Authorization V1 Suite (ANI-601 ~ ANI-629)', () => {
  describe('ANI-625: OAuth Single-Use Transaction & Account Binding Security', () => {
    it('동일 state를 재사용(Replay)하려는 공격은 차단되어야 한다', async () => {
      let consumed = false;
      const mockSupabase: any = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation(() => ({
              maybeSingle: vi.fn().mockImplementation(() => {
                if (consumed) {
                  return Promise.resolve({
                    data: {
                      id: 'tx-1',
                      workspace_id: 'ws-1',
                      user_id: 'u-1',
                      expires_at: new Date(Date.now() + 600000).toISOString(),
                      consumed_at: new Date().toISOString() // Already consumed!
                    },
                    error: null
                  });
                }
                return Promise.resolve({
                  data: {
                    id: 'tx-1',
                    workspace_id: 'ws-1',
                    user_id: 'u-1',
                    expires_at: new Date(Date.now() + 600000).toISOString(),
                    consumed_at: null
                  },
                  error: null
                });
              })
            }))
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation(() => {
              consumed = true;
              return Promise.resolve({ error: null });
            })
          })
        })
      };

      // 1st consumption: should succeed
      const first = await consumeOAuthTransaction(mockSupabase, 'raw-state-token', 'ws-1', 'u-1');
      expect(first.consumedAt).toBeDefined();

      // 2nd consumption (Replay): must throw Replay Attack error
      await expect(
        consumeOAuthTransaction(mockSupabase, 'raw-state-token', 'ws-1', 'u-1')
      ).rejects.toThrow(/이미 사용된 일회용 OAuth 상태값입니다/);
    });

    it('만료된 OAuth 트랜잭션은 소비를 거부해야 한다', async () => {
      const mockSupabase: any = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'tx-expired',
                  workspace_id: 'ws-1',
                  user_id: 'u-1',
                  expires_at: new Date(Date.now() - 1000).toISOString(), // Expired
                  consumed_at: null
                },
                error: null
              })
            })
          })
        })
      };

      await expect(
        consumeOAuthTransaction(mockSupabase, 'state-expired', 'ws-1', 'u-1')
      ).rejects.toThrow(/OAuth 트랜잭션 유효 시간.*만료되었습니다/);
    });

    it('타 테넌트(Workspace B)가 Workspace A의 트랜잭션을 가로채려 하면 차단해야 한다', async () => {
      const mockSupabase: any = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'tx-ws-a',
                  workspace_id: 'workspace-a',
                  user_id: 'user-a',
                  expires_at: new Date(Date.now() + 600000).toISOString(),
                  consumed_at: null
                },
                error: null
              })
            })
          })
        })
      };

      await expect(
        consumeOAuthTransaction(mockSupabase, 'valid-state', 'workspace-b', 'user-b')
      ).rejects.toThrow(/Cross-Tenant 침범 차단/);
    });

    it('동일 SNS 계정이 이미 타 매장에 연결되어 있으면 중복 바인딩을 차단해야 한다', async () => {
      const mockSupabase: any = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                neq: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        workspace_id: 'other-workspace',
                        account_label: 'my_official_shop'
                      },
                      error: null
                    })
                  })
                })
              })
            })
          })
        })
      };

      await expect(
        assertNoCrossWorkspaceBinding(mockSupabase, 'INSTAGRAM', 'ig-account-999', 'current-workspace')
      ).rejects.toThrow(/이미 다른 매장\(워크스페이스\)에 연결되어 있습니다/);
    });
  });

  describe('ANI-626: Meta Token Lifecycle & Safe Disconnect Propagation', () => {
    it('토큰 만료까지 5일 남았을 때 EXPIRING_SOON 상태를 반환해야 한다', () => {
      const fiveDaysLater = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
      const evalResult = evaluateTokenHealth({
        status: 'connected',
        token_vault_ref: 'vault:meta:token-1',
        token_expires_at: fiveDaysLater
      });

      expect(evalResult.status).toBe('EXPIRING_SOON');
      expect(evalResult.canPublish).toBe(true);
      expect(evalResult.daysRemaining).toBe(5);
    });

    it('토큰 만료일이 지난 경우 TOKEN_EXPIRED 상태를 반환하고 발행을 차단해야 한다', () => {
      const pastDate = new Date(Date.now() - 1000).toISOString();
      const evalResult = evaluateTokenHealth({
        status: 'connected',
        token_vault_ref: 'vault:meta:token-1',
        token_expires_at: pastDate
      });

      expect(evalResult.status).toBe('TOKEN_EXPIRED');
      expect(evalResult.canPublish).toBe(false);
    });

    it('채널 연결 해제(Disconnect) 시 대기 중인 예약 콘텐츠를 원자적으로 취소해야 한다', async () => {
      const mockSupabase: any = {
        from: vi.fn((table: string) => {
          if (table === 'channel_connections') {
            return {
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ error: null })
                })
              })
            };
          }
          if (table === 'content_items') {
            return {
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    in: vi.fn().mockReturnValue({
                      select: vi.fn().mockResolvedValue({
                        data: [{ id: 'item-1' }, { id: 'item-2' }],
                        error: null
                      })
                    })
                  })
                })
              })
            };
          }
          if (table === 'channel_consents') {
            return {
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ error: null })
                })
              })
            };
          }
          if (table === 'audit_events') {
            return {
              insert: vi.fn().mockResolvedValue({ error: null })
            };
          }
          return {};
        })
      };

      const result = await disconnectChannelSafe(mockSupabase, 'ws-test', 'INSTAGRAM');
      expect(result.success).toBe(true);
      expect(result.actionsCancelled).toBe(2);
    });
  });
});
