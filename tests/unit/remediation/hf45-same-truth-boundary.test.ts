import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}));

import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  getPersistedChannelVerification,
} from '@/features/channels/dual-channel-verification';
import { getSoheeReadiness } from '@/features/sohee-ready/read-model';

describe('[HF-45][P0] SOHEE_READY Same-Truth Boundary & Dual-Client Isolation Test Suite', () => {
  const workspaceId = '30000000-0000-4000-8000-000000000001';
  const otherWorkspaceId = '90000000-0000-4000-8000-000000000099';
  const userId = '40000000-0000-4000-8000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Dual-Client Responsibility Isolation in getSoheeReadiness', () => {
    it('does NOT forward options.supabaseClient as adminClient to channel truth readers', async () => {
      // Mock user-session client that fails if called on meta_channel_credentials (simulating RLS rejection)
      const mockUserClient = {
        from: vi.fn((table: string) => {
          if (table === 'meta_channel_credentials') {
            throw new Error('RLS_VIOLATION: user-session client must NEVER query meta_channel_credentials directly!');
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }),
      };

      // Mock admin client provided explicitly for test injection
      const mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === 'meta_channel_credentials') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'cred-1',
                  workspace_id: workspaceId,
                  provider: 'instagram',
                  status: 'active',
                  token_expires_at: new Date(Date.now() + 86400000 * 30).toISOString(),
                  granted_scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
                  channel_connections: { external_account_id: 'ig-123', account_label: 'test_ig' },
                },
                error: null,
              }),
            };
          }
          if (table === 'channel_verification_runs') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              in: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'run-1',
                  status: 'VERIFIED',
                  created_at: new Date().toISOString(),
                },
                error: null,
              }),
            };
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }),
      };

      // When supabaseClient is passed, getSoheeReadiness should NOT query meta_channel_credentials with user client
      const readiness = await getSoheeReadiness(workspaceId, {
        supabaseClient: mockUserClient as any,
        adminClient: mockAdminClient as any,
      });

      expect(readiness).toBeDefined();
      expect(mockUserClient.from).not.toHaveBeenCalledWith('meta_channel_credentials');
    });
  });

  describe('2. getPersistedChannelVerification Fail-Closed Truth Behavior', () => {
    it('returns NOT_CONNECTED when credentials row does not exist', async () => {
      const mockAdminClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      };

      const result = await getPersistedChannelVerification(workspaceId, 'instagram', {
        adminClient: mockAdminClient as any,
      });

      expect(result.status).toBe('NOT_CONNECTED');
      expect(result.verified).toBe(false);
      expect(result.blockerMessage).toContain('NOT_CONNECTED');
    });

    it('returns UNKNOWN fail-closed when database query errors occur (no false NOT_CONNECTED masking)', async () => {
      const mockAdminClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '42P01', message: 'relation "meta_channel_credentials" does not exist' },
          }),
        }),
      };

      const result = await getPersistedChannelVerification(workspaceId, 'instagram', {
        adminClient: mockAdminClient as any,
      });

      expect(result.status).toBe('UNKNOWN');
      expect(result.verified).toBe(false);
      expect(result.blockerMessage).toContain('데이터베이스 오류가 발생했습니다');
    });

    it('returns READY_DEGRADED when token is expired or less than 24h validity', async () => {
      const mockAdminClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: 'cred-1',
              workspace_id: workspaceId,
              provider: 'instagram',
              token_expires_at: new Date(Date.now() + 3600000).toISOString(), // Only 1h remaining (< 24h)
              status: 'active',
              granted_scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
              channel_connections: { external_account_id: 'ig-123', account_label: 'test_ig' },
            },
            error: null,
          }),
        }),
      };

      const result = await getPersistedChannelVerification(workspaceId, 'instagram', {
        adminClient: mockAdminClient as any,
      });

      expect(result.status).toBe('READY_DEGRADED');
      expect(result.verified).toBe(false);
      expect(result.blockerMessage).toContain('READY_DEGRADED');
    });

    it('returns SCOPE_INSUFFICIENT when essential publishing scopes are missing', async () => {
      const mockAdminClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: 'cred-1',
              workspace_id: workspaceId,
              provider: 'instagram',
              token_expires_at: new Date(Date.now() + 86400000 * 30).toISOString(),
              status: 'active',
              granted_scopes: ['instagram_business_basic'], // Missing publishing scope!
              channel_connections: { external_account_id: 'ig-123', account_label: 'test_ig' },
            },
            error: null,
          }),
        }),
      };

      const result = await getPersistedChannelVerification(workspaceId, 'instagram', {
        adminClient: mockAdminClient as any,
      });

      expect(result.status).toBe('SCOPE_INSUFFICIENT');
      expect(result.verified).toBe(false);
      expect(result.blockerMessage).toContain('SCOPE_INSUFFICIENT');
    });

    it('returns READY_DEGRADED when verification run is stale (> 7 days)', async () => {
      const staleDate = new Date(Date.now() - 8 * 86400000).toISOString(); // 8 days old
      const mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === 'meta_channel_credentials') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'cred-1',
                  workspace_id: workspaceId,
                  provider: 'instagram',
                  token_expires_at: new Date(Date.now() + 86400000 * 30).toISOString(),
                  status: 'active',
                  granted_scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
                  channel_connections: { external_account_id: 'ig-123', account_label: 'test_ig' },
                },
                error: null,
              }),
            };
          }
          if (table === 'channel_verification_runs') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              in: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'run-stale',
                  status: 'VERIFIED',
                  created_at: staleDate,
                },
                error: null,
              }),
            };
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }),
      };

      const result = await getPersistedChannelVerification(workspaceId, 'instagram', {
        adminClient: mockAdminClient as any,
      });

      expect(result.status).toBe('READY_DEGRADED');
      expect(result.verified).toBe(false);
      expect(result.blockerMessage).toContain('최근 7일');
    });

    it('returns VERIFIED when all 5 capability points pass with fresh verification run', async () => {
      const freshDate = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
      const mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === 'meta_channel_credentials') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'cred-1',
                  workspace_id: workspaceId,
                  provider: 'instagram',
                  token_expires_at: new Date(Date.now() + 86400000 * 30).toISOString(),
                  status: 'active',
                  granted_scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
                  channel_connections: { external_account_id: 'ig-123', account_label: 'test_ig' },
                },
                error: null,
              }),
            };
          }
          if (table === 'channel_verification_runs') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              in: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'run-fresh-1',
                  status: 'VERIFIED',
                  created_at: freshDate,
                },
                error: null,
              }),
            };
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }),
      };

      const result = await getPersistedChannelVerification(workspaceId, 'instagram', {
        adminClient: mockAdminClient as any,
      });

      expect(result.status).toBe('VERIFIED');
      expect(result.verified).toBe(true);
      expect(result.evidence).toBeDefined();
    });
  });

  describe('3. Cross-Tenant Protection in Route Endpoints', () => {
    it('denies access (403) when an authenticated user attempts to query another workspace', async () => {
      const { GET: getSoheeReady } = await import('@/app/api/sohee-ready/route');

      // User is only a member of workspaceId, NOT otherWorkspaceId
      const mockUserClient = {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }),
        },
        from: vi.fn((table: string) => {
          if (table === 'workspace_members') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn((col: string, val: string) => ({
                eq: vi.fn((col2: string, val2: string) => ({
                  limit: vi.fn().mockReturnThis(),
                  maybeSingle: vi.fn().mockResolvedValue({
                    // If requested workspace is otherWorkspaceId, return null (unauthorized)
                    data: (val === otherWorkspaceId || val2 === otherWorkspaceId) ? null : { workspace_id: workspaceId },
                    error: null,
                  }),
                })),
              })),
            };
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }),
      };

      vi.mocked(createServerSupabaseClient).mockResolvedValue(mockUserClient as any);

      // Create request targeting unauthorized otherWorkspaceId
      const req = {
        nextUrl: new URL(`http://localhost/api/sohee-ready?workspace_id=${otherWorkspaceId}`),
      };

      const res = await getSoheeReady(req as any);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toContain('CROSS_TENANT_ACCESS_DENIED');
    });
  });
});
