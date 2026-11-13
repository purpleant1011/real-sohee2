import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getPersistedChannelVerification,
  evaluateDualChannelReadiness,
  normalizeInstagramScopes,
  normalizeThreadsScopes,
} from '@/features/channels/dual-channel-verification'

describe('HF-38: Meta Canonical Truth Boundary & Server-Only Credential Read (ANI-1387)', () => {
  const workspaceId = '10000000-0000-4000-8000-000000000001'
  const validFutureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  const expiredDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const freshVerificationDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() // 2 days ago (< 7d)
  const staleVerificationDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() // 10 days ago (> 7d)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('1. Server-Only Boundary & RLS Protection', () => {
    it('uses server-only admin client by default without requiring or leaking user session client', async () => {
      // Mock createAdminSupabaseClient
      const mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === 'meta_channel_credentials') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'cred-1',
                  provider: 'instagram',
                  granted_scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
                  token_expires_at: validFutureDate,
                  status: 'active',
                  channel_connections: {
                    id: 'conn-1',
                    external_account_id: 'ig-acc-1',
                    account_label: 'sohee_official',
                  },
                },
                error: null,
              }),
            }
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
                  read_after_write_at: freshVerificationDate,
                  created_at: freshVerificationDate,
                },
                error: null,
              }),
            }
          }
          throw new Error(`Unexpected table ${table}`)
        }),
      }

      // Call passing adminClient explicitly in options
      const result = await getPersistedChannelVerification(workspaceId, 'instagram', {
        adminClient: mockAdminClient,
      })

      expect(result.status).toBe('VERIFIED')
      expect(result.verified).toBe(true)
      expect(mockAdminClient.from).toHaveBeenCalledWith('meta_channel_credentials')
      expect(mockAdminClient.from).toHaveBeenCalledWith('channel_verification_runs')
    })

    it('never leaks raw access token or IV in returned evidence or logs', async () => {
      const mockAdminClient = {
        from: vi.fn((table: string) => ({
          select: vi.fn((cols: string) => {
            // Verify sensitive columns are never requested in the query
            expect(cols).not.toContain('encrypted_access_token')
            expect(cols).not.toContain('access_token_iv')
            return {
              eq: vi.fn().mockReturnThis(),
              in: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: table === 'meta_channel_credentials' ? {
                  id: 'cred-1',
                  provider: 'instagram',
                  granted_scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
                  token_expires_at: validFutureDate,
                  status: 'active',
                  channel_connections: {
                    id: 'conn-1',
                    external_account_id: 'ig-acc-1',
                    account_label: 'sohee_official',
                  },
                } : {
                  id: 'run-1',
                  status: 'VERIFIED',
                  read_after_write_at: freshVerificationDate,
                  created_at: freshVerificationDate,
                },
                error: null,
              }),
            }
          }),
        })),
      }

      const result = await getPersistedChannelVerification(workspaceId, 'instagram', {
        adminClient: mockAdminClient,
      })

      expect(result.status).toBe('VERIFIED')
      expect(result.evidence).toBeDefined()
      const ev = result.evidence as any
      expect(ev.encrypted_access_token).toBeUndefined()
      expect(ev.access_token_iv).toBeUndefined()
      expect(ev.accessToken).toBeUndefined()
    })
  })

  describe('2. Fail-Closed Error Handling (No Masking as NOT_CONNECTED)', () => {
    it('returns status UNKNOWN when database/RLS error occurs querying credentials', async () => {
      const mockAdminClient = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: {
              code: '42501',
              message: 'permission denied for table meta_channel_credentials',
            },
          }),
        })),
      }

      const result = await getPersistedChannelVerification(workspaceId, 'instagram', {
        adminClient: mockAdminClient,
      })

      // MUST NOT be NOT_CONNECTED!
      expect(result.status).toBe('UNKNOWN')
      expect(result.verified).toBe(false)
      expect(result.blockerMessage).toContain('데이터베이스 오류가 발생했습니다')
      expect(result.blockerMessage).toContain('permission denied')
    })

    it('returns status UNKNOWN when database error occurs querying verification runs', async () => {
      const mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === 'meta_channel_credentials') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'cred-1',
                  provider: 'instagram',
                  granted_scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
                  token_expires_at: validFutureDate,
                  status: 'active',
                  channel_connections: {
                    id: 'conn-1',
                    external_account_id: 'ig-acc-1',
                    account_label: 'sohee_official',
                  },
                },
                error: null,
              }),
            }
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: {
                code: '57014',
                message: 'canceling statement due to statement timeout',
              },
            }),
          }
        }),
      }

      const result = await getPersistedChannelVerification(workspaceId, 'instagram', {
        adminClient: mockAdminClient,
      })

      // MUST NOT be CONNECTED_UNVERIFIED or NOT_CONNECTED!
      expect(result.status).toBe('UNKNOWN')
      expect(result.verified).toBe(false)
      expect(result.blockerMessage).toContain('실측 검증 내역 조회 중 데이터베이스 오류가 발생했습니다')
    })

    it('returns status NOT_CONNECTED cleanly when credential row does NOT exist and error is null', async () => {
      const mockAdminClient = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: null,
          }),
        })),
      }

      const result = await getPersistedChannelVerification(workspaceId, 'instagram', {
        adminClient: mockAdminClient,
      })

      expect(result.status).toBe('NOT_CONNECTED')
      expect(result.verified).toBe(false)
      expect(result.blockerMessage).toContain('계정 연동 정보가 없습니다 (NOT_CONNECTED)')
    })
  })

  describe('3. Token Expiration, Stale Readback & Scope Insufficiency', () => {
    it('returns READY_DEGRADED when token has expired', async () => {
      const mockAdminClient = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: 'cred-1',
              provider: 'instagram',
              granted_scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
              token_expires_at: expiredDate,
              status: 'active',
            },
            error: null,
          }),
        })),
      }

      const result = await getPersistedChannelVerification(workspaceId, 'instagram', {
        adminClient: mockAdminClient,
      })

      expect(result.status).toBe('READY_DEGRADED')
      expect(result.verified).toBe(false)
      expect(result.blockerMessage).toContain('토큰 유효기간이 24시간 미만이거나 만료되었습니다')
    })

    it('returns READY_DEGRADED when verification run is stale (> 7 days)', async () => {
      const mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === 'meta_channel_credentials') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'cred-1',
                  provider: 'instagram',
                  granted_scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
                  token_expires_at: validFutureDate,
                  status: 'active',
                  channel_connections: { external_account_id: 'ig-1', account_label: 'store' },
                },
                error: null,
              }),
            }
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'run-old',
                status: 'VERIFIED',
                read_after_write_at: staleVerificationDate,
                created_at: staleVerificationDate,
              },
              error: null,
            }),
          }
        }),
      }

      const result = await getPersistedChannelVerification(workspaceId, 'instagram', {
        adminClient: mockAdminClient,
      })

      expect(result.status).toBe('READY_DEGRADED')
      expect(result.verified).toBe(false)
      expect(result.blockerMessage).toContain('최근 7일')
    })

    it('returns SCOPE_INSUFFICIENT when required publish scope is missing', async () => {
      const mockAdminClient = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: 'cred-1',
              provider: 'instagram',
              granted_scopes: ['instagram_business_basic'], // Missing instagram_business_content_publish
              token_expires_at: validFutureDate,
              status: 'active',
            },
            error: null,
          }),
        })),
      }

      const result = await getPersistedChannelVerification(workspaceId, 'instagram', {
        adminClient: mockAdminClient,
      })

      expect(result.status).toBe('SCOPE_INSUFFICIENT')
      expect(result.verified).toBe(false)
      expect(result.blockerMessage).toContain('SCOPE_INSUFFICIENT')
    })
  })

  describe('4. Canonical Scope Normalization (IG Alias & Threads Truth)', () => {
    it('recognizes legacy instagram_basic & instagram_content_publish via normalization', async () => {
      const normalized = normalizeInstagramScopes(['instagram_basic', 'instagram_content_publish'])
      expect(normalized).toContain('instagram_business_basic')
      expect(normalized).toContain('instagram_business_content_publish')
      expect(normalized).toContain('instagram_basic')
      expect(normalized).toContain('instagram_content_publish')
    })

    it('normalizes Instagram scopes bidirectionally for all operational scopes', () => {
      const operational = [
        'instagram_manage_comments',
        'instagram_manage_messages',
        'instagram_manage_insights',
      ]
      const normalized = normalizeInstagramScopes(operational)
      expect(normalized).toContain('instagram_business_manage_comments')
      expect(normalized).toContain('instagram_business_manage_messages')
      expect(normalized).toContain('instagram_business_manage_insights')
    })

    it('normalizes Threads scopes cleanly', () => {
      const threads = normalizeThreadsScopes([
        'threads_basic ',
        'threads_content_publish',
        'threads_basic',
      ])
      expect(threads).toEqual(['threads_basic', 'threads_content_publish'])
    })

    it('evaluates legacy IG scopes as VERIFIED through getPersistedChannelVerification', async () => {
      const mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === 'meta_channel_credentials') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'cred-legacy',
                  provider: 'instagram',
                  granted_scopes: ['instagram_basic', 'instagram_content_publish'], // Legacy aliases
                  token_expires_at: validFutureDate,
                  status: 'active',
                  channel_connections: {
                    id: 'conn-1',
                    external_account_id: 'ig-legacy-1',
                    account_label: 'legacy_store',
                  },
                },
                error: null,
              }),
            }
          }
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
                read_after_write_at: freshVerificationDate,
                created_at: freshVerificationDate,
              },
              error: null,
            }),
          }
        }),
      }

      const result = await getPersistedChannelVerification(workspaceId, 'instagram', {
        adminClient: mockAdminClient,
      })

      expect(result.status).toBe('VERIFIED')
      expect(result.verified).toBe(true)
    })
  })

  describe('5. Cross-Tenant Workspace Isolation', () => {
    it('strictly queries credentials and verification runs by targeted workspaceId', async () => {
      const targetWorkspaceId = '20000000-0000-4000-8000-000000000002'
      const capturedWorkspaceIds: string[] = []

      const mockAdminClient = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn((col: string, val: string) => {
            if (col === 'workspace_id') {
              capturedWorkspaceIds.push(val)
            }
            return {
              eq: vi.fn().mockReturnThis(),
              in: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: null,
              }),
            }
          }),
        })),
      }

      await getPersistedChannelVerification(targetWorkspaceId, 'instagram', {
        adminClient: mockAdminClient,
      })

      expect(capturedWorkspaceIds.length).toBeGreaterThanOrEqual(1)
      for (const id of capturedWorkspaceIds) {
        expect(id).toBe(targetWorkspaceId)
      }
    })
  })

  describe('6. Dual-Channel Readiness Evaluation', () => {
    it('requires BOTH Instagram and Threads to be VERIFIED for dualVerified=true', () => {
      const igVerified = { status: 'VERIFIED' as const, verified: true }
      const thVerified = { status: 'VERIFIED' as const, verified: true }
      const igUnverified = { status: 'CONNECTED_UNVERIFIED' as const, verified: false, blockerMessage: 'IG unverified' }
      const thUnverified = { status: 'CONNECTED_UNVERIFIED' as const, verified: false, blockerMessage: 'TH unverified' }

      expect(evaluateDualChannelReadiness({ instagram: igVerified, threads: thVerified }).dualVerified).toBe(true)
      expect(evaluateDualChannelReadiness({ instagram: igVerified, threads: thUnverified }).dualVerified).toBe(false)
      expect(evaluateDualChannelReadiness({ instagram: igUnverified, threads: thVerified }).dualVerified).toBe(false)
      expect(evaluateDualChannelReadiness({ instagram: igUnverified, threads: thUnverified }).dualVerified).toBe(false)
    })
  })
})
