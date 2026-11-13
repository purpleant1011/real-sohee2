import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reconcileMetaVerifications } from '@/lib/external-actions/reconcile-meta-verification'

const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockEq = vi.fn()
const mockMaybeSingle = vi.fn()
const mockSingle = vi.fn()

let mockVerificationRuns: any[] = []
let mockRequests: any[] = []

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => {
      const filters: Record<string, any> = {}
      const builder = {
        select: (...args: any[]) => {
          mockSelect(table, ...args)
          return builder
        },
        eq: (field: string, val: any) => {
          mockEq(table, field, val)
          filters[field] = val
          return builder
        },
        maybeSingle: () => {
          if (table === 'external_action_requests' && filters.id) {
            const found = mockRequests.find((r) => r.id === filters.id)
            return Promise.resolve({ data: found || null, error: null })
          }
          return Promise.resolve({ data: null, error: null })
        },
        single: () => Promise.resolve({ data: { id: 'mock-id' }, error: null }),
        insert: (data: any) => {
          mockInsert(table, data)
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: data.id || 'new-id' }, error: null }),
            }),
          }
        },
        update: (data: any) => {
          mockUpdate(table, data)
          return {
            eq: () => Promise.resolve({ data, error: null }),
          }
        },
        then: (resolve: any, reject: any) => {
          if (table === 'channel_verification_runs') {
            let data = [...mockVerificationRuns]
            if (filters.status) data = data.filter((r) => r.status === filters.status)
            if (filters.workspace_id) data = data.filter((r) => r.workspace_id === filters.workspace_id)
            return Promise.resolve({ data, error: null }).then(resolve, reject)
          }
          return Promise.resolve({ data: null, error: null }).then(resolve, reject)
        },
      }
      return builder
    },
  }),
}))

vi.mock('@/features/channels/credential-repository', () => ({
  loadChannelCredentialByChannel: vi.fn().mockResolvedValue({
    accessToken: 'valid-reconcile-access-token',
    externalAccountId: 'act_reconcile_123',
    grantedScopes: ['instagram_basic'],
  }),
}))

describe('Meta Verification Reconciliation (ANI-997)', () => {
  const workspaceId = '10000000-0000-4000-8000-000000000001'

  beforeEach(() => {
    vi.clearAllMocks()
    mockVerificationRuns = []
    mockRequests = []
  })

  it('recovers orphan row when provider GET confirms external publication', async () => {
    // 1 orphan run with an action_request_id that does NOT exist in external_action_requests
    mockVerificationRuns = [
      {
        id: 'run-orphan-001',
        workspace_id: workspaceId,
        channel: 'instagram',
        verification_code: 'CODE001',
        status: 'VERIFIED',
        action_request_id: 'orphan-req-001',
        external_post_id: 'ig_post_001',
        external_permalink: 'https://instagram.com/p/001',
        created_at: new Date().toISOString(),
      },
    ]
    mockRequests = [] // No existing request!

    const mockReadback = vi.fn().mockResolvedValue('https://instagram.com/p/001')

    const summary = await reconcileMetaVerifications(workspaceId, mockReadback)

    expect(summary.totalOrphansFound).toBe(1)
    expect(summary.reconciledCount).toBe(1)
    expect(summary.integrityIncidentCount).toBe(0)
    expect(summary.items[0].disposition).toBe('RECONCILED')

    // Readback was performed via GET
    expect(mockReadback).toHaveBeenCalledWith({
      channel: 'instagram',
      providerPostId: 'ig_post_001',
      accessToken: 'valid-reconcile-access-token',
    })

    // Backfilled request, attempt, and receipt were inserted
    expect(mockInsert).toHaveBeenCalledWith('external_action_requests', expect.objectContaining({
      id: 'orphan-req-001',
      status: 'succeeded',
      channel: 'instagram',
    }))

    expect(mockInsert).toHaveBeenCalledWith('external_action_attempts', expect.objectContaining({
      action_request_id: 'orphan-req-001',
      status: 'succeeded',
      provider_reference: 'ig_post_001',
    }))

    expect(mockInsert).toHaveBeenCalledWith('external_action_receipts', expect.objectContaining({
      action_request_id: 'orphan-req-001',
      receipt_kind: 'observed_result',
      result_url: 'https://instagram.com/p/001',
    }))
  })

  it('preserves DATA_INTEGRITY_ERROR and NEVER republishes when external object cannot be found', async () => {
    mockVerificationRuns = [
      {
        id: 'run-orphan-002',
        workspace_id: workspaceId,
        channel: 'threads',
        verification_code: 'CODE002',
        status: 'VERIFIED',
        action_request_id: 'orphan-req-002',
        external_post_id: 'th_post_404',
        external_permalink: 'https://threads.com/@user/post/404',
        created_at: new Date().toISOString(),
      },
    ]
    mockRequests = []

    // Readback fails / returns null (404 on Meta Graph API)
    const mockReadback = vi.fn().mockResolvedValue(null)

    const summary = await reconcileMetaVerifications(workspaceId, mockReadback)

    expect(summary.totalOrphansFound).toBe(1)
    expect(summary.reconciledCount).toBe(0)
    expect(summary.integrityIncidentCount).toBe(1)
    expect(summary.items[0].disposition).toBe('DATA_INTEGRITY_ERROR')

    // Run was marked as FAILED with DATA_INTEGRITY_ERROR
    expect(mockUpdate).toHaveBeenCalledWith(
      'channel_verification_runs',
      expect.objectContaining({
        status: 'FAILED',
        error_message: expect.stringContaining('DATA_INTEGRITY_ERROR'),
      }),
    )

    // No inserts into external_action_* tables
    expect(mockInsert).not.toHaveBeenCalled()
  })
})
