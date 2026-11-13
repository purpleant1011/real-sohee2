import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WorkspaceContext } from '@/features/auth/workspace-context'
import { verifyPostOAuthChannelCapability } from '@/features/channels/dual-channel-verification'

describe('ANI-1429 Fix Round 1: Persistence Truth & Backward-Compatible WorkspaceContext', () => {
  const workspaceId1 = '10000000-0000-4000-8000-000000000001'
  const validToken = 'EAABtestTokenSecret1234567890'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('1. WorkspaceContext backward compatibility', () => {
    it('accepts { workspaceId, role } without status in WorkspaceContext type', () => {
      // Consumers mock { workspaceId, role } without status
      const mockContext: WorkspaceContext = {
        workspaceId: workspaceId1,
        role: 'owner',
      }
      expect(mockContext.workspaceId).toBe(workspaceId1)
      expect(mockContext.role).toBe('owner')
      expect(mockContext.status).toBeUndefined()
    })
  })

  describe('2. Canonical channel_verification_runs schema compliance', () => {
    it('writes only canonical columns (including NOT NULL verification_code) and NO metadata column', async () => {
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

      const result = await verifyPostOAuthChannelCapability({
        workspaceId: workspaceId1,
        channel: 'instagram',
        accessToken: validToken,
        providerAccountId: 'ig-acc-12345',
        accountLabel: 'sohee_official',
        adminClient: mockAdminClient as any,
        probeFn: vi.fn().mockResolvedValue({ success: true, providerAccountId: 'ig-acc-12345' }),
      })

      expect(result.verified).toBe(true)
      expect(result.status).toBe('VERIFIED')

      // Canonical schema checks
      expect(insertedRun).toBeDefined()
      expect(insertedRun.verification_code).toBeDefined()
      expect(typeof insertedRun.verification_code).toBe('string')
      expect(insertedRun.verification_code.length).toBeGreaterThan(0)
      expect(insertedRun.status).toBe('VERIFIED')
      expect(insertedRun.read_after_write_at).toBeTruthy()

      // Must NOT contain nonexistent metadata column
      expect(insertedRun.metadata).toBeUndefined()
    })
  })

  describe('3. Critical truth rule: Fail-closed on DB persistence failure', () => {
    it('returns CONNECTED_UNVERIFIED when channel_verification_runs insert returns DB error', async () => {
      const mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === 'channel_verification_runs') {
            return {
              insert: vi.fn(() => ({
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: '23502', message: 'null value in column verification_code violates not-null constraint' },
                }),
              })),
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

      const result = await verifyPostOAuthChannelCapability({
        workspaceId: workspaceId1,
        channel: 'instagram',
        accessToken: validToken,
        providerAccountId: 'ig-acc-12345',
        accountLabel: 'sohee_official',
        adminClient: mockAdminClient as any,
        probeFn: vi.fn().mockResolvedValue({ success: true, providerAccountId: 'ig-acc-12345' }),
      })

      expect(result.verified).toBe(false)
      expect(result.status).toBe('CONNECTED_UNVERIFIED')
      expect(result.blockerMessage).toContain('실측 검증 영수증')
    })

    it('returns CONNECTED_UNVERIFIED when channel_connections update returns DB error', async () => {
      const mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === 'channel_verification_runs') {
            return {
              insert: vi.fn((data: any) => ({
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({ data: { id: 'run-1', ...data }, error: null }),
              })),
            }
          }
          if (table === 'channel_connections') {
            return {
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: '42P01', message: 'relation channel_connections does not exist' },
                }),
              }),
            }
          }
          throw new Error(`Unexpected table ${table}`)
        }),
      }

      const result = await verifyPostOAuthChannelCapability({
        workspaceId: workspaceId1,
        channel: 'instagram',
        accessToken: validToken,
        providerAccountId: 'ig-acc-12345',
        accountLabel: 'sohee_official',
        adminClient: mockAdminClient as any,
        probeFn: vi.fn().mockResolvedValue({ success: true, providerAccountId: 'ig-acc-12345' }),
      })

      expect(result.verified).toBe(false)
      expect(result.status).toBe('CONNECTED_UNVERIFIED')
      expect(result.blockerMessage).toContain('채널 상태')
    })

    it('returns CONNECTED_UNVERIFIED when DB operations throw an unexpected exception', async () => {
      const mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === 'channel_verification_runs') {
            return {
              insert: vi.fn(() => {
                throw new Error('Database connection pool exhausted')
              }),
            }
          }
          throw new Error(`Unexpected table ${table}`)
        }),
      }

      const result = await verifyPostOAuthChannelCapability({
        workspaceId: workspaceId1,
        channel: 'instagram',
        accessToken: validToken,
        providerAccountId: 'ig-acc-12345',
        accountLabel: 'sohee_official',
        adminClient: mockAdminClient as any,
        probeFn: vi.fn().mockResolvedValue({ success: true, providerAccountId: 'ig-acc-12345' }),
      })

      expect(result.verified).toBe(false)
      expect(result.status).toBe('CONNECTED_UNVERIFIED')
      expect(result.blockerMessage).toBeDefined()
    })
  })
})
