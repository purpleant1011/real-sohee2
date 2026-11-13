import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), list: vi.fn(), create: vi.fn(), ensure: vi.fn(), options: vi.fn(), record: vi.fn(), sources: vi.fn(async () => [] as string[]), preferences: vi.fn(async () => ({ goal: '사장님 목표', tone: 'calm' })), contract: 'v093-original-1' as string | undefined }))
vi.mock('@/features/media/first-value-source', () => ({
  resolveFirstValueSourceIds: mocks.sources,
  firstValueSourceCookieName: (workspaceId: string) => `sohee-first-value-photo-${workspaceId}`,
  FirstValueSourceError: class FirstValueSourceError extends Error {
    readonly code: string
    readonly status: number
    constructor(code: string, status: number, message: string) {
      super(message)
      this.name = 'FirstValueSourceError'
      this.code = code
      this.status = status
    }
  },
}))
vi.mock('@/features/quick-start/quick-start-service', () => ({ loadQuickStartPreferences: mocks.preferences }))
vi.mock('@/features/quick-start/route-auth', () => ({ authorizeQuickRequest: mocks.auth, isResponse: (v: unknown) => v instanceof Response }))
vi.mock('@/features/quick-start/quick-post-approval-readiness', () => ({ readQuickPostApprovalReadiness: mocks.load }))
vi.mock('@/features/quick-start/quick-post-vault-contract', () => ({ ensureQuickPostVaultVersions: mocks.ensure, getQuickPostApprovalOptions: mocks.options, QuickPostVaultError: class extends Error { status = 409 } }))
vi.mock('@/features/quick-start/quick-post-service', () => ({
  listQuickPosts: mocks.list,
  createQuickDraft: mocks.create,
  QuickPostError: class QuickPostError extends Error {
    code = 'CREDIT_RESERVE_FAILED'
    status = 402
    constructor(message = '크레딧 오류', code = 'CREDIT_RESERVE_FAILED', status = 402) {
      super(message)
      this.name = 'QuickPostError'
      this.code = code
      this.status = status
    }
  },
  get sourceAssetContract() { return mocks.contract },
}))
vi.mock('@/features/quick-start/funnel-events', () => ({ recordFunnelEvent: mocks.record }))
import { handleFirstValue } from './first-value-route'
import { FirstValueSourceError } from '@/features/media/first-value-source'
import { QuickPostError } from '@/features/quick-start/quick-post-service'

const item = { missionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'AWAITING_APPROVAL', businessName: '모모 카페', topic: '첫 인사', copies: { instagram: { caption: '인사', hashtags: [] }, threads: { content: '안녕하세요' } }, channels: [], imageIds: [], imageUrl: null, revision: 1 }
const readiness = { stage: 'PREPARE_ONLY', prepared: true, verifiedChannels: [], progressPercent: 75, businessVerified: false }

function createMockAdmin(overrides?: { profile?: any; mission?: any; reservation?: any }) {
  const profileData = overrides?.profile !== undefined ? overrides.profile : { industry: '카페' }
  const missionData = overrides?.mission !== undefined ? overrides.mission : { metadata: { contract: { goal: '첫 인사' } } }
  const reservationData = overrides?.reservation !== undefined ? overrides.reservation : null

  return {
    from: vi.fn((table: string) => {
      const chain: any = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        order: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        maybeSingle: vi.fn(async () => {
          if (table === 'business_profiles') return { data: profileData, error: null }
          if (table === 'marketing_missions') return { data: missionData, error: null }
          if (table === 'quick_post_credit_reservations') return { data: reservationData, error: null }
          return { data: null, error: null }
        }),
      }
      return chain
    }),
  }
}

describe('first-value server contract', () => {
  it('blocks photo generation before providers or credit calls when W8 original contract is absent', async () => {
    mocks.auth.mockResolvedValue({ workspaceId: 'w1', userId: 'u1', admin: createMockAdmin(), supabase: {} })
    mocks.load.mockResolvedValue(readiness)
    mocks.list.mockResolvedValue([])
    mocks.sources.mockResolvedValue(['33333333-3333-4333-8333-333333333333'])
    mocks.create.mockClear()
    mocks.contract = undefined
    try {
      const response = await handleFirstValue()
      expect(response.status).toBe(503)
      expect((await response.json()).code).toBe('ORIGINAL_PHOTO_NOT_READY')
      expect(mocks.create).not.toHaveBeenCalled()
    } finally {
      mocks.contract = 'v093-original-1'
      mocks.sources.mockResolvedValue([])
    }
  })
  it('makes one draft and returns one safe text preview without a channel or NTS approval', async () => {
    mocks.auth.mockResolvedValue({ workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', admin: createMockAdmin(), supabase: {} })
    mocks.load.mockResolvedValue(readiness)
    mocks.list.mockResolvedValue([])
    mocks.create.mockResolvedValue({ ...item, imageNotice: '사진을 만드는 중 문제가 생겨 글만 먼저 준비했어요.' })
    mocks.ensure.mockResolvedValue({ revision: 1 })
    mocks.options.mockResolvedValue({ missionId: item.missionId, revision: 1, targets: [{ channel: 'threads', contentId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', versionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', handle: null, specLabel: '', actions: { VAULT: { allowed: true, message: null }, PUBLISH: { allowed: false, message: '채널을 연결하면 발행할 수 있어요' } } }] })
    mocks.record.mockResolvedValue(undefined)
    const response = await handleFirstValue()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.view).toMatchObject({ actionLabel: '승인하고 보관', progressPercent: 75, contentId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' })
    expect(body.item.copies.threads.content).toBe('안녕하세요')
    expect(body.imageNotice).toContain('글만 먼저')
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ allowTextOnlyOnImageError: true, sourceAssetIds: [], topic: '사장님 목표' })
    expect(mocks.record.mock.calls.map(c => c[0].event)).toEqual(['draft_requested', 'draft_ready'])
    mocks.list.mockResolvedValue([item])
    await handleFirstValue()
    expect(mocks.create).toHaveBeenCalledOnce()
    expect(mocks.record).toHaveBeenCalledTimes(2)
  })

  it('returns dual-channel publishable view when both channels are verified and approved', async () => {
    const dualItem = {
      ...item,
      channels: [
        { provider: 'instagram', handle: '@momo_cafe' },
        { provider: 'threads', handle: '@momo_cafe' },
      ],
      imageUrl: '/media/img1',
    }
    mocks.auth.mockResolvedValue({ workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', admin: createMockAdmin(), supabase: {} })
    mocks.load.mockResolvedValue({ ...readiness, verifiedChannels: ['instagram', 'threads'], stage: 'APPROVED_FOR_PUBLISH', progressPercent: 100 })
    mocks.list.mockResolvedValue([dualItem])
    mocks.ensure.mockResolvedValue({ revision: 1 })
    mocks.options.mockResolvedValue({
      missionId: dualItem.missionId,
      revision: 1,
      targets: [
        { channel: 'instagram', contentId: 'ig-cid', versionId: 'ig-vid', handle: '@momo_cafe', specLabel: '규격 확인 완료', actions: { VAULT: { allowed: true }, PUBLISH: { allowed: true } } },
        { channel: 'threads', contentId: 'th-cid', versionId: 'th-vid', handle: '@momo_cafe', specLabel: '규격 확인 완료', actions: { VAULT: { allowed: true }, PUBLISH: { allowed: true } } },
      ],
    })

    const response = await handleFirstValue()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.view.action).toBe('PUBLISH')
    expect(body.view.actionLabel).toBe('승인하고 발행')
    expect(body.view.targetChannelsText).toBe('인스타그램 · 스레드에 올려요')
    expect(body.view.targetChannels).toEqual(['instagram', 'threads'])
  })

  it('demotes publish action to VAULT and returns liveRolloutBlocked when workspace is not in allowlist', async () => {
    const prevEnv = process.env.META_LIVE_WORKSPACE_ALLOWLIST
    try {
      process.env.META_LIVE_WORKSPACE_ALLOWLIST = '11111111-1111-4111-8111-111111111111'

      const dualItem = {
        ...item,
        channels: [
          { provider: 'instagram', handle: '@momo_cafe' },
          { provider: 'threads', handle: '@momo_cafe' },
        ],
        imageUrl: '/media/img1',
      }
      mocks.auth.mockResolvedValue({ workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', admin: createMockAdmin(), supabase: {} })
      mocks.load.mockResolvedValue({ ...readiness, verifiedChannels: ['instagram', 'threads'], stage: 'APPROVED_FOR_PUBLISH', progressPercent: 100 })
      mocks.list.mockResolvedValue([dualItem])
      mocks.ensure.mockResolvedValue({ revision: 1 })
      mocks.options.mockResolvedValue({
        missionId: dualItem.missionId,
        revision: 1,
        targets: [
          { channel: 'instagram', contentId: 'ig-cid', versionId: 'ig-vid', handle: '@momo_cafe', specLabel: '규격 확인 완료', actions: { VAULT: { allowed: true }, PUBLISH: { allowed: true } } },
          { channel: 'threads', contentId: 'th-cid', versionId: 'th-vid', handle: '@momo_cafe', specLabel: '규격 확인 완료', actions: { VAULT: { allowed: true }, PUBLISH: { allowed: true } } },
        ],
      })

      const response = await handleFirstValue()
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.view.action).toBe('VAULT')
      expect(body.view.actionLabel).toBe('승인하고 보관')
      expect(body.view.liveRolloutBlocked).toBe(true)
      expect(body.view.liveRolloutNotice).toBe('실제 게시는 곧 열릴 예정이에요. 지금은 글을 보관함에 안전하게 담아 둘게요.')
      expect(body.view.targetChannels).toEqual([])
      expect(body.view.channelViews?.[0].publishReason).toBe('실제 게시는 곧 열릴 예정이에요. 지금은 글을 보관함에 안전하게 담아 둘게요.')
    } finally {
      process.env.META_LIVE_WORKSPACE_ALLOWLIST = prevEnv
    }
  })

  it('rejects with 503 QUICK_START_READ_FAILED when quick start preferences query fails, calling no providers or credits', async () => {
    mocks.auth.mockResolvedValue({ workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', admin: createMockAdmin(), supabase: {} })
    mocks.load.mockResolvedValue(readiness)
    mocks.list.mockResolvedValue([])
    mocks.create.mockClear()
    mocks.preferences.mockRejectedValueOnce(new Error('db connection error'))
    const response = await handleFirstValue()
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.code).toBe('QUICK_START_READ_FAILED')
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('rejects explicit topic exceeding 300 characters with 422 INVALID_TOPIC', async () => {
    mocks.auth.mockResolvedValue({ workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', admin: createMockAdmin(), supabase: {} })
    mocks.load.mockResolvedValue(readiness)
    mocks.list.mockResolvedValue([])
    mocks.create.mockClear()
    const request = new Request('https://local.invalid?topic=' + 'a'.repeat(301))
    const response = await handleFirstValue(request)
    expect(response.status).toBe(422)
    const body = await response.json()
    expect(body.code).toBe('INVALID_TOPIC')
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('rejects empty or whitespace cookie as MEDIA_SELECTION_INVALID 409', async () => {
    mocks.auth.mockResolvedValue({ workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', admin: createMockAdmin(), supabase: {} })
    mocks.load.mockResolvedValue(readiness)
    mocks.list.mockResolvedValue([])
    mocks.create.mockClear()
    const cookieName = 'sohee-first-value-photo-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const request = new Request('https://local.invalid', { headers: { cookie: `${cookieName}=%20%20%20` } })
    const response = await handleFirstValue(request)
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('MEDIA_SELECTION_INVALID')
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('forwards MEDIA_FETCH_FAILED 503 from photo source resolver and halts before draft creation (F1725-01 API)', async () => {
    mocks.auth.mockResolvedValue({ workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', admin: createMockAdmin(), supabase: {} })
    mocks.load.mockResolvedValue(readiness)
    mocks.list.mockResolvedValue([])
    mocks.create.mockClear()
    mocks.sources.mockRejectedValueOnce(new FirstValueSourceError('MEDIA_FETCH_FAILED', 503, '사진 목록을 조회하는 중 오류가 발생했어요.'))

    const response = await handleFirstValue()
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.code).toBe('MEDIA_FETCH_FAILED')
    expect(body.actionHref).toBe('/start?step=shop')
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('returns 503 FIRST_VALUE_PREVIEW_FAILED rather than CREDIT_RESERVE_FAILED when profile read fails after draft exists (F1725-02)', async () => {
    const errorAdmin = {
      from: vi.fn((table: string) => {
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          maybeSingle: vi.fn(async () => {
            if (table === 'business_profiles') return { data: null, error: new Error('profile read timeout') }
            if (table === 'marketing_missions') return { data: { metadata: {} }, error: null }
            return { data: null, error: null }
          }),
        }
        return chain
      }),
    }
    mocks.auth.mockResolvedValue({
      workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      admin: errorAdmin,
      supabase: {},
    })
    mocks.load.mockResolvedValue(readiness)
    mocks.list.mockResolvedValue([item]) // existing persisted draft
    mocks.ensure.mockResolvedValue({ revision: 1 })
    mocks.options.mockResolvedValue({ targets: [] })

    const response = await handleFirstValue()
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.code).toBe('FIRST_VALUE_PREVIEW_FAILED')
    expect(body.code).not.toBe('CREDIT_RESERVE_FAILED')
    expect(body.error).toContain('일시적인 지연')
  })

  it('preserves typed QuickPostError credit domain failure code and status (F1725-02 regression)', async () => {
    mocks.auth.mockResolvedValue({ workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', admin: createMockAdmin(), supabase: {} })
    mocks.load.mockResolvedValue(readiness)
    mocks.list.mockResolvedValue([])
    mocks.create.mockRejectedValueOnce(new QuickPostError('크레딧이 부족해요.', 'INSUFFICIENT_CREDITS', 402))

    const response = await handleFirstValue()
    expect(response.status).toBe(402)
    const body = await response.json()
    expect(body.code).toBe('INSUFFICIENT_CREDITS')
  })

  it('preserves typed QuickPostError CREDIT_RESERVE_FAILED 503 when credit reservation fails (F1725-02 typed credit failure)', async () => {
    mocks.auth.mockResolvedValue({ workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', admin: createMockAdmin(), supabase: {} })
    mocks.load.mockResolvedValue(readiness)
    mocks.list.mockResolvedValue([])
    mocks.create.mockRejectedValueOnce(new QuickPostError('크레딧 예약에 실패했어요.', 'CREDIT_RESERVE_FAILED', 503))

    const response = await handleFirstValue()
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.code).toBe('CREDIT_RESERVE_FAILED')
    expect(body.error).toBe('크레딧 예약에 실패했어요.')
  })
})
