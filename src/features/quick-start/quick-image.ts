import { randomUUID } from 'node:crypto'
import { DefaultOpenAIImageClient, type OpenAIImageClient } from '@/features/creative/openai-image-client'
import { buildPrivateObjectPath } from '@/lib/supabase/storage'
import { sanitizeBusinessText } from './sanitize-business-text'

type AdminClient = any

export interface QuickImageContext {
  businessName: string
  industry: string
  location?: string
  summary?: string
  topic: string
  feedback?: string
}

export function buildQuickImagePrompt(ctx: QuickImageContext): string {
  const lines = [
    '한국 소상공인 매장의 인스타그램 피드용 정사각형 사진을 만들어 주세요.',
    `업종: ${sanitizeBusinessText(ctx.industry, 200)}`,
    ctx.location ? `지역: ${sanitizeBusinessText(ctx.location, 200)}` : '',
    `매장 소개: ${sanitizeBusinessText(ctx.summary ?? ctx.businessName, 500)}`,
    `이번 게시물 주제: ${sanitizeBusinessText(ctx.topic, 300)}`,
    ctx.feedback ? `사장님 수정 요청: ${sanitizeBusinessText(ctx.feedback, 300)}` : '',
    '',
    '[스타일 지침]',
    '- 실제로 촬영한 듯한 자연스러운 사진, 밝고 따뜻한 자연광, 깔끔한 구도',
    '- 이미지 안에 글자, 로고, 워터마크, 가격표, 전화번호를 넣지 않기',
    '- 특정 브랜드/유명인/캐릭터를 연상시키는 요소 금지',
    '- 사람이 나오더라도 얼굴을 또렷하게 클로즈업하지 않기',
  ]
  return lines.join('\n')
}

export interface PersistedQuickImage {
  assetId: string
  objectPath: string
  sha256Digest: string
  model: string
  mimeType: string
  sizeBytes: number
}

/** Generates one image with the OpenAI image model and stores it as a publishable media asset. */
export async function generateAndStoreQuickImage(params: {
  admin: AdminClient
  workspaceId: string
  userId: string
  context: QuickImageContext
  imageClient?: OpenAIImageClient
}): Promise<PersistedQuickImage> {
  const { admin, workspaceId, userId, context } = params
  const client =
    params.imageClient ?? new DefaultOpenAIImageClient(undefined, process.env.OPENAI_IMAGE_MODEL || undefined)

  const generated = await client.generateImage({
    prompt: buildQuickImagePrompt(context),
    size: '1024x1024',
    quality: 'medium',
    outputFormat: 'jpeg', // Instagram accepts JPEG only; Threads/Naver/Daangn accept it too
  })

  const assetId = randomUUID()
  const objectPath = buildPrivateObjectPath({
    workspaceId,
    userId,
    resourceId: assetId,
    filename: 'quick-post.jpg',
  })

  const upload = await admin.storage.from('content-media').upload(objectPath, generated.bytes, {
    contentType: generated.mimeType,
    upsert: false,
  })
  if (upload.error) throw new Error(`[QUICK_IMAGE_UPLOAD] ${upload.error.message}`)

  const { error } = await admin.from('media_assets').insert({
    id: assetId,
    workspace_id: workspaceId,
    bucket_id: 'content-media',
    object_path: objectPath,
    kind: 'content',
    mime_type: generated.mimeType,
    size_bytes: generated.bytes.byteLength,
    rights_status: 'confirmed',
    created_by: userId,
    sha256_digest: generated.sha256Digest,
    provenance_kind: 'GENERATED_OPENAI',
    width: 1024,
    height: 1024,
    lifecycle_status: 'READY',
    publish_eligibility: true,
    generation_metadata: {
      model: generated.model,
      providerRequestId: generated.providerRequestId,
      source: 'quick-post',
      topic: context.topic,
    },
  })
  if (error) {
    await admin.storage.from('content-media').remove([objectPath]).catch(() => undefined)
    const recordError = new Error(`[QUICK_IMAGE_RECORD] ${error.message}`) as Error & {
      providerRequestId?: string
      model?: string
      sha256Digest?: string
    }
    recordError.providerRequestId = generated.providerRequestId ?? undefined
    recordError.model = generated.model
    recordError.sha256Digest = generated.sha256Digest
    throw recordError
  }

  return { assetId, objectPath, sha256Digest: generated.sha256Digest, model: generated.model, mimeType: generated.mimeType, sizeBytes: generated.bytes.byteLength }
}
