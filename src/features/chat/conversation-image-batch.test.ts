import { describe, expect, it, vi } from 'vitest'
import {
  generateImageBatch,
  regenerateSelectedSlide,
  retryFailedSlides,
  type GeneratedImageBatch,
} from './conversation-image-batch'

const createSlideId = (position: number) => `slide-${position}`

describe('generateImageBatch', () => {
  it('generates slides sequentially so provider rate limits do not fail the whole set', async () => {
    let active = 0
    let maximumActive = 0
    const completed: number[] = []
    const result = await generateImageBatch({
      count: 3,
      prompt: '전체 이미지 생성',
      idempotencyKey: 'batch-sequential',
      createSlideId: (position) => `slide-${position}`,
      generate: async ({ position }) => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await Promise.resolve()
        completed.push(position)
        active -= 1
        return { mediaAssetId: `media-${position}`, altText: `${position}번 이미지` }
      },
    })

    expect(maximumActive).toBe(1)
    expect(completed).toEqual([1, 2, 3])
    expect(result).toMatchObject({ status: 'ready_for_review', succeededCount: 3 })
  })
  it('generates one to three slides in stable position order', async () => {
    const generate = vi.fn(async ({ position }: { position: number }) => ({
      mediaAssetId: `media-${position}`,
      altText: `${position}번 이미지`,
    }))

    const result = await generateImageBatch({
      count: 3,
      prompt: '눈썹 캐러셀을 만들어줘',
      idempotencyKey: 'request-1',
      createSlideId,
      generate,
    })

    expect(generate).toHaveBeenCalledTimes(3)
    expect(result.slides.map((slide) => slide.position)).toEqual([1, 2, 3])
    expect(result.slides.map((slide) => slide.role)).toEqual(['cover', 'detail', 'action'])
    expect(result.status).toBe('ready_for_review')
    expect(result).toMatchObject({
      requestedCount: 3,
      startedCount: 3,
      succeededCount: 3,
      failedCount: 0,
    })
  })

  it('preserves twelve Naver-ready image positions in one complete batch', async () => {
    const result = await generateImageBatch({
      count: 12,
      prompt: '네이버 블로그 상세 이미지 묶음',
      idempotencyKey: 'request-12',
      createSlideId,
      generate: async ({ position }) => {
        return { mediaAssetId: `media-${position}`, altText: `${position}번 이미지` }
      },
    })
    expect(result.requestedCount).toBe(12)
    expect(result.slides.map((slide) => slide.position)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1))
    expect(result.slides.at(-1)?.role).toBe('action')
  })

  it('preserves successful slides when one slide fails and retries only that slide', async () => {
    const generate = vi.fn(async ({ position }: { position: number }) => {
      if (position === 2) throw new Error('provider private detail')
      return { mediaAssetId: `media-${position}`, altText: `${position}번 이미지` }
    })
    const partial = await generateImageBatch({
      count: 3,
      prompt: '눈썹 캐러셀을 만들어줘',
      idempotencyKey: 'request-2',
      createSlideId,
      generate,
    })

    expect(partial.status).toBe('partial')
    expect(partial.slides[1]).toMatchObject({
      id: 'slide-2',
      status: 'failed',
      mediaAssetId: null,
      retryable: true,
      safeErrorCode: 'IMAGE_RETRYABLE',
    })

    const retryGenerate = vi.fn(async ({ position }: { position: number }) => ({
      mediaAssetId: `retried-media-${position}`,
      altText: `${position}번 재생성 이미지`,
    }))
    const retried = await retryFailedSlides({ batch: partial, generate: retryGenerate })

    expect(retryGenerate).toHaveBeenCalledTimes(1)
    expect(retryGenerate).toHaveBeenCalledWith(expect.objectContaining({ position: 2 }))
    expect(retried.status).toBe('ready_for_review')
    expect(retried.slides.map((slide) => slide.id)).toEqual(['slide-1', 'slide-2', 'slide-3'])
    expect(retried.slides.map((slide) => slide.mediaAssetId)).toEqual([
      'media-1',
      'retried-media-2',
      'media-3',
    ])
  })

  it('marks slides not started after cancellation without calling the provider', async () => {
    const controller = new AbortController()
    const generate = vi.fn(async ({ position }: { position: number }) => {
      controller.abort()
      return { mediaAssetId: `media-${position}`, altText: `${position}번 이미지` }
    })

    const result = await generateImageBatch({
      count: 3,
      prompt: '이미지를 만들어줘',
      idempotencyKey: 'request-3',
      createSlideId,
      generate,
      signal: controller.signal,
    })

    expect(generate).toHaveBeenCalledTimes(1)
    expect(result.slides.map((slide) => slide.status)).toEqual([
      'succeeded',
      'cancelled',
      'cancelled',
    ])
    expect(result.status).toBe('partial')
  })

  it('returns an existing batch for the same request key without new provider cost', async () => {
    const existing: GeneratedImageBatch = Object.freeze({
      idempotencyKey: 'request-4',
      status: 'ready_for_review',
      requestedCount: 1,
      startedCount: 1,
      succeededCount: 1,
      failedCount: 0,
      slides: Object.freeze([Object.freeze({
        id: 'existing-slide',
        position: 1,
        role: 'cover',
        status: 'succeeded',
        mediaAssetId: 'existing-media',
        altText: '기존 이미지',
        retryable: false,
        safeErrorCode: null,
      })]),
    })
    const generate = vi.fn()
    const loadExisting = vi.fn(async () => existing)

    await expect(generateImageBatch({
      count: 1,
      prompt: '이미지를 만들어줘',
      idempotencyKey: 'request-4',
      createSlideId,
      generate,
      loadExisting,
    })).resolves.toBe(existing)
    expect(loadExisting).toHaveBeenCalledWith('request-4')
    expect(generate).not.toHaveBeenCalled()
  })
})

describe('regenerateSelectedSlide', () => {
  it('replaces only the selected slide while preserving every slide id and other media', async () => {
    const original = await generateImageBatch({
      count: 3,
      prompt: '눈썹 캐러셀을 만들어줘',
      idempotencyKey: 'request-selected',
      createSlideId,
      generate: async ({ position }) => ({
        mediaAssetId: `media-${position}`,
        altText: `${position}번 이미지`,
      }),
    })
    const generate = vi.fn(async ({ position }: { position: number }) => ({
      mediaAssetId: `regenerated-media-${position}`,
      altText: `${position}번 재생성 이미지`,
    }))

    const regenerated = await regenerateSelectedSlide({
      batch: original,
      selectedSlideId: 'slide-2',
      generate,
    })

    expect(generate).toHaveBeenCalledTimes(1)
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ position: 2 }))
    expect(regenerated.slides.map((slide) => slide.id)).toEqual([
      'slide-1',
      'slide-2',
      'slide-3',
    ])
    expect(regenerated.slides.map((slide) => slide.mediaAssetId)).toEqual([
      'media-1',
      'regenerated-media-2',
      'media-3',
    ])
  })
})
