import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  single: vi.fn(),
  batch: vi.fn(),
  harness: vi.fn(),
  providerGenerate: vi.fn(),
  loadReferenceImages: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('openai', () => ({ default: class OpenAI {} }))
vi.mock('@/lib/openai/server-env', () => ({ readOpenAIImageConfig: () => ({ apiKey: 'test-only-image-key', model: 'gpt-image-2.5-sunburst' }) }))
vi.mock('@/lib/providers/openai-image-provider', () => ({
  createOpenAIImageProvider: () => ({ generate: mocks.providerGenerate }),
  OpenAIImageProviderError: class OpenAIImageProviderError extends Error {
    readonly code: string
    constructor(message = 'AI 이미지를 안전하게 처리하지 못했습니다.', code = 'IMAGE_PROVIDER_UNAVAILABLE') {
      super(message)
      this.name = 'OpenAIImageProviderError'
      this.code = code
    }
  },
}))
vi.mock('@/features/image-style/reference-images', () => ({ loadReferenceImages: mocks.loadReferenceImages }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: () => ({}) }))
vi.mock('@/features/harness/byreum-image-harness-repository', () => ({ loadActiveByreumImageHarness: mocks.harness, isByreumTestAccount: () => false }))
vi.mock('./conversation-image-generation', () => ({ generateConversationImageArtifact: mocks.single, generateConversationImageBatchArtifacts: mocks.batch }))
import { createProductionConversationImageArtifact, createProductionConversationImageBatchArtifacts } from './conversation-image-generation.server'
const input = { workspaceId: '20000000-0000-4000-8000-000000000001', userId: '30000000-0000-4000-8000-000000000001', channel: 'instagram' as const, prompt: '검토용 합성 홍보 이미지' }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.harness.mockResolvedValue(null)
  mocks.providerGenerate.mockResolvedValue({ bytes: new Uint8Array([1]), mimeType: 'image/png' })
  mocks.loadReferenceImages.mockResolvedValue([])
})
describe('production image admission for ordinary workspaces', () => {
  it('allows the existing neutral prompt path for ordinary accounts without a test harness', async () => {
    await createProductionConversationImageArtifact(input)
    expect(mocks.single).toHaveBeenCalledWith(expect.objectContaining({ allowNeutralFallback: true }), expect.anything())
    await createProductionConversationImageBatchArtifacts({ ...input, count: 1, idempotencyKey: 'one' })
    expect(mocks.batch).toHaveBeenCalledWith(expect.objectContaining({ allowNeutralFallback: true }), expect.anything())
  })
  it('does not turn a failed policy lookup into permission to ignore stored rules', async () => {
    await createProductionConversationImageArtifact(input)
    const dependencies = mocks.single.mock.calls[0][1]
    mocks.harness.mockRejectedValueOnce(new Error('private database detail'))
    await expect(dependencies.loadHarness(input)).rejects.toThrow('CHAT_IMAGE_HARNESS_UNAVAILABLE')
  })
  it('preserves explicit strict-harness requests rather than silently enabling fallback', async () => {
    await createProductionConversationImageArtifact({ ...input, allowNeutralFallback: false })
    expect(mocks.single).toHaveBeenCalledWith(expect.objectContaining({ allowNeutralFallback: false }), expect.anything())
  })

  describe('reference photo handling in generate dependency', () => {
    it('aborts and does not call provider when requested reference photos fail to load completely', async () => {
      await createProductionConversationImageArtifact(input)
      const dependencies = mocks.single.mock.calls[0][1]
      mocks.loadReferenceImages.mockResolvedValueOnce([{ bytes: new Uint8Array([1]), mimeType: 'image/png' }])

      await expect(dependencies.generate({
        prompt: '카페 가을 신메뉴',
        size: '1024x1536',
        workspaceId: input.workspaceId,
        referenceAssetIds: ['ref-1', 'ref-2'],
      })).rejects.toMatchObject({
        code: 'IMAGE_REFERENCE_UNAVAILABLE',
      })
      expect(mocks.loadReferenceImages).toHaveBeenCalledWith(expect.anything(), input.workspaceId, ['ref-1', 'ref-2'])
      expect(mocks.providerGenerate).not.toHaveBeenCalled()
    })

    it('passes all loaded references to provider when every requested photo loads', async () => {
      await createProductionConversationImageArtifact(input)
      const dependencies = mocks.single.mock.calls[0][1]
      const refs = [
        { bytes: new Uint8Array([1]), mimeType: 'image/png' },
        { bytes: new Uint8Array([2]), mimeType: 'image/jpeg' },
      ]
      mocks.loadReferenceImages.mockResolvedValueOnce(refs)

      await dependencies.generate({
        prompt: '카페 가을 신메뉴',
        size: '1024x1536',
        workspaceId: input.workspaceId,
        referenceAssetIds: ['ref-1', 'ref-2'],
      })

      expect(mocks.providerGenerate).toHaveBeenCalledWith({
        prompt: '카페 가을 신메뉴',
        size: '1024x1536',
        references: refs,
      })
    })

    it('preserves plain generation without references when none are requested', async () => {
      await createProductionConversationImageArtifact(input)
      const dependencies = mocks.single.mock.calls[0][1]

      await dependencies.generate({
        prompt: '카페 가을 신메뉴',
        size: '1024x1536',
      })

      expect(mocks.loadReferenceImages).not.toHaveBeenCalled()
      expect(mocks.providerGenerate).toHaveBeenCalledWith({
        prompt: '카페 가을 신메뉴',
        size: '1024x1536',
      })
    })
  })
})
