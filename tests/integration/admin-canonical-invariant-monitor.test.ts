import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CanonicalInvariantMonitor } from '@/features/canonical-monitor/canonical-invariant-monitor'
import { getControlTowerReadModel } from '@/features/operator-control-tower/control-tower-repository'

let mockDb: Record<string, any[]> = {}
let mockDbThrowError = false

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => {
    if (mockDbThrowError) {
      throw new Error('Database connection terminated abnormally')
    }

    return {
      from: vi.fn((tableName: string) => {
        mockDb[tableName] = mockDb[tableName] || []

        return {
          select: vi.fn((_cols?: string, options?: any) => {
            if (options?.head && options?.count === 'exact') {
              return Promise.resolve({ count: mockDb[tableName]?.length || 0, error: null })
            }

            return {
              eq: vi.fn((col: string, val: any) => ({
                limit: vi.fn(async () => {
                  const rows = mockDb[tableName]?.filter(r => r[col] === val) || []
                  return { data: rows, error: null }
                }),
                eq: vi.fn((col2: string, val2: any) => ({
                  limit: vi.fn(async () => {
                    const rows = mockDb[tableName]?.filter(r => r[col] === val && r[col2] === val2) || []
                    return { data: rows, error: null }
                  }),
                })),
              })),
              limit: vi.fn(async () => ({ data: mockDb[tableName] || [], error: null })),
              then: (resolve: any) => resolve({ data: mockDb[tableName] || [], error: null }),
            }
          }),
        }
      }),
    }
  }),
}))

describe('Wave 5: Admin Canonical Invariant Monitor (ANI-1031, ANI-1032)', () => {
  beforeEach(() => {
    mockDbThrowError = false
    mockDb = {
      workspaces: [{ id: 'ws-1' }, { id: 'ws-2' }],
      external_action_attempts: [],
      channel_connections: [],
      approvals: [],
      credit_ledger_entries: [],
      ai_usage_events: [],
    }
    vi.clearAllMocks()
  })

  describe('1. Canonical Invariant Monitor Rule Evaluation', () => {
    it('detects PROVIDER_ACTION_FAILED (P0) when failed attempts exist', async () => {
      mockDb.external_action_attempts.push({
        id: 'att-fail-1',
        status: 'failed',
        error_code: 'PROVIDER_HTTP_500',
        error_message: 'Internal server error from Graph API',
      })

      const result = await CanonicalInvariantMonitor.evaluateAll()

      expect(result.hasActiveP0orP1).toBe(true)
      const violation = result.violations.find(v => v.invariant === 'PROVIDER_ACTION_FAILED')
      expect(violation).toBeDefined()
      expect(violation?.severity).toBe('P0')
      expect(violation?.domain).toBe('PROVIDER')
      expect(violation?.count).toBe(1)
    })

    it('detects WEBHOOK_FALSE_GREEN (P0) when channel connection has unproven webhook', async () => {
      mockDb.channel_connections.push({
        id: 'conn-ig-1',
        channel: 'instagram',
        status: 'connected',
        webhook_status: 'pending',
        last_webhook_at: null,
      })

      const result = await CanonicalInvariantMonitor.evaluateAll()

      expect(result.hasActiveP0orP1).toBe(true)
      const violation = result.violations.find(v => v.invariant === 'WEBHOOK_FALSE_GREEN')
      expect(violation).toBeDefined()
      expect(violation?.severity).toBe('P0')
      expect(violation?.domain).toBe('CHANNEL')
    })

    it('always enforces META_TEST_ROLE_ONLY_PUBLIC_COPY (P0) governance invariant while app review is unsubmitted', async () => {
      const result = await CanonicalInvariantMonitor.evaluateAll()

      expect(result.hasActiveP0orP1).toBe(true)
      const violation = result.violations.find(v => v.invariant === 'META_TEST_ROLE_ONLY_PUBLIC_COPY')
      expect(violation).toBeDefined()
      expect(violation?.severity).toBe('P0')
      expect(violation?.domain).toBe('GOVERNANCE')
    })

    it('detects APPROVAL_ORPHAN (P1) when approval fingerprint does not meet 64-char hex format', async () => {
      mockDb.approvals.push({
        id: 'app-invalid-1',
        version_id: 'ver-1',
        fingerprint: 'non_sha256_short_fp',
        status: 'approved',
      })

      const result = await CanonicalInvariantMonitor.evaluateAll()

      const violation = result.violations.find(v => v.invariant === 'APPROVAL_ORPHAN')
      expect(violation).toBeDefined()
      expect(violation?.severity).toBe('P1')
      expect(violation?.domain).toBe('CONTENT')
    })

    it('fails closed with SCHEMA_INCOMPATIBLE (P0) when database throws exception', async () => {
      mockDbThrowError = true

      const result = await CanonicalInvariantMonitor.evaluateAll()

      expect(result.hasActiveP0orP1).toBe(true)
      const violation = result.violations.find(v => v.severity === 'P0')
      expect(violation).toBeDefined()
      expect(violation?.readModelStatus).toBe('ERROR')
    })
  })

  describe('2. Control Tower Read Model Integration (Zero False-Green)', () => {
    it('populates risk_rail with live invariant violations and prevents zero-risk claim', async () => {
      mockDb.external_action_attempts.push({
        id: 'att-fail-1',
        status: 'failed',
        error_code: 'PROVIDER_HTTP_500',
      })

      const readModel = await getControlTowerReadModel()

      expect(readModel.risk_rail.length).toBeGreaterThan(0)
      const p0Items = readModel.risk_rail.filter(r => r.severity === 'P0')
      expect(p0Items.length).toBeGreaterThan(0)
    })

    it('fails closed with P0 alert in risk_rail on database load failure instead of empty array', async () => {
      mockDbThrowError = true

      const readModel = await getControlTowerReadModel()

      expect(readModel.risk_rail.length).toBe(1)
      expect(readModel.risk_rail[0].severity).toBe('P0')
      expect(readModel.risk_rail[0].title).toContain('로드 장애 (Fail-Closed)')
    })
  })
})
