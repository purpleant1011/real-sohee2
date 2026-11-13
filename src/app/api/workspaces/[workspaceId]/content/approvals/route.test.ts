import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const { authorize, approveContentVersion, requireSoheeReady, approveBundleExact, getBundleById, getLatestBundleForVersion } = vi.hoisted(() => ({
  authorize: vi.fn(),
  approveContentVersion: vi.fn(),
  requireSoheeReady: vi.fn(),
  approveBundleExact: vi.fn(),
  getBundleById: vi.fn(),
  getLatestBundleForVersion: vi.fn(),
}))

class FakeSoheeNotReadyError extends Error {
  code = 'SOHEE_NOT_READY'
  snapshot = { blockers: [{ id: 'business_verification', label: '사업자 인증 미완료' }] }
  membershipTier = 'FREE'
  membershipNotice = null
  notice = null
  constructor() {
    super('소희가 아직 준비되지 않았어요.')
  }
}

vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: authorize,
  isResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/features/content/canonical-content-lifecycle', () => ({
  CanonicalContentLifecycleService: { approveContentVersion },
}))
vi.mock('@/features/creative/exact-approval-service', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/creative/exact-approval-service')>(),
  ExactApprovalService: class { approveBundleExact = approveBundleExact },
}))
vi.mock('@/features/creative/creative-bundle-store', () => ({
  SupabaseCreativeBundleStore: class {
    getLatestBundleForVersion = getLatestBundleForVersion
    getBundleById = getBundleById
  },
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))
vi.mock('@/features/sohee-ready/admission-guard', () => ({
  requireSoheeReady,
  SoheeNotReadyError: FakeSoheeNotReadyError,
}))

const workspaceId = '00000000-0000-0000-0000-0000000000dd'
const FINGERPRINT = 'a'.repeat(64)
const ctx = () => ({ params: Promise.resolve({ workspaceId }) })
const request = () =>
  new NextRequest(`https://example.test/api/workspaces/${workspaceId}/content/approvals`, {
    method: 'POST',
    body: JSON.stringify({ contentId: 'c-1', versionId: 'v-1', fingerprint: FINGERPRINT }),
  })

beforeEach(() => {
  authorize.mockReset()
  approveContentVersion.mockReset()
  requireSoheeReady.mockReset()
  approveBundleExact.mockReset().mockResolvedValue({ bundleId: 'bundle-1', status: 'APPROVED' })
  getBundleById.mockReset().mockResolvedValue({ bundleId: 'bundle-1', workspaceId, contentId: 'c-1', versionId: 'v-1', bundleFingerprint: 'b'.repeat(64), approvalStatus: 'PENDING' })
  getLatestBundleForVersion.mockReset().mockResolvedValue(null)
  authorize.mockResolvedValue({ userId: 'user-owner', workspaceId, role: 'owner', supabase: {}, admin: {} })
  requireSoheeReady.mockResolvedValue(undefined)
  approveContentVersion.mockResolvedValue({ approvalId: 'ap-1', status: 'approved' })
})

describe('content approvals route workspace authorization', () => {
  it('refuses a non-member before the readiness gate and never leaks blockers', async () => {
    authorize.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: '해당 워크스페이스에 대한 접근 권한이 없습니다 (CROSS_TENANT_ACCESS_DENIED).' }),
        { status: 403 },
      ),
    )

    const response = await POST(request(), ctx())
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(requireSoheeReady).not.toHaveBeenCalled()
    expect(approveContentVersion).not.toHaveBeenCalled()
    expect(JSON.stringify(body)).not.toContain('SOHEE_NOT_READY')
    expect(JSON.stringify(body)).not.toContain('사업자 인증 미완료')
  })

  it('still reports readiness blockers to an active member', async () => {
    requireSoheeReady.mockRejectedValueOnce(new FakeSoheeNotReadyError())

    const response = await POST(request(), ctx())
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.code).toBe('SOHEE_NOT_READY')
    expect(body.error.blockers).toHaveLength(1)
  })

  it('records the authenticated actor rather than a client-supplied approver', async () => {
    const forgedRequest = new NextRequest(`https://example.test/api/workspaces/${workspaceId}/content/approvals`, {
      method: 'POST',
      body: JSON.stringify({ contentId: 'c-1', versionId: 'v-1', fingerprint: FINGERPRINT, decidedBy: 'another-owner' }),
    })
    const response = await POST(forgedRequest, ctx())

    expect(response.status).toBe(200)
    expect(approveContentVersion).toHaveBeenCalledWith(expect.objectContaining({ decidedBy: 'user-owner' }))
  })

  it('does not approve an unseen latest media bundle during a content-only approval', async () => {
    getLatestBundleForVersion.mockResolvedValue({ bundleId: 'unseen-bundle', bundleFingerprint: 'b'.repeat(64), approvalStatus: 'PENDING' })
    const response = await POST(request(), ctx())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, bundleApproval: null })
    expect(approveBundleExact).not.toHaveBeenCalled()
  })

  it.each([
    { bundleId: 'bundle-1' },
    { bundleId: 'bundle-1', bundleFingerprint: 'invalid' },
    { bundleFingerprint: 'b'.repeat(64) },
  ])('rejects incomplete exact bundle consent before recording content approval: %j', async extra => {
    const response = await POST(new NextRequest('https://example.test/approval', {
      method: 'POST', body: JSON.stringify({ contentId: 'c-1', versionId: 'v-1', fingerprint: FINGERPRINT, ...extra }),
    }), ctx())

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ success: false, error: { code: 'INVALID_BUNDLE_APPROVAL' } })
    expect(approveContentVersion).not.toHaveBeenCalled()
    expect(approveBundleExact).not.toHaveBeenCalled()
  })

  it.each([
    { workspaceId: 'other-workspace' },
    { contentId: 'other-content' },
    { versionId: 'other-version' },
    { bundleId: 'other-bundle' },
    { bundleFingerprint: 'c'.repeat(64) },
  ])('rejects a bundle outside the reviewed content version before either approval: %j', async change => {
    getBundleById.mockResolvedValue({ bundleId: 'bundle-1', workspaceId, contentId: 'c-1', versionId: 'v-1', bundleFingerprint: 'b'.repeat(64), approvalStatus: 'PENDING', ...change })
    const response = await POST(new NextRequest('https://example.test/approval', {
      method: 'POST', body: JSON.stringify({ contentId: 'c-1', versionId: 'v-1', fingerprint: FINGERPRINT, bundleId: 'bundle-1', bundleFingerprint: 'b'.repeat(64) }),
    }), ctx())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ success: false, error: { code: 'BUNDLE_REVIEW_REQUIRED' } })
    expect(approveContentVersion).not.toHaveBeenCalled()
    expect(approveBundleExact).not.toHaveBeenCalled()
  })

  it('approves only the explicitly reviewed bundle bound to the same content version', async () => {
    const response = await POST(new NextRequest('https://example.test/approval', {
      method: 'POST', body: JSON.stringify({ contentId: 'c-1', versionId: 'v-1', fingerprint: FINGERPRINT, bundleId: 'bundle-1', bundleFingerprint: 'b'.repeat(64) }),
    }), ctx())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, bundleApproval: { bundleId: 'bundle-1', status: 'APPROVED' } })
    expect(approveBundleExact).toHaveBeenCalledWith({ workspaceId, bundleId: 'bundle-1', expectedFingerprint: 'b'.repeat(64), decidedBy: 'user-owner' })
  })

  it('reports an unconfirmed bundle decision without denying the saved content approval', async () => {
    const { BundleApprovalResultUnknownError } = await import('@/features/creative/exact-approval-service')
    approveBundleExact.mockRejectedValueOnce(new BundleApprovalResultUnknownError())
    const response = await POST(new NextRequest('https://example.test/approval', {
      method: 'POST', body: JSON.stringify({ contentId: 'c-1', versionId: 'v-1', fingerprint: FINGERPRINT,
        bundleId: 'bundle-1', bundleFingerprint: 'b'.repeat(64) }),
    }), ctx())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      success: false, approval: { approvalId: 'ap-1', status: 'approved' }, bundleApproval: null,
      error: { code: 'BUNDLE_APPROVAL_RESULT_UNKNOWN' },
    })
    expect(approveContentVersion).toHaveBeenCalledTimes(1)
    expect(approveBundleExact).toHaveBeenCalledTimes(1)
  })

  it.each(['fingerprint', 'stale', 'transport'] as const)(
    'preserves confirmed content approval when bundle approval fails after it: %s', async failure => {
      const { FingerprintMismatchError, StaleApprovalConcurrencyError } = await import('@/features/creative/exact-approval-service')
      const error = failure === 'fingerprint' ? new FingerprintMismatchError('사진이 변경되었습니다.')
        : failure === 'stale' ? new StaleApprovalConcurrencyError('사진 승인 상태가 변경되었습니다.')
          : new Error('connection lost: private-provider-token')
      approveBundleExact.mockRejectedValueOnce(error)
      const response = await POST(new NextRequest('https://example.test/approval', {
        method: 'POST', body: JSON.stringify({ contentId: 'c-1', versionId: 'v-1', fingerprint: FINGERPRINT,
          bundleId: 'bundle-1', bundleFingerprint: 'b'.repeat(64) }),
      }), ctx())
      const body = await response.json()
      expect(response.status).toBe(409)
      expect(body).toMatchObject({
        success: false, approval: { approvalId: 'ap-1', status: 'approved' }, bundleApproval: null,
        error: { code: failure === 'fingerprint' ? 'FINGERPRINT_MISMATCH_ERROR'
          : failure === 'stale' ? 'STALE_APPROVAL_CONCURRENCY_ERROR' : 'BUNDLE_APPROVAL_RESULT_UNKNOWN' },
      })
      expect(JSON.stringify(body)).not.toContain('private-provider-token')
      expect(approveContentVersion).toHaveBeenCalledTimes(1)
      expect(approveBundleExact).toHaveBeenCalledTimes(1)
    },
  )

  it('approves content for an active member', async () => {
    const response = await POST(request(), ctx())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true })
    expect(approveContentVersion).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId, contentId: 'c-1', versionId: 'v-1' }),
    )
  })
})
