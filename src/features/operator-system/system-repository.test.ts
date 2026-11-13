import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { getNaverPostQueueSummary, listNaverPostDlqItems } from './system-repository'

describe('getNaverPostQueueSummary', () => {
  it('returns exact counts from naver_post_jobs table', async () => {
    const mockAdmin = {
      from: vi.fn((table: string) => {
        expect(table).toBe('naver_post_jobs')
        return {
          select: vi.fn(() => ({
            eq: vi.fn((col: string, val: any) => {
              if (col === 'status') {
                if (val === 'pending') return Promise.resolve({ count: 3, error: null })
                if (val === 'running') return Promise.resolve({ count: 2, error: null })
                if (val === 'failed') return Promise.resolve({ count: 4, error: null })
              }
              if (col === 'credit_reconcile_needed') {
                expect(val).toBe(true)
                return Promise.resolve({ count: 1, error: null })
              }
              return Promise.resolve({ count: 0, error: null })
            }),
          })),
        }
      }),
    }

    const result = await getNaverPostQueueSummary({ adminClient: mockAdmin })

    expect(result.error).toBeNull()
    expect(result.data).toEqual({
      pending: 3,
      running: 2,
      failed: 4,
      creditReconcileNeededCount: 1,
    })
  })

  it('falls back to data.length if count is not a number', async () => {
    const mockAdmin = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn((col: string, val: any) => {
            if (col === 'status' && val === 'running') {
              return Promise.resolve({ data: [{ id: '1' }], error: null })
            }
            return Promise.resolve({ data: [], error: null })
          }),
        })),
      })),
    }

    const result = await getNaverPostQueueSummary({ adminClient: mockAdmin })

    expect(result.error).toBeNull()
    expect(result.data).toEqual({
      pending: 0,
      running: 1,
      failed: 0,
      creditReconcileNeededCount: 0,
    })
  })

  it('fails safely with NAVER_QUEUE_READ_UNAVAILABLE if all queries error', async () => {
    const mockAdmin = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ error: new Error('DB connection failed') })),
        })),
      })),
    }

    const result = await getNaverPostQueueSummary({ adminClient: mockAdmin })

    expect(result.data).toBeNull()
    expect(result.error).toBe('NAVER_QUEUE_READ_UNAVAILABLE')
  })
})

describe('listNaverPostDlqItems', () => {
  it('queries naver_post_jobs where credit_reconcile_needed is true', async () => {
    const mockRows = [
      {
        id: '11000000-0000-4000-8000-000000000001',
        workspace_id: '22000000-0000-4000-8000-000000000001',
        request_key: '33000000-0000-4000-8000-000000000001',
        user_id: '44000000-0000-4000-8000-000000000001',
        status: 'failed',
        content_id: null,
        version_id: null,
        credit_reconcile_needed: true,
        created_at: '2026-10-14T01:00:00.000Z',
        updated_at: '2026-10-14T01:15:00.000Z',
      },
    ]

    const mockAdmin = {
      from: vi.fn((table: string) => {
        expect(table).toBe('naver_post_jobs')
        return {
          select: vi.fn(() => ({
            eq: vi.fn((col: string, val: any) => {
              expect(col).toBe('credit_reconcile_needed')
              expect(val).toBe(true)
              return {
                order: vi.fn((orderCol: string, opts: any) => {
                  expect(orderCol).toBe('updated_at')
                  expect(opts).toEqual({ ascending: false })
                  return {
                    limit: vi.fn((lim: number) => {
                      expect(lim).toBe(50)
                      return Promise.resolve({ data: mockRows, error: null })
                    }),
                  }
                }),
              }
            }),
          })),
        }
      }),
    }

    const result = await listNaverPostDlqItems({ adminClient: mockAdmin })

    expect(result.error).toBeNull()
    expect(result.data).toHaveLength(1)
    expect(result.data?.[0]).toEqual({
      id: '11000000-0000-4000-8000-000000000001',
      workspaceId: '22000000-0000-4000-8000-000000000001',
      requestKey: '33000000-0000-4000-8000-000000000001',
      userId: '44000000-0000-4000-8000-000000000001',
      status: 'failed',
      contentId: null,
      versionId: null,
      creditReconcileNeeded: true,
      createdAt: '2026-10-14T01:00:00.000Z',
      updatedAt: '2026-10-14T01:15:00.000Z',
    })
  })

  it('returns error when DB query fails', async () => {
    const mockAdmin = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve({ data: null, error: new Error('DB error') })),
            })),
          })),
        })),
      })),
    }

    const result = await listNaverPostDlqItems({ adminClient: mockAdmin })

    expect(result.data).toBeNull()
    expect(result.error).toBe('NAVER_DLQ_READ_UNAVAILABLE')
  })
})
