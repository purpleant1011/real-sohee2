import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireOperatorAnyScope: vi.fn(async () => ({ userId: '10000000-0000-4000-8000-000000000001' })),
  reconcileNaverPostJobs: vi.fn(async () => ({
    examined: 1,
    markedFailed: 0,
    completedFromSavedVersion: 0,
    released: 1,
    flagged: 0,
    errors: 0,
  })),
  createAdminSupabaseClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: {
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
            error: null,
          })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(async () => ({ error: null })),
      })),
    })),
  })),
}))

vi.mock('@/features/operator-auth/require-operator', () => ({
  requireOperatorAnyScope: mocks.requireOperatorAnyScope,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
}))

vi.mock('@/features/channel-studio/naver/reconcile-naver-post-jobs', () => ({
  reconcileNaverPostJobs: mocks.reconcileNaverPostJobs,
}))

import { POST } from './route'
import { OperatorAccessError } from '@/features/operator-auth/current-operator'

describe('POST /api/admin/system/naver-jobs/reconcile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects when operator does not have system.read permission', async () => {
    mocks.requireOperatorAnyScope.mockRejectedValueOnce(new OperatorAccessError('PERMISSION_DENIED'))

    const res = await POST(new Request('http://localhost/api/admin/system/naver-jobs/reconcile', { method: 'POST' }))
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toBe('접근 권한이 없습니다.')
  })

  it('rejects when MFA is required', async () => {
    mocks.requireOperatorAnyScope.mockRejectedValueOnce(new OperatorAccessError('MFA_REQUIRED'))

    const res = await POST(new Request('http://localhost/api/admin/system/naver-jobs/reconcile', { method: 'POST' }))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toContain('추가 인증')
  })

  it('runs global sweep when body is empty', async () => {
    const res = await POST(new Request('http://localhost/api/admin/system/naver-jobs/reconcile', { method: 'POST' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(mocks.reconcileNaverPostJobs).toHaveBeenCalled()
  })

  it('reconciles specific job when jobId is provided', async () => {
    const req = new Request('http://localhost/api/admin/system/naver-jobs/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: '11000000-0000-4000-8000-000000000001' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.jobId).toBe('11000000-0000-4000-8000-000000000001')
    expect(mocks.reconcileNaverPostJobs).toHaveBeenCalled()
  })

  it('returns 400 on invalid body JSON', async () => {
    const req = new Request('http://localhost/api/admin/system/naver-jobs/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid-json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
