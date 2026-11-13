import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const { authorize, requireSoheeReady, executePublish, validateInput, createServerClient } = vi.hoisted(() => ({
  authorize: vi.fn(),
  requireSoheeReady: vi.fn(),
  executePublish: vi.fn(),
  validateInput: vi.fn((body: any) => body),
  createServerClient: vi.fn(),
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
vi.mock('@/features/sohee-ready/admission-guard', () => ({
  requireSoheeReady,
  SoheeNotReadyError: FakeSoheeNotReadyError,
}))
vi.mock('@/lib/agent-os/executors/publishing-executor', () => ({
  PublishingExecutor: {
    executePublish,
  },
}))
vi.mock('@/features/naver-publish/unavailable', () => ({ naverPublishNotReadyResult: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: createServerClient }))
vi.mock('@/features/publishing/publish-contract-validator', () => ({
  validatePublishInputContract: validateInput,
  resolveApprovedBundlePublishContext: vi.fn(),
  RawImagesContractViolationError: class extends Error {},
  ApprovedBundleRequiredError: class extends Error {},
}))
vi.mock('@/features/creative/creative-bundle-store', () => ({ SupabaseCreativeBundleStore: class {} }))
vi.mock('@/features/creative/approval-invalidation-engine', () => ({ ApprovalIntegrityError: class extends Error {} }))
vi.mock('@/features/publishing/publish-rendition-service', () => ({
  PublishRenditionService: class {},
  PublishRenditionError: class extends Error {},
}))
vi.mock('@/features/publishing/provider-delivery-lease-service', () => ({
  ProviderDeliveryLeaseService: class {},
  ProviderDeliveryLeaseError: class extends Error {},
}))
vi.mock('@/features/publishing/canonical-publish-facade', () => ({ CanonicalPublishFacade: class {} }))

const workspaceId = '00000000-0000-0000-0000-0000000000cc'
const context = { params: Promise.resolve({ workspaceId }) }
const request = () =>
  new NextRequest(`https://example.test/api/workspaces/${workspaceId}/publishing/instant`, {
    method: 'POST',
    body: JSON.stringify({ channel: 'INSTAGRAM', caption: '게시 시도' }),
  })

beforeEach(() => {
  authorize.mockReset()
  requireSoheeReady.mockReset()
  authorize.mockResolvedValue({ userId: 'user-owner', workspaceId, role: 'owner', supabase: {}, admin: {} })
  requireSoheeReady.mockResolvedValue(undefined)
})

describe('instant publish route workspace authorization', () => {
  it('refuses a non-member with 403 and never exposes that workspace readiness state (E2E-F F-3)', async () => {
    authorize.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: '해당 워크스페이스에 대한 접근 권한이 없습니다 (CROSS_TENANT_ACCESS_DENIED).' }), {
        status: 403,
      }),
    )

    const response = await POST(request(), context)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(requireSoheeReady).not.toHaveBeenCalled()
    expect(JSON.stringify(body)).not.toContain('SOHEE_NOT_READY')
    expect(JSON.stringify(body)).not.toContain('사업자 인증 미완료')
  })

  it('still returns the readiness blockers to an active member', async () => {
    requireSoheeReady.mockRejectedValueOnce(new FakeSoheeNotReadyError())

    const response = await POST(request(), context)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.code).toBe('SOHEE_NOT_READY')
    expect(body.error.blockers).toHaveLength(1)
  })

  it('never reports overall success: true when one channel fails in multi-channel publish (prevents false success)', async () => {
    createServerClient.mockResolvedValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => null,
              }),
            }),
          }),
        }),
      }),
    })

    executePublish.mockImplementation(async ({ channel }: { channel: string }) => {
      if (channel === 'INSTAGRAM') {
        return { success: false, verified: false, stage: 'FAILED', statusMessage: 'IG rejected' }
      }
      return { success: true, verified: true, stage: 'EXTERNALLY_VERIFIED', statusMessage: 'Threads ok' }
    })

    const req = new NextRequest(`https://example.test/api/workspaces/${workspaceId}/publishing/instant`, {
      method: 'POST',
      body: JSON.stringify({ channel: 'BOTH', caption: '다채널 게시 테스트' }),
    })

    const response = await POST(req, context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.results.instagram.success).toBe(false)
    expect(body.results.threads.success).toBe(true)
    // Partial success must NOT be reported as overall success: true
    expect(body.success).toBe(false)
    // message must distinguish partial success from all success
    expect(body.message).toBe('일부 채널에만 게시 요청이 전달되었어요. 채널별 결과를 확인해 주세요.')
  })

  it('reports allSuccess message when all channels succeed and none message when all fail', async () => {
    createServerClient.mockResolvedValue({
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => null }) }) }) }) }),
    })

    // Case 1: All success
    executePublish.mockResolvedValue({ success: true, verified: true, stage: 'EXTERNALLY_VERIFIED' })
    const allReq = new NextRequest(`https://example.test/api/workspaces/${workspaceId}/publishing/instant`, {
      method: 'POST',
      body: JSON.stringify({ channel: 'BOTH', caption: '모두 성공' }),
    })
    const allRes = await POST(allReq, context)
    const allBody = await allRes.json()
    expect(allBody.success).toBe(true)
    expect(allBody.message).toBe('선택하신 모든 채널에 게시 요청이 정상 전달되었습니다.')

    // Case 2: All fail
    executePublish.mockResolvedValue({ success: false, verified: false, stage: 'FAILED' })
    const noneReq = new NextRequest(`https://example.test/api/workspaces/${workspaceId}/publishing/instant`, {
      method: 'POST',
      body: JSON.stringify({ channel: 'BOTH', caption: '모두 실패' }),
    })
    const noneRes = await POST(noneReq, context)
    const noneBody = await noneRes.json()
    expect(noneBody.success).toBe(false)
    expect(noneBody.message).toBe('채널 계정 연동 상태를 확인해 주세요.')
  })
})
