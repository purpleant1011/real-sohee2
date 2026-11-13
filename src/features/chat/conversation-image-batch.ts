import type { ConversationImageCount } from './conversation-image-intent'

export type ImageSlideRole = 'cover' | 'detail' | 'proof' | 'action'
export type ImageSlideStatus = 'succeeded' | 'failed' | 'cancelled'
export type SafeImageErrorCode =
  | 'IMAGE_PROVIDER_UNAVAILABLE'
  | 'IMAGE_POLICY_REJECTED'
  | 'IMAGE_RETRYABLE'
  | 'IMAGE_AUTH_REQUIRED'
  | 'IMAGE_QUOTA_EXHAUSTED'
  | 'IMAGE_RATE_LIMITED'
  | 'IMAGE_MODEL_UNAVAILABLE'
  | 'IMAGE_PROMPT_INVALID'

export type GeneratedSlide = Readonly<{
  id: string
  position: number
  role: ImageSlideRole
  status: ImageSlideStatus
  mediaAssetId: string | null
  altText: string
  retryable: boolean
  safeErrorCode: SafeImageErrorCode | null
}>

export type GeneratedImageBatch = Readonly<{
  idempotencyKey: string
  status: 'ready_for_review' | 'partial' | 'failed' | 'cancelled'
  requestedCount: ConversationImageCount
  startedCount: number
  succeededCount: number
  failedCount: number
  slides: readonly GeneratedSlide[]
}>

type GenerateSlide = (input: Readonly<{
  prompt: string
  position: number
  role: ImageSlideRole
  slideId: string
  signal?: AbortSignal
}>) => Promise<Readonly<{ mediaAssetId: string; altText: string }>>

type GenerateImageBatchInput = Readonly<{
  count: ConversationImageCount
  prompt: string
  slidePrompts?: readonly string[]
  idempotencyKey: string
  createSlideId(position: number): string
  generate: GenerateSlide
  loadExisting?(idempotencyKey: string): Promise<GeneratedImageBatch | null>
  signal?: AbortSignal
}>

type RetryFailedSlidesInput = Readonly<{
  batch: GeneratedImageBatch
  generate: GenerateSlide
  signal?: AbortSignal
}>

type RegenerateSelectedSlideInput = Readonly<{
  batch: GeneratedImageBatch
  selectedSlideId: string
  generate: GenerateSlide
  idempotencyKey?: string
  signal?: AbortSignal
}>

const safeCodes = new Set<SafeImageErrorCode>([
  'IMAGE_PROVIDER_UNAVAILABLE',
  'IMAGE_POLICY_REJECTED',
  'IMAGE_RETRYABLE',
  'IMAGE_AUTH_REQUIRED',
  'IMAGE_QUOTA_EXHAUSTED',
  'IMAGE_RATE_LIMITED',
  'IMAGE_MODEL_UNAVAILABLE',
  'IMAGE_PROMPT_INVALID',
])

function roleFor(position: number, count: number): ImageSlideRole {
  if (position === 1) return 'cover'
  if (position === count) return 'action'
  return 'detail'
}

function safeFailure(error: unknown): Readonly<{
  code: SafeImageErrorCode
  retryable: boolean
}> {
  const candidate = error && typeof error === 'object' && 'code' in error
    ? error.code
    : null
  const code = typeof candidate === 'string' && safeCodes.has(candidate as SafeImageErrorCode)
    ? candidate as SafeImageErrorCode
    : 'IMAGE_RETRYABLE'
  return Object.freeze({
    code,
    retryable: ![
      'IMAGE_POLICY_REJECTED',
      'IMAGE_AUTH_REQUIRED',
      'IMAGE_QUOTA_EXHAUSTED',
      'IMAGE_MODEL_UNAVAILABLE',
      'IMAGE_PROMPT_INVALID',
    ].includes(code),
  })
}

function cancelledSlide(input: {
  id: string
  position: number
  role: ImageSlideRole
}): GeneratedSlide {
  return Object.freeze({
    ...input,
    status: 'cancelled',
    mediaAssetId: null,
    altText: '',
    retryable: false,
    safeErrorCode: null,
  })
}

function summarize(
  idempotencyKey: string,
  requestedCount: ConversationImageCount,
  slides: readonly GeneratedSlide[],
): GeneratedImageBatch {
  const succeededCount = slides.filter((slide) => slide.status === 'succeeded').length
  const failedCount = slides.filter((slide) => slide.status === 'failed').length
  const startedCount = succeededCount + failedCount
  const status = succeededCount === requestedCount
    ? 'ready_for_review'
    : succeededCount > 0
      ? 'partial'
      : startedCount === 0
        ? 'cancelled'
        : 'failed'

  return Object.freeze({
    idempotencyKey,
    status,
    requestedCount,
    startedCount,
    succeededCount,
    failedCount,
    slides: Object.freeze([...slides]),
  })
}

async function generateSlide(input: {
  id: string
  position: number
  role: ImageSlideRole
  prompt: string
  generate: GenerateSlide
  signal?: AbortSignal
}): Promise<GeneratedSlide> {
  if (input.signal?.aborted) {
    return cancelledSlide(input)
  }

  try {
    const generated = await input.generate({
      prompt: input.prompt,
      position: input.position,
      role: input.role,
      slideId: input.id,
      ...(input.signal ? { signal: input.signal } : {}),
    })
    return Object.freeze({
      id: input.id,
      position: input.position,
      role: input.role,
      status: 'succeeded',
      mediaAssetId: generated.mediaAssetId,
      altText: generated.altText,
      retryable: false,
      safeErrorCode: null,
    })
  } catch (error) {
    if (input.signal?.aborted) return cancelledSlide(input)
    const failure = safeFailure(error)
    return Object.freeze({
      id: input.id,
      position: input.position,
      role: input.role,
      status: 'failed',
      mediaAssetId: null,
      altText: '',
      retryable: failure.retryable,
      safeErrorCode: failure.code,
    })
  }
}

export async function generateImageBatch(
  input: GenerateImageBatchInput,
): Promise<GeneratedImageBatch> {
  const existing = await input.loadExisting?.(input.idempotencyKey)
  if (existing) return existing

  const slides: GeneratedSlide[] = []
  for (let index = 0; index < input.count; index += 1) {
    const position = index + 1
    const id = input.createSlideId(position)
    const role = roleFor(position, input.count)
    slides.push(await generateSlide({
      id,
      position,
      role,
      prompt: input.slidePrompts?.[position - 1] ?? input.prompt,
      generate: input.generate,
      ...(input.signal ? { signal: input.signal } : {}),
    }))
  }

  return summarize(input.idempotencyKey, input.count, slides)
}

export async function retryFailedSlides(
  input: RetryFailedSlidesInput,
): Promise<GeneratedImageBatch> {
  const slides: GeneratedSlide[] = []
  for (const slide of input.batch.slides) {
    if (slide.status !== 'failed' || !slide.retryable) {
      slides.push(slide)
      continue
    }
    slides.push(await generateSlide({
      id: slide.id,
      position: slide.position,
      role: slide.role,
      prompt: `기존 결과물의 ${slide.position}번 이미지만 다시 생성합니다.`,
      generate: input.generate,
      ...(input.signal ? { signal: input.signal } : {}),
    }))
  }

  return summarize(input.batch.idempotencyKey, input.batch.requestedCount, slides)
}

export async function regenerateSelectedSlide(
  input: RegenerateSelectedSlideInput,
): Promise<GeneratedImageBatch> {
  const selected = input.batch.slides.find((slide) => slide.id === input.selectedSlideId)
  if (!selected) throw new Error('IMAGE_SLIDE_NOT_FOUND')

  const replacement = await generateSlide({
    id: selected.id,
    position: selected.position,
    role: selected.role,
    prompt: `기존 결과물의 ${selected.position}번 이미지만 다시 생성합니다.`,
    generate: input.generate,
    ...(input.signal ? { signal: input.signal } : {}),
  })
  const slides = input.batch.slides.map((slide) =>
    slide.id === selected.id ? replacement : slide,
  )
  return summarize(
    input.idempotencyKey ?? input.batch.idempotencyKey,
    input.batch.requestedCount,
    slides,
  )
}
