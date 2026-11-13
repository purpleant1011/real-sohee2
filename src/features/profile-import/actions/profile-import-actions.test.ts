// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  used: vi.fn(),
  record: vi.fn(),
  identity: vi.fn(),
  igCorpus: vi.fn(),
  thCorpus: vi.fn(),
  textStyle: vi.fn(),
  sample: vi.fn(),
  download: vi.fn(),
  analyzeImages: vi.fn(),
  store: vi.fn(),
  brandUpdate: vi.fn(),
  brandInsert: vi.fn(),
  rpc: vi.fn(),
  revalidate: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/features/image-style/server/manager-auth', () => ({ authorizeManager: mocks.auth }))
vi.mock('@/features/image-style/server/store-private-image', () => ({ storePrivateImage: mocks.store }))
vi.mock('@/features/image-style/server/daily-quota', () => ({ usedInLastDay: mocks.used, recordUsage: mocks.record }))
vi.mock('@/features/image-style/reference-style-analysis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/image-style/reference-style-analysis')>()),
  analyzeReferenceImages: mocks.analyzeImages,
}))
vi.mock('../server/identity', () => ({ loadConnectedIdentity: mocks.identity }))
vi.mock('../corpus-fetchers', () => ({ fetchInstagramCorpus: mocks.igCorpus, fetchThreadsOwnCorpus: mocks.thCorpus }))
vi.mock('../text-style-analysis', () => ({ analyzeTextStyle: mocks.textStyle, writeSamplePost: mocks.sample }))
vi.mock('../image-download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../image-download')>()),
  downloadProfileImage: mocks.download,
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.eq = () => q
      q.maybeSingle = async () => (table === 'business_profiles' ? { data: { business_name: '꽃집' } } : mocks.brandUpdate())
      q.update = () => q
      q.insert = (row: unknown) => mocks.brandInsert(row)
      return q
    },
    rpc: (_name: string, args: unknown) => ({ single: () => mocks.rpc(args) }),
  }),
}))

import { MetaProviderError } from '@/lib/providers/meta-api'
import { sanitizeSecretLeakage } from '../sanitize-secret'
import {
  applyProfileTextStyleAction,
  fetchProfileTextStyleAction,
  importProfileImagesAction,
} from './profile-import-actions'

const workspaceId = '20000000-0000-4000-8000-000000000001'
const url = 'https://www.instagram.com/some.shop/'

// 정상 시나리오는 연결된 내 계정(isOwnAccount: true)이어야 함
// 제품 계약 변경 근거: 공식 Meta Business Discovery 미지원 및 타계정 사진 자동 보관 불가 정책에 따라
// 정상 분석 경로는 사용자가 연결한 내 계정만 지원됨.
const corpus = {
  platform: 'instagram', handle: 'some.shop', displayName: '가게', biography: '소개', followersCount: 1, mediaCount: 2, isOwnAccount: true,
  posts: [
    { id: '1', caption: '첫 글\n#태그', permalink: null, timestamp: null, mediaType: 'IMAGE', imageUrls: ['https://scontent.cdninstagram.com/a.jpg'], likeCount: null, commentsCount: null },
    { id: '2', caption: '둘째 글\n#태그', permalink: null, timestamp: null, mediaType: 'IMAGE', imageUrls: ['https://scontent.cdninstagram.com/b.jpg'], likeCount: null, commentsCount: null },
  ],
}
const draft = { voiceSummary: '따뜻한 말투', styleGuide: '첫 줄 헤더 유지', keywords: ['꽃'], prohibitedTerms: ['최저가'], sampleOpenings: [], hashtags: [] }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ userId: 'u1', role: 'owner' })
  mocks.used.mockResolvedValue(0)
  mocks.identity.mockResolvedValue({ accountId: 'ig1', accessToken: 'tok', ownHandle: 'some.shop' })
  mocks.igCorpus.mockResolvedValue(corpus)
  mocks.textStyle.mockResolvedValue(draft)
  mocks.sample.mockResolvedValue('샘플 글')
  mocks.download.mockImplementation(async () => new File([new Uint8Array([1, 2, 3])], 'p.jpg', { type: 'image/jpeg' }))
  mocks.analyzeImages.mockResolvedValue({ subject: '꽃', mood: '', setting: '', lookAndColor: '', people: 'none', avoid: '', extra: '', composition: '', notes: ['정면', '측면'], analysis: '분석' })
  mocks.store.mockResolvedValueOnce('50000000-0000-4000-8000-000000000001').mockResolvedValueOnce('50000000-0000-4000-8000-000000000002')
  mocks.brandUpdate.mockResolvedValue({ data: { workspace_id: workspaceId }, error: null })
  mocks.brandInsert.mockResolvedValue({ error: null })
  mocks.rpc.mockResolvedValue({ data: { id: 'r' }, error: null })
})

describe('fetchProfileTextStyleAction', () => {
  it('rejects non-account links and non-managers before touching the network', async () => {
    await expect(fetchProfileTextStyleAction({ workspaceId, url: 'https://www.instagram.com/p/abc/' })).resolves.toMatchObject({ error: { message: expect.stringContaining('계정 링크') } })
    mocks.auth.mockResolvedValueOnce({ message: '소유자 또는 관리자만 이미지 스타일을 만들 수 있어요.' })
    await expect(fetchProfileTextStyleAction({ workspaceId, url })).resolves.toMatchObject({ error: { message: expect.stringContaining('소유자') } })
    expect(mocks.igCorpus).not.toHaveBeenCalled()
  })

  it('analyzes captions into a text style draft with stats and a sample post', async () => {
    const result = await fetchProfileTextStyleAction({ workspaceId, url })
    expect(result.data).toMatchObject({ handle: 'some.shop', platform: 'instagram', postCount: 2, draft: { voiceSummary: '따뜻한 말투' }, sample: '샘플 글' })
    expect(result.data?.stats.topHashtags).toEqual(['#태그'])
    expect(mocks.igCorpus).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'ig1', ownHandle: 'some.shop', targetHandle: 'some.shop' }))
    expect(mocks.record).toHaveBeenCalledWith(workspaceId, 'u1', 'profile_import_text', 'profile_import')
  })

  it('stops at the daily limit, with no captions, and explains a missing connection', async () => {
    mocks.used.mockResolvedValueOnce(6)
    await expect(fetchProfileTextStyleAction({ workspaceId, url })).resolves.toMatchObject({ error: { message: expect.stringContaining('오늘') } })
    mocks.igCorpus.mockResolvedValueOnce({ ...corpus, posts: [] })
    await expect(fetchProfileTextStyleAction({ workspaceId, url })).resolves.toMatchObject({ error: { message: expect.stringContaining('분석할 글') } })
    mocks.identity.mockRejectedValueOnce(new Error('INSTAGRAM_NOT_CONNECTED'))
    const missingResult = await fetchProfileTextStyleAction({ workspaceId, url })
    expect(missingResult).toMatchObject({ error: { message: expect.stringContaining('먼저 연결') } })
    // 타계정 지원을 보장하는 허위 안내 문구가 없어야 함
    expect(missingResult.error?.message).not.toContain('다른 공개 비즈니스 계정도 분석할 수 있어요')
    expect(missingResult.error?.message).toContain('현재 연결한 내 계정 분석을 지원해요')
  })

  it('타 계정 링크 입력 시 외부 호출 전에 사전 차단되고 "현재 연결된 사장님의 계정 링크만 가져올 수 있어요" 안내가 뜬다', async () => {
    const otherUrl = 'https://www.instagram.com/other.shop/'
    const result = await fetchProfileTextStyleAction({ workspaceId, url: otherUrl })
    expect(result).toMatchObject({
      error: { message: '현재 연결된 사장님의 계정 링크만 가져올 수 있어요' },
    })
    expect(mocks.igCorpus).not.toHaveBeenCalled()
    expect(mocks.textStyle).not.toHaveBeenCalled()
  })

  it('타계정(isOwnAccount: false)은 모델 호출 전에 차단된다', async () => {
    mocks.igCorpus.mockResolvedValueOnce({ ...corpus, isOwnAccount: false })
    const result = await fetchProfileTextStyleAction({ workspaceId, url })
    expect(result).toMatchObject({
      error: { message: '현재 연결된 사장님의 계정 링크만 가져올 수 있어요' },
    })
    expect(mocks.textStyle).not.toHaveBeenCalled()
  })

  it('keeps the draft even when the sample post fails', async () => {
    mocks.sample.mockRejectedValueOnce(new Error('x'))
    const result = await fetchProfileTextStyleAction({ workspaceId, url })
    expect(result.data?.sample).toBe('')
    expect(result.data?.draft.voiceSummary).toBe('따뜻한 말투')
  })
})

describe('importProfileImagesAction', () => {
  it('downloads representative photos, analyzes them and keeps them as reference photos with notes', async () => {
    const result = await importProfileImagesAction({ workspaceId, url })
    expect(result.data?.pickedCount).toBe(2)
    expect(result.data?.references).toEqual([
      { id: '50000000-0000-4000-8000-000000000001', url: `/api/workspaces/${workspaceId}/media/50000000-0000-4000-8000-000000000001`, note: '정면' },
      { id: '50000000-0000-4000-8000-000000000002', url: `/api/workspaces/${workspaceId}/media/50000000-0000-4000-8000-000000000002`, note: '측면' },
    ])
    expect(result.data?.form).toMatchObject({ analysis: '분석', subject: '꽃' })
    expect(mocks.record).toHaveBeenCalledWith(workspaceId, 'u1', 'profile_import_images', 'profile_import')
  })

  it('reports when no photo can be downloaded or the account has none', async () => {
    mocks.download.mockResolvedValue(null)
    await expect(importProfileImagesAction({ workspaceId, url })).resolves.toMatchObject({ error: { message: expect.stringContaining('내려받지') } })
    mocks.igCorpus.mockResolvedValueOnce({ ...corpus, posts: [] })
    await expect(importProfileImagesAction({ workspaceId, url })).resolves.toMatchObject({ error: { message: expect.stringContaining('분석할 사진') } })
  })

  it('타 계정 링크 입력 시 외부 호출 전에 사전 차단되고 "현재 연결된 사장님의 계정 링크만 가져올 수 있어요" 안내가 뜬다', async () => {
    const otherUrl = 'https://www.instagram.com/other.shop/'
    const result = await importProfileImagesAction({ workspaceId, url: otherUrl })
    expect(result).toMatchObject({
      error: { message: '현재 연결된 사장님의 계정 링크만 가져올 수 있어요' },
    })
    expect(mocks.igCorpus).not.toHaveBeenCalled()
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.analyzeImages).not.toHaveBeenCalled()
    expect(mocks.store).not.toHaveBeenCalled()
  })

  it('타계정(isOwnAccount: false)의 사진 자동 보관 및 AI 분석을 거부한다 (현재 연결된 사장님의 계정 링크만 지원)', async () => {
    mocks.igCorpus.mockResolvedValueOnce({ ...corpus, isOwnAccount: false })
    const result = await importProfileImagesAction({ workspaceId, url })
    expect(result).toMatchObject({
      error: { message: '현재 연결된 사장님의 계정 링크만 가져올 수 있어요' },
    })
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.analyzeImages).not.toHaveBeenCalled()
    expect(mocks.store).not.toHaveBeenCalled()
  })
})

describe('applyProfileTextStyleAction', () => {
  const input = { workspaceId, voiceSummary: ' 따뜻한 말투 ', styleGuide: '첫 줄 헤더 유지', keywords: ['꽃', '꽃', ' '], prohibitedTerms: ['최저가'] }

  it('rejects instructions exceeding the displayed limits instead of silently truncating them', async () => {
    await expect(applyProfileTextStyleAction({ ...input, voiceSummary: '가'.repeat(201) })).resolves.toMatchObject({ error: { message: expect.stringContaining('길이') } })
    await expect(applyProfileTextStyleAction({ ...input, styleGuide: '가'.repeat(1201) })).resolves.toMatchObject({ error: { message: expect.stringContaining('길이') } })
    expect(mocks.brandUpdate).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('updates the brand profile voice and registers the text harness rule', async () => {
    await expect(applyProfileTextStyleAction(input)).resolves.toEqual({ data: { applied: true } })
    expect(mocks.rpc).toHaveBeenCalledWith(expect.objectContaining({
      p_rule_key: 'text-harness-v1',
      p_rule_type: 'text_generation',
      p_structured_rule: expect.objectContaining({ brandVoice: '따뜻한 말투', keyPhrases: ['꽃'], prohibitedWords: ['최저가'] }),
      p_applies_to_channels: ['instagram', 'threads', 'naver_blog'],
    }))
    expect(mocks.brandInsert).not.toHaveBeenCalled()
  })

  it('inserts a brand profile when none exists and rejects empty or unauthorized input', async () => {
    mocks.brandUpdate.mockResolvedValueOnce({ data: null, error: null })
    await applyProfileTextStyleAction(input)
    expect(mocks.brandInsert).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: workspaceId, voice: expect.stringContaining('[글 구조·말투 지시]') }))
    await expect(applyProfileTextStyleAction({ ...input, styleGuide: '  ' })).resolves.toMatchObject({ error: { message: expect.stringContaining('지시문') } })
    mocks.auth.mockResolvedValueOnce({ message: '소유자 또는 관리자만 이미지 스타일을 만들 수 있어요.' })
    await expect(applyProfileTextStyleAction(input)).resolves.toMatchObject({ error: { message: expect.stringContaining('소유자') } })
  })
})

describe('민감 정보(access_token, appsecret_proof) 보호 및 클라이언트 유출 방지 회귀 테스트', () => {
  const sensitiveToken = 'EAABtestToken123456789'
  const sensitiveProof = 'appsecretProofValue987654321'

  it('sanitizeSecretLeakage가 토큰과 시크릿 파라미터를 철저히 마스킹한다', () => {
    const rawUrl = `https://graph.instagram.com/v26.0/me?access_token=${sensitiveToken}&appsecret_proof=${sensitiveProof}`
    const sanitized = sanitizeSecretLeakage(rawUrl)
    expect(sanitized).not.toContain(sensitiveToken)
    expect(sanitized).not.toContain(sensitiveProof)
    expect(sanitized).toContain('access_token=[REDACTED]')
    expect(sanitized).toContain('appsecret_proof=[REDACTED]')

    const jsonSnippet = `{"access_token":"${sensitiveToken}","appsecret_proof":"${sensitiveProof}"}`
    const sanitizedJson = sanitizeSecretLeakage(jsonSnippet)
    expect(sanitizedJson).not.toContain(sensitiveToken)
    expect(sanitizedJson).not.toContain(sensitiveProof)

    const bearerSnippet = `Authorization: Bearer ${sensitiveToken}`
    const sanitizedBearer = sanitizeSecretLeakage(bearerSnippet)
    expect(sanitizedBearer).not.toContain(sensitiveToken)
    expect(sanitizedBearer).toContain('Bearer [REDACTED]')
  })

  it('fetchProfileTextStyleAction: MetaProviderError에 access_token, appsecret_proof가 포함되어도 클라이언트에 유출되지 않는다', async () => {
    const leakError = new MetaProviderError(
      'PROVIDER_REJECTED',
      `호출 실패: https://graph.instagram.com/me?access_token=${sensitiveToken}&appsecret_proof=${sensitiveProof}`,
    )
    mocks.igCorpus.mockRejectedValueOnce(leakError)

    const result = await fetchProfileTextStyleAction({ workspaceId, url })
    expect(result.data).toBeUndefined()
    expect(result.error).toBeDefined()
    const errorMsg = result.error?.message ?? ''
    expect(errorMsg).not.toContain(sensitiveToken)
    expect(errorMsg).not.toContain(sensitiveProof)
    expect(errorMsg).not.toContain(sensitiveProof)
  })

  it('fetchProfileTextStyleAction: 예외 발생 시 어떤 경우에도 토큰이 유출되지 않는다', async () => {
    mocks.igCorpus.mockRejectedValueOnce(new Error(`Fetch error with access_token=${sensitiveToken}`))

    const result = await fetchProfileTextStyleAction({ workspaceId, url })
    expect(result.data).toBeUndefined()
    expect(result.error).toBeDefined()
    const errorMsg = result.error?.message ?? ''
    expect(errorMsg).not.toContain(sensitiveToken)
  })

  it('importProfileImagesAction: MetaProviderError에 access_token, appsecret_proof가 포함되어도 클라이언트에 유출되지 않는다', async () => {
    const leakError = new MetaProviderError(
      'PROVIDER_REJECTED',
      `사진 수집 실패: access_token=${sensitiveToken}&appsecret_proof=${sensitiveProof}`,
    )
    mocks.igCorpus.mockRejectedValueOnce(leakError)

    const result = await importProfileImagesAction({ workspaceId, url })
    expect(result.data).toBeUndefined()
    expect(result.error).toBeDefined()
    const errorMsg = result.error?.message ?? ''
    expect(errorMsg).not.toContain(sensitiveToken)
    expect(errorMsg).not.toContain(sensitiveProof)
  })

  it('importProfileImagesAction: 일반 예외 발생 시에도 민감 정보가 유출되지 않는다', async () => {
    mocks.igCorpus.mockRejectedValueOnce(new Error(`Unexpected Error: appsecret_proof=${sensitiveProof}`))

    const result = await importProfileImagesAction({ workspaceId, url })
    expect(result.data).toBeUndefined()
    expect(result.error).toBeDefined()
    const errorMsg = result.error?.message ?? ''
    expect(errorMsg).not.toContain(sensitiveProof)
  })
})
