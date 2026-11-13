import { describe, expect, it, vi, beforeEach } from 'vitest'

const cronSecret = 'a'.repeat(32)
let mockAdminClient: any = null
let mockQueueSend: any = null

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => mockAdminClient,
}))

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: async () => ({
    env: mockQueueSend ? { CONVERSATION_JOBS_QUEUE: { send: mockQueueSend } } : {},
  }),
}))

import { POST } from './route'

describe('POST /api/internal/channel-learning/sweep', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', cronSecret)
    mockQueueSend = vi.fn().mockResolvedValue(undefined)
    mockAdminClient = {
      from: vi.fn((table: string) => {
        if (table === 'knowledge_sources') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  is: vi.fn(() => ({
                    neq: vi.fn(() => ({
                      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: {
                          id: 'source-1',
                          workspace_id: 'ws-1',
                          lifecycle_revision: 1,
                          evidence_revision: 1,
                          status: 'active',
                        },
                        error: null,
                      }),
                    })),
                  })),
                })),
              })),
            })),
          }
        }
        if (table === 'learning_evidence_leases') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        verified_at: new Date(Date.now() - 20 * 3600000).toISOString(),
                        expires_at: new Date(Date.now() + 4 * 3600000).toISOString(),
                        evidence_revision: 1,
                      },
                      error: null,
                    }),
                  })),
                })),
              })),
            })),
          }
        }
        if (table === 'learning_jobs') {
          const createJobQueryChain = (): any => ({
            eq: vi.fn(() => createJobQueryChain()),
            lte: vi.fn(() => createJobQueryChain()),
            order: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
          })
          return {
            select: vi.fn(() => createJobQueryChain()),
          }
        }
        return {
          select: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }),
      rpc: vi.fn((fn: string) => {
        if (fn === 'list_due_learning_verifications') {
          return Promise.resolve({
            data: [
              {
                workspace_id: 'ws-1',
                source_id: 'src-1',
                source_revision: 1,
                evidence_revision: 1,
                provider_account_id: 'act-1',
                method: 'oauth',
                expires_at: new Date(Date.now() + 3600000).toISOString(),
              },
            ],
            error: null,
          })
        }
        if (fn === 'purge_expired_learning_payloads') {
          return Promise.resolve({ data: { purged_count: 5 }, error: null })
        }
        if (fn === 'create_learning_job_atomic') {
          return Promise.resolve({ data: [{ id: 'job-verified-1' }], error: null })
        }
        return Promise.resolve({ data: null, error: null })
      }),
    }
  })

  it('rejects unauthenticated requests with 404', async () => {
    const req = new Request('https://example.com/api/internal/channel-learning/sweep', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong-secret' },
    })
    const res = await POST(req)
    expect(res.status).toBe(404)
  })

  it('performs sweep via list_due_learning_verifications RPC and enqueues verify job', async () => {
    const req = new Request('https://example.com/api/internal/channel-learning/sweep', {
      method: 'POST',
      headers: { authorization: `Bearer ${cronSecret}` },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.verifiedEnqueued).toBe(1)
    expect(body.purgedCount).toBe(5)
    expect(mockQueueSend).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaVersion: 2,
        kind: 'knowledge_verify',
        workspaceId: 'ws-1',
      }),
    )
  })

  it('selects the 51st current due lease and ignores 50 historical stale leases', async () => {
    // 1 current due source whose active lease (revision 1) is due
    const currentDueSource = {
      id: 'current-due-src',
      workspace_id: 'ws-current',
      lifecycle_revision: 1,
      evidence_revision: 1,
    }

    // When list_due_learning_verifications runs, SQL joins current revision only
    mockAdminClient.rpc = vi.fn((fn: string) => {
      if (fn === 'list_due_learning_verifications') {
        // SQL JOIN guarantees only the current evidence revision is returned,
        // so the 50 stale revision 0 leases are never returned!
        return Promise.resolve({
          data: [
            {
              workspace_id: currentDueSource.workspace_id,
              source_id: currentDueSource.id,
              source_revision: currentDueSource.lifecycle_revision,
              evidence_revision: currentDueSource.evidence_revision,
              provider_account_id: 'meta-user-due',
              method: 'oauth',
              expires_at: new Date(Date.now() + 1800000).toISOString(),
            },
          ],
          error: null,
        })
      }
      if (fn === 'create_learning_job_atomic') {
        return Promise.resolve({ data: [{ id: 'job-verified-current' }], error: null })
      }
      if (fn === 'purge_expired_learning_payloads') {
        return Promise.resolve({ data: { purged_count: 0 }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })

    const req = new Request('https://example.com/api/internal/channel-learning/sweep', {
      method: 'POST',
      headers: { authorization: `Bearer ${cronSecret}` },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.verifiedEnqueued).toBe(1)
    expect(mockQueueSend).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-current',
      }),
    )
  })

  it('does not increment verified count and returns 503 when queue is unavailable and nothing succeeded', async () => {
    mockQueueSend = null // Queue unavailable
    mockAdminClient.rpc = vi.fn((fn: string) => {
      if (fn === 'list_due_learning_verifications') {
        return Promise.resolve({
          data: [
            {
              workspace_id: 'ws-1',
              source_id: 'src-1',
              source_revision: 1,
              evidence_revision: 1,
            },
          ],
          error: null,
        })
      }
      if (fn === 'purge_expired_learning_payloads') {
        return Promise.resolve({ data: null, error: { message: 'DB down' } })
      }
      if (fn === 'create_learning_job_atomic') {
        return Promise.resolve({ data: [{ id: 'job-1' }], error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })

    const req = new Request('https://example.com/api/internal/channel-learning/sweep', {
      method: 'POST',
      headers: { authorization: `Bearer ${cronSecret}` },
    })

    const res = await POST(req)
    const body = await res.json()
    expect(body.verifiedEnqueued).toBe(0) // Not falsely incremented!
    expect(body.ok).toBe(false)
    expect(body.failureReasons).toContain('QUEUE_UNAVAILABLE')
    expect(res.status).toBe(503) // Complete failure returns 503!
  })

  it('F3: sweep enqueues both queued deletion jobs and expired running deletion jobs', async () => {
    mockAdminClient.from = vi.fn((table: string) => {
      if (table === 'learning_jobs') {
        let isRunningQuery = false
        const chain: any = {
          eq: vi.fn((col: string, val: string) => {
            if (col === 'status' && val === 'running') isRunningQuery = true
            return chain
          }),
          lte: vi.fn(() => chain),
          order: vi.fn(() => ({
            limit: vi.fn().mockImplementation(async () => {
              if (isRunningQuery) {
                return {
                  data: [{ id: 'job-del-running-expired', workspace_id: 'ws-1' }],
                  error: null,
                }
              }
              return {
                data: [{ id: 'job-del-queued', workspace_id: 'ws-1' }],
                error: null,
              }
            }),
          })),
        }
        return { select: vi.fn(() => chain) }
      }
      return {
        select: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      }
    })

    const req = new Request('https://example.com/api/internal/channel-learning/sweep', {
      method: 'POST',
      headers: { authorization: `Bearer ${cronSecret}` },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deletedEnqueued).toBe(2)
    expect(mockQueueSend).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaVersion: 2,
        kind: 'knowledge_delete',
        jobId: 'job-del-queued',
      }),
    )
    expect(mockQueueSend).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaVersion: 2,
        kind: 'knowledge_delete',
        jobId: 'job-del-running-expired',
      }),
    )
  })
})
