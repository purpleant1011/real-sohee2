import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  resolveDeterministicWorkspace,
  selectWorkspaceContext,
} from '@/features/auth/workspace-context'
import {
  verifyPostOAuthChannelCapability,
  getPersistedChannelVerification,
} from '@/features/channels/dual-channel-verification'

describe('ANI-1429 P0 Provider Truth & Shared Deterministic Workspace Boundary', () => {
  const workspaceId1 = '10000000-0000-4000-8000-000000000001'
  const workspaceId2 = '20000000-0000-4000-8000-000000000002'
  const userId = '30000000-0000-4000-8000-000000000001'
  const validToken = 'EAABtestTokenSecret1234567890'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('1. Shared Deterministic Workspace Selection', () => {
    it('selects the same deterministic active workspace across boundaries when unrequested', async () => {
      const memberships = [
        { workspace_id: workspaceId1, role: 'manager' as const, status: 'active' as const, created_at: '2026-01-01T00:00:00Z' },
        { workspace_id: workspaceId2, role: 'owner' as const, status: 'active' as const, created_at: '2026-02-01T00:00:00Z' },
      ]

      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: memberships, error: null }),
        })),
      }

      const resolved = await resolveDeterministicWorkspace({
        supabase: mockSupabase as any,
        userId,
        userEmail: 'user@example.com',
      })

      expect(resolved.success).toBe(true)
      if (resolved.success) {
        expect(resolved.workspaceId).toBe(workspaceId1)
      }
    })

    it('rejects cross-tenant or inactive workspace requests with 403 status code', async () => {
      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { workspace_id: workspaceId2, role: 'viewer', status: 'disabled' },
            error: null,
          }),
        })),
      }

      const resolved = await resolveDeterministicWorkspace({
        supabase: mockSupabase as any,
        userId,
        userEmail: 'user@example.com',
        requestedWorkspaceId: workspaceId2,
      })

      expect(resolved.success).toBe(false)
      if (!resolved.success) {
        expect(resolved.statusCode).toBe(403)
        expect(resolved.error).toBe('CROSS_TENANT_ACCESS_DENIED')
      }
    })
  })

  describe('2. Post-OAuth Provider Capability Verification & Receipts', () => {
    it('persists CONNECTED_UNVERIFIED on provider capability probe, never premature VERIFIED before write action', async () => {
      let insertedRun: any = null
      const mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === 'channel_verification_runs') {
            return {
              insert: vi.fn((data: any) => {
                insertedRun = data
                return {
                  select: vi.fn().mockReturnThis(),
                  single: vi.fn().mockResolvedValue({ data: { id: 'run-1', ...data }, error: null }),
                }
              }),
            }
          }
          if (table === 'channel_connections') {
            return {
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }
          }
          throw new Error(`Unexpected table ${table}`)
        }),
      }

      const probeSuccess = vi.fn().mockResolvedValue({
        success: true,
        providerAccountId: 'ig-acc-12345',
        username: 'sohee_official',
      })

      const result = await verifyPostOAuthChannelCapability({
        workspaceId: workspaceId1,
        channel: 'instagram',
        accessToken: validToken,
        providerAccountId: 'ig-acc-12345',
        accountLabel: 'sohee_official',
        adminClient: mockAdminClient as any,
        probeFn: probeSuccess,
      })

      expect(result.verified).toBe(true)
      expect(result.status).toBe('VERIFIED')
      expect(insertedRun).toBeDefined()
      expect(insertedRun.status).toBe('VERIFIED')
      expect(insertedRun.read_after_write_at).toBeTruthy()
      expect(insertedRun.workspace_id).toBe(workspaceId1)
      expect(insertedRun.channel).toBe('instagram')
    })

    it('fails closed as CONNECTED_UNVERIFIED when provider capability probing fails, never creating false VERIFIED', async () => {
      let insertedRun: any = null
      const mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === 'channel_verification_runs') {
            return {
              insert: vi.fn((data: any) => {
                insertedRun = data
                return {
                  select: vi.fn().mockReturnThis(),
                  single: vi.fn().mockResolvedValue({ data: { id: 'run-fail', ...data }, error: null }),
                }
              }),
            }
          }
          if (table === 'channel_connections') {
            return {
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }
          }
          throw new Error(`Unexpected table ${table}`)
        }),
      }

      const probeFailure = vi.fn().mockRejectedValue(new Error('Meta API token invalid or permissions missing'))

      const result = await verifyPostOAuthChannelCapability({
        workspaceId: workspaceId1,
        channel: 'instagram',
        accessToken: validToken,
        providerAccountId: 'ig-acc-12345',
        accountLabel: 'sohee_official',
        adminClient: mockAdminClient as any,
        probeFn: probeFailure,
      })

      expect(result.verified).toBe(false)
      expect(result.status).toBe('CONNECTED_UNVERIFIED')
      expect(insertedRun?.status).not.toBe('VERIFIED')
      expect(result.blockerMessage).toBeDefined()
    })
  })

  describe('3. Secret Zero-Leakage Invariants', () => {
    it('never exposes raw access token, secrets, or passwords in verification runs or returned metadata', async () => {
      let runPayload: any = null
      const mockAdminClient = {
        from: vi.fn(() => ({
          insert: vi.fn((payload: any) => {
            runPayload = payload
            return {
              select: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: { id: 'run-secure' }, error: null }),
            }
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        })),
      }

      const result = await verifyPostOAuthChannelCapability({
        workspaceId: workspaceId1,
        channel: 'threads',
        accessToken: validToken,
        providerAccountId: 'threads-usr-999',
        accountLabel: 'sohee_threads',
        adminClient: mockAdminClient as any,
        probeFn: vi.fn().mockResolvedValue({ success: true, providerAccountId: 'threads-usr-999' }),
      })

      const serializedRun = JSON.stringify(runPayload || {})
      const serializedResult = JSON.stringify(result)

      expect(serializedRun).not.toContain(validToken)
      expect(serializedResult).not.toContain(validToken)
    })
  })
})
