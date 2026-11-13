import { randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import { describe, expect, test, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { createOpenAIInstagramDraftProvider } from '@/features/chat/instagram-draft-provider'
import { generateConversationImageBatchArtifacts } from '@/features/chat/conversation-image-generation'
import { regenerateSelectedSlide } from '@/features/chat/conversation-image-batch'
import { BYREUM_IMAGE_HARNESS, composeByreumImagePrompt } from '@/features/harness/byreum-image-harness'
import { readOpenAIImageConfig } from '@/lib/openai/server-env'
import { createProductionTextClient } from '@/lib/ai/gemini-responses-adapter'
import { createOpenAIImageProvider } from '@/lib/providers/openai-image-provider'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'

describe('V0.7.1 OpenAI live release gate', () => {
  test('returns structured copy and exact 1, 2, 3 image batches, then regenerates only slide two', async () => {
    expect(process.env.SOHEE_OPENAI_LIVE).toBe('1')
    const imageConfig = readOpenAIImageConfig()
    // 텍스트는 Gemini, 이미지는 OpenAI(2.5 선버스트).
    const textProvider = createOpenAIInstagramDraftProvider(
      createProductionTextClient() as never,
      'gemini',
    )
    const imageProvider = createOpenAIImageProvider(
      new OpenAI({ apiKey: imageConfig.apiKey }),
      imageConfig.model,
    )

    const draft = await textProvider.generate({
      prompt: '자연스러운 눈썹 관리 상담을 안내하는 인스타그램 검토용 문안을 작성해 주세요.',
      channel: 'instagram',
      context: {
        businessName: '바이름',
        industry: '반영구 화장',
        location: '서울',
        businessSummary: '자연스러운 눈썹 디자인 상담을 제공합니다.',
        brandVoice: '차분하고 친절하며 과장하지 않는 말투',
        keywords: ['자연스러움', '상담', '검토'],
        prohibitedTerms: ['완벽 보장'],
      },
    })
    expect(draft.caption.length).toBeGreaterThan(0)
    expect(draft.cta.length).toBeGreaterThan(0)
    expect(draft.hashtags.every((item) => item.startsWith('#'))).toBe(true)
    expect(JSON.stringify(draft)).not.toContain('완벽 보장')

    let storedCount = 0
    const storedByteLengths: number[] = []
    const dependencies = {
      authorize: async () => ({ email: null, role: 'owner' as const }),
      loadHarness: async () => BYREUM_IMAGE_HARNESS,
      generate: (input: { prompt: string; size: '1024x1536' }) => imageProvider.generate(input),
      store: async ({ bytes, mimeType }: { bytes: Uint8Array; mimeType: 'image/png' }) => {
        expect(mimeType).toBe('image/png')
        expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        storedByteLengths.push(bytes.byteLength)
        storedCount += 1
        return { assetId: `live-asset-${storedCount}` }
      },
      createSlideId: (position: number) => `live-slide-${storedCount}-${position}-${randomUUID()}`,
    }

    const one = await generateConversationImageBatchArtifacts({
      workspaceId,
      userId,
      channel: 'instagram',
      count: 1,
      idempotencyKey: randomUUID(),
      prompt: '자연스러운 눈썹 관리 소개용 단일 세로 이미지. 글자 없이 검토용 초안으로 만들어 주세요.',
    }, dependencies)
    expect(one).toMatchObject({ requestedCount: 1, succeededCount: 1, failedCount: 0 })

    const longTwo = await generateConversationImageBatchArtifacts({
      workspaceId,
      userId,
      channel: 'instagram',
      count: 2,
      idempotencyKey: randomUUID(),
      prompt: '서울의 차분한 뷰티 스튜디오에서 자연스러운 눈썹 상담을 소개하는 두 장짜리 세로 캐러셀을 준비해 주세요. 첫 장은 전체 분위기와 눈썹이 잘 보이는 표지, 둘째 장은 과장된 전후 비교 없이 상담 전 확인할 점을 떠올릴 수 있는 다른 구도로 구성하고, 이미지 안에는 글자·가격·로고·예약 정보가 절대 보이지 않게 해 주세요.',
    }, dependencies)
    expect(longTwo).toMatchObject({ requestedCount: 2, succeededCount: 2, failedCount: 0 })
    expect(longTwo.slides.map((slide) => slide.position)).toEqual([1, 2])

    const three = await generateConversationImageBatchArtifacts({
      workspaceId,
      userId,
      channel: 'instagram',
      count: 3,
      idempotencyKey: randomUUID(),
      prompt: '자연스러운 눈썹 상담 흐름을 보여 주는 세 장 캐러셀. 글자 없는 검토용 초안으로 만들어 주세요.',
    }, dependencies)
    expect(three).toMatchObject({ requestedCount: 3, succeededCount: 3, failedCount: 0 })
    expect(three.slides.map((slide) => slide.position)).toEqual([1, 2, 3])

    const originalFirst = longTwo.slides[0]
    const originalSecond = longTwo.slides[1]
    const regenerated = await regenerateSelectedSlide({
      batch: longTwo,
      selectedSlideId: originalSecond!.id,
      idempotencyKey: randomUUID(),
      generate: async ({ position, role, prompt }) => {
        const generated = await imageProvider.generate({
          prompt: composeByreumImagePrompt({
            harness: BYREUM_IMAGE_HARNESS,
            channel: 'instagram',
            userPrompt: `${prompt}\n${position}번 ${role} 이미지만 새로운 구도로 다시 만드세요.`,
          }),
          size: '1024x1536',
        })
        expect([...generated.bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        storedByteLengths.push(generated.bytes.byteLength)
        storedCount += 1
        return { mediaAssetId: `live-asset-${storedCount}`, altText: '새 구도의 두 번째 이미지 초안' }
      },
    })
    expect(regenerated.slides[0]).toEqual(originalFirst)
    expect(regenerated.slides[1]?.id).toBe(originalSecond?.id)
    expect(regenerated.slides[1]?.mediaAssetId).not.toBe(originalSecond?.mediaAssetId)
    expect(regenerated).toMatchObject({ requestedCount: 2, succeededCount: 2, failedCount: 0 })
    expect(storedByteLengths).toHaveLength(7)
    expect(storedByteLengths.every((length) => length > 8)).toBe(true)
  }, 600_000)
})
