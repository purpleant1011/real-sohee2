import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  membershipMaybeSingle: vi.fn(),
  versionMaybeSingle: vi.fn(),
  readOpenAIImageConfig: vi.fn(),
  openAIConstructor: vi.fn(),
  generate: vi.fn(),
  loadActiveByreumImageHarness: vi.fn(),
  composeByreumImagePrompt: vi.fn(),
  composeNeutralImagePrompt: vi.fn(),
  loadWorkspaceImageStyle: vi.fn(),
  loadReferenceImages: vi.fn(),
  uploadContentMediaAction: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: vi.fn((table: string) => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle:
          table === 'content_versions'
            ? mocks.versionMaybeSingle
            : mocks.membershipMaybeSingle,
      }
      return query
    }),
  })),
}))
vi.mock('@/lib/openai/server-env', () => ({
  readOpenAIImageConfig: mocks.readOpenAIImageConfig,
}))
vi.mock('@/lib/providers/openai-image-provider', () => {
  class OpenAIImageProviderError extends Error {
    readonly code: string
    constructor(message = 'AI 이미지를 안전하게 처리하지 못했습니다.', code = 'IMAGE_PROVIDER_UNAVAILABLE') {
      super(message)
      this.name = 'OpenAIImageProviderError'
      this.code = code
    }
  }
  return {
    createOpenAIImageProvider: vi.fn(() => ({ generate: mocks.generate })),
    OpenAIImageProviderError,
  }
})
vi.mock('@/features/harness/byreum-image-harness-repository', () => ({
  loadActiveByreumImageHarness: mocks.loadActiveByreumImageHarness,
  isByreumTestAccount: (email: string | null | undefined) => email === 'test@example.com',
}))
vi.mock('@/features/harness/byreum-image-harness', () => ({
  composeByreumImagePrompt: mocks.composeByreumImagePrompt,
  BYREUM_IMAGE_HARNESS: { harnessId: 'BYREUM_RECOMMENDED_HARNESS_V1_0' },
}))
vi.mock('@/features/harness/neutral-image-prompt', () => ({
  composeNeutralImagePrompt: mocks.composeNeutralImagePrompt,
}))
vi.mock('@/features/image-style/workspace-image-style-repository', () => ({
  loadWorkspaceImageStyle: mocks.loadWorkspaceImageStyle,
}))
vi.mock('@/features/image-style/reference-images', () => ({ loadReferenceImages: mocks.loadReferenceImages }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: () => ({}) }))
vi.mock('./upload-content-media', () => ({
  uploadContentMediaAction: mocks.uploadContentMediaAction,
}))
vi.mock('openai', () => ({ default: mocks.openAIConstructor }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { generateContentImageAction } from './generate-content-image'
import { OpenAIImageProviderError } from '@/lib/providers/openai-image-provider'

const input = {
  workspaceId: '20000000-0000-4000-8000-000000000001',
  contentId: '30000000-0000-4000-8000-000000000001',
  versionId: '40000000-0000-4000-8000-000000000001',
  currentVersionFingerprint: 'a'.repeat(64),
  prompt: '따뜻한 가을 캠페인 정사각 이미지',
  channel: 'instagram',
}
const assetId = '50000000-0000-4000-8000-000000000001'

describe('generateContentImageAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mocks.membershipMaybeSingle.mockResolvedValue({
      data: { role: 'manager', status: 'active' },
      error: null,
    })
    mocks.versionMaybeSingle.mockResolvedValue({
      data: { content_id: input.contentId, fingerprint: input.currentVersionFingerprint },
      error: null,
    })
    mocks.readOpenAIImageConfig.mockReturnValue({
      apiKey: 'sk-test-safe-image-placeholder',
      model: 'gpt-image-2',
    })
    mocks.openAIConstructor.mockImplementation(function () { return { images: { generate: vi.fn() } } })
    mocks.loadActiveByreumImageHarness.mockResolvedValue({
      ruleId: '60000000-0000-4000-8000-000000000001',
      version: 1,
      harness: { harnessId: 'BYREUM_RECOMMENDED_HARNESS_V1_0' },
    })
    mocks.composeByreumImagePrompt.mockReturnValue('BYREUM_COMPOSED_PROMPT')
    mocks.composeNeutralImagePrompt.mockReturnValue('NEUTRAL_COMPOSED_PROMPT')
    mocks.loadWorkspaceImageStyle.mockResolvedValue(null)
    mocks.loadReferenceImages.mockResolvedValue([])
    mocks.generate.mockResolvedValue({
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      mimeType: 'image/png',
      requestId: 'req_image_test',
    })
    mocks.uploadContentMediaAction.mockResolvedValue({
      data: { assetId, rightsStatus: 'confirmed' },
    })
  })

  it('verifies auth and version before reusing the private content-media upload boundary', async () => {
    await expect(generateContentImageAction(input)).resolves.toEqual({
      data: { source: 'openai', assetId, rightsStatus: 'confirmed' },
    })
    expect(mocks.composeByreumImagePrompt).toHaveBeenCalledWith(expect.objectContaining({
      userPrompt: input.prompt,
      channel: 'instagram',
    }))
    expect(mocks.generate).toHaveBeenCalledWith({
      prompt: 'BYREUM_COMPOSED_PROMPT',
      size: '1024x1536',
    })
    const form = mocks.uploadContentMediaAction.mock.calls[0]?.[0] as FormData
    expect(form.get('workspaceId')).toBe(input.workspaceId)
    expect(form.get('rightsAcknowledged')).toBe('true')
    const file = form.get('file') as File
    expect(file).toBeInstanceOf(File)
    expect(file.type).toBe('image/png')
    expect(file.size).toBe(8)
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/app/work/${input.contentId}/edit`)
  })

  it.each([
    ['missing prompt', { ...input, prompt: '   ' }],
    ['long prompt', { ...input, prompt: '가'.repeat(1_501) }],
  ])('rejects %s before constructing a provider', async (_label, invalidInput) => {
    await expect(generateContentImageAction(invalidInput)).resolves.toMatchObject({
      error: { requestId: 'content-image-generation' },
    })
    expect(mocks.readOpenAIImageConfig).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request before constructing a provider', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })

    await expect(generateContentImageAction(input)).resolves.toMatchObject({
      error: { message: expect.stringContaining('로그인') },
    })
    expect(mocks.readOpenAIImageConfig).not.toHaveBeenCalled()
  })

  it('rejects a viewer before constructing a provider', async () => {
    mocks.membershipMaybeSingle.mockResolvedValue({
      data: { role: 'viewer', status: 'active' },
      error: null,
    })

    await expect(generateContentImageAction(input)).resolves.toMatchObject({
      error: { message: expect.stringContaining('생성할 수 없습니다') },
    })
    expect(mocks.readOpenAIImageConfig).not.toHaveBeenCalled()
  })

  it('falls back to the neutral prompt when the workspace has no active channel harness', async () => {
    mocks.loadActiveByreumImageHarness.mockResolvedValue(null)

    await expect(generateContentImageAction(input)).resolves.toEqual({
      data: { source: 'openai', assetId, rightsStatus: 'confirmed' },
    })
    expect(mocks.composeByreumImagePrompt).not.toHaveBeenCalled()
    expect(mocks.composeNeutralImagePrompt).toHaveBeenCalledWith(expect.objectContaining({
      userPrompt: input.prompt,
      channel: 'instagram',
    }))
    expect(mocks.generate).toHaveBeenCalledWith({ prompt: 'NEUTRAL_COMPOSED_PROMPT', size: '1024x1536' })
  })

  it('passes the owner-registered image style into the neutral prompt', async () => {
    const style = { subject: '네일 아트', mood: '', setting: '', lookAndColor: '', people: 'hands', avoid: [], extra: '', composition: '', guide: '', referenceAssetIds: [], referenceNotes: {} }
    mocks.loadActiveByreumImageHarness.mockResolvedValue(null)
    mocks.loadWorkspaceImageStyle.mockResolvedValue(style)

    await generateContentImageAction(input)

    expect(mocks.loadWorkspaceImageStyle).toHaveBeenCalledWith(expect.anything(), input.workspaceId)
    expect(mocks.composeNeutralImagePrompt).toHaveBeenCalledWith(expect.objectContaining({ workspaceStyle: style }))
  })

  it('attaches the style reference photos to the provider call', async () => {
    const refId = '60000000-0000-4000-8000-000000000009'
    const refs = [{ bytes: new Uint8Array([1]), mimeType: 'image/png' }]
    mocks.loadActiveByreumImageHarness.mockResolvedValue(null)
    mocks.loadWorkspaceImageStyle.mockResolvedValue({ subject: '네일', mood: '', setting: '', lookAndColor: '', people: 'any', avoid: [], extra: '', composition: '', guide: '', referenceAssetIds: [refId], referenceNotes: {} })
    mocks.loadReferenceImages.mockResolvedValue(refs)

    await generateContentImageAction(input)

    expect(mocks.loadReferenceImages).toHaveBeenCalledWith(expect.anything(), input.workspaceId, [refId])
    expect(mocks.generate).toHaveBeenCalledWith({ prompt: 'NEUTRAL_COMPOSED_PROMPT', size: '1024x1536', references: refs })
  })

  it('fails safely and avoids calling provider when some requested reference photos fail to load', async () => {
    const ref1 = '60000000-0000-4000-8000-000000000001'
    const ref2 = '60000000-0000-4000-8000-000000000002'
    mocks.loadActiveByreumImageHarness.mockResolvedValue(null)
    mocks.loadWorkspaceImageStyle.mockResolvedValue({ subject: '네일', mood: '', setting: '', lookAndColor: '', people: 'any', avoid: [], extra: '', composition: '', guide: '', referenceAssetIds: [ref1, ref2], referenceNotes: {} })
    mocks.loadReferenceImages.mockResolvedValue([{ bytes: new Uint8Array([1]), mimeType: 'image/png' }])

    const result = await generateContentImageAction(input)

    expect(result).toEqual({
      error: {
        message: '기준 사진을 불러오거나 반영하지 못했어요. 사진을 확인하고 다시 시도해 주세요.',
        requestId: 'content-image-generation',
      },
    })
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('returns safe reference failure message when provider fails with IMAGE_REFERENCE_UNAVAILABLE', async () => {
    const refId = '60000000-0000-4000-8000-000000000009'
    const refs = [{ bytes: new Uint8Array([1]), mimeType: 'image/png' }]
    mocks.loadActiveByreumImageHarness.mockResolvedValue(null)
    mocks.loadWorkspaceImageStyle.mockResolvedValue({ subject: '네일', mood: '', setting: '', lookAndColor: '', people: 'any', avoid: [], extra: '', composition: '', guide: '', referenceAssetIds: [refId], referenceNotes: {} })
    mocks.loadReferenceImages.mockResolvedValue(refs)
    mocks.generate.mockRejectedValueOnce(new OpenAIImageProviderError('AI 이미지를 안전하게 처리하지 못했습니다.', 'IMAGE_REFERENCE_UNAVAILABLE'))

    const result = await generateContentImageAction(input)

    expect(result).toEqual({
      error: {
        message: '기준 사진을 불러오거나 반영하지 못했어요. 사진을 확인하고 다시 시도해 주세요.',
        requestId: 'content-image-generation',
      },
    })
  })

  it('fails-closed with reference error without calling provider when loadReferenceImages throws on file read failure', async () => {
    const refId = '60000000-0000-4000-8000-000000000009'
    mocks.loadActiveByreumImageHarness.mockResolvedValue(null)
    mocks.loadWorkspaceImageStyle.mockResolvedValue({ subject: '네일', mood: '', setting: '', lookAndColor: '', people: 'any', avoid: [], extra: '', composition: '', guide: '', referenceAssetIds: [refId], referenceNotes: {} })
    mocks.loadReferenceImages.mockRejectedValueOnce(new Error('Storage download network timeout'))

    const result = await generateContentImageAction(input)

    expect(result).toEqual({
      error: {
        message: '기준 사진을 불러오거나 반영하지 못했어요. 사진을 확인하고 다시 시도해 주세요.',
        requestId: 'content-image-generation',
      },
    })
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('rejects immediately without calling provider when loaded reference photo has zero-byte data', async () => {
    const refId = '60000000-0000-4000-8000-000000000009'
    mocks.loadActiveByreumImageHarness.mockResolvedValue(null)
    mocks.loadWorkspaceImageStyle.mockResolvedValue({ subject: '네일', mood: '', setting: '', lookAndColor: '', people: 'any', avoid: [], extra: '', composition: '', guide: '', referenceAssetIds: [refId], referenceNotes: {} })
    mocks.loadReferenceImages.mockResolvedValueOnce([{ bytes: new Uint8Array(0), mimeType: 'image/png' }])

    const result = await generateContentImageAction(input)

    expect(result).toEqual({
      error: {
        message: '기준 사진을 불러오거나 반영하지 못했어요. 사진을 확인하고 다시 시도해 주세요.',
        requestId: 'content-image-generation',
      },
    })
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('rejects immediately when delivered reference files count does not match referenceAssetIds count', async () => {
    const ref1 = '60000000-0000-4000-8000-000000000001'
    mocks.loadActiveByreumImageHarness.mockResolvedValue(null)
    mocks.loadWorkspaceImageStyle.mockResolvedValue({ subject: '네일', mood: '', setting: '', lookAndColor: '', people: 'any', avoid: [], extra: '', composition: '', guide: '', referenceAssetIds: [ref1], referenceNotes: {} })
    mocks.loadReferenceImages.mockResolvedValueOnce([
      { bytes: new Uint8Array([1]), mimeType: 'image/png' },
      { bytes: new Uint8Array([2]), mimeType: 'image/png' },
    ])

    const result = await generateContentImageAction(input)

    expect(result).toEqual({
      error: {
        message: '기준 사진을 불러오거나 반영하지 못했어요. 사진을 확인하고 다시 시도해 주세요.',
        requestId: 'content-image-generation',
      },
    })
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('fails-closed and enforces ownership isolation when foreign workspace references are filtered out', async () => {
    const foreignRefId = '60000000-0000-4000-8000-999999999999'
    mocks.loadActiveByreumImageHarness.mockResolvedValue(null)
    mocks.loadWorkspaceImageStyle.mockResolvedValue({ subject: '네일', mood: '', setting: '', lookAndColor: '', people: 'any', avoid: [], extra: '', composition: '', guide: '', referenceAssetIds: [foreignRefId], referenceNotes: {} })
    mocks.loadReferenceImages.mockResolvedValueOnce([])

    const result = await generateContentImageAction(input)

    expect(result).toEqual({
      error: {
        message: '기준 사진을 불러오거나 반영하지 못했어요. 사진을 확인하고 다시 시도해 주세요.',
        requestId: 'content-image-generation',
      },
    })
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('never falls back to plain generation when provider fails during reference image generation', async () => {
    const refId = '60000000-0000-4000-8000-000000000009'
    const refs = [{ bytes: new Uint8Array([1]), mimeType: 'image/png' }]
    mocks.loadActiveByreumImageHarness.mockResolvedValue(null)
    mocks.loadWorkspaceImageStyle.mockResolvedValue({ subject: '네일', mood: '', setting: '', lookAndColor: '', people: 'any', avoid: [], extra: '', composition: '', guide: '', referenceAssetIds: [refId], referenceNotes: {} })
    mocks.loadReferenceImages.mockResolvedValue(refs)
    mocks.generate.mockRejectedValueOnce(new OpenAIImageProviderError('AI 이미지를 안전하게 처리하지 못했습니다.', 'IMAGE_REFERENCE_UNAVAILABLE'))

    await generateContentImageAction(input)

    expect(mocks.generate).toHaveBeenCalledTimes(1)
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ references: refs }))
  })

  it('uses the bundled Byreum harness for the test account while DB harness storage is pending', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'test@example.com' } },
      error: null,
    })
    mocks.loadActiveByreumImageHarness.mockRejectedValueOnce(new Error('PGRST205'))

    await expect(generateContentImageAction(input)).resolves.toEqual({
      data: { source: 'openai', assetId, rightsStatus: 'confirmed' },
    })
    expect(mocks.composeByreumImagePrompt).toHaveBeenCalledWith(expect.objectContaining({
      harness: { harnessId: 'BYREUM_RECOMMENDED_HARNESS_V1_0' },
      channel: 'instagram',
    }))
    expect(mocks.generate).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['missing content', null],
    [
      'stale fingerprint',
      { content_id: input.contentId, fingerprint: 'b'.repeat(64) },
    ],
  ])('rejects %s before constructing a provider', async (_label, version) => {
    mocks.versionMaybeSingle.mockResolvedValue({ data: version, error: null })

    await expect(generateContentImageAction(input)).resolves.toMatchObject({
      error: { requestId: 'content-image-generation-stale' },
    })
    expect(mocks.readOpenAIImageConfig).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  })
})
