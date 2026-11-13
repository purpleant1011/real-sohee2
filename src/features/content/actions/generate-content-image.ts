'use server'

import OpenAI from 'openai'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { BYREUM_IMAGE_HARNESS, composeByreumImagePrompt } from '@/features/harness/byreum-image-harness'
import { isByreumTestAccount, loadActiveByreumImageHarness } from '@/features/harness/byreum-image-harness-repository'
import {
  loadReferenceImages,
  type LoadedReferenceImage,
} from '@/features/image-style/reference-images'
import { loadWorkspaceImageStyle } from '@/features/image-style/workspace-image-style-repository'
import { composeNeutralImagePrompt } from '@/features/harness/neutral-image-prompt'
import { readOpenAIImageConfig } from '@/lib/openai/server-env'
import {
  createOpenAIImageProvider,
  OpenAIImageProviderError,
} from '@/lib/providers/openai-image-provider'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { currentVersionFingerprintSchema } from '../version-schema'
import { uploadContentMediaAction } from './upload-content-media'

const requestId = 'content-image-generation'
const inputSchema = z.object({
  workspaceId: z.string().uuid(),
  contentId: z.string().uuid(),
  versionId: z.string().uuid(),
  currentVersionFingerprint: currentVersionFingerprintSchema,
  prompt: z.string().trim().min(1).max(1_500),
  channel: z.enum(['instagram', 'threads', 'naver_blog']),
})

type GeneratedImage = Readonly<{
  source: 'openai'
  assetId: string
  rightsStatus: 'confirmed'
}>

function failure(message: string, id = requestId): ActionResult<GeneratedImage> {
  return { error: { message, requestId: id } }
}

function copyAsArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

export async function generateContentImageAction(
  input: unknown,
): Promise<ActionResult<GeneratedImage>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return failure('이미지 생성 지시 내용을 확인해 주세요.')

  try {
    const supabase = await createServerSupabaseClient()
    const { data: userData, error: userError } = await supabase.auth.getUser()
    const userId = userData?.user?.id
    if (userError || typeof userId !== 'string' || userId.length === 0) {
      return failure('로그인 후 다시 시도해 주세요.')
    }

    const { data: membership, error: membershipError } = await supabase
      .from('workspace_members')
      .select('role, status')
      .eq('workspace_id', parsed.data.workspaceId)
      .eq('user_id', userId)
      .maybeSingle()
    if (
      membershipError ||
      membership?.status !== 'active' ||
      (membership.role !== 'owner' && membership.role !== 'manager')
    ) {
      return failure('이 작업공간에서는 AI 이미지를 생성할 수 없습니다.')
    }

    const { data: version, error: versionError } = await supabase
      .from('content_versions')
      .select('content_id, fingerprint')
      .eq('workspace_id', parsed.data.workspaceId)
      .eq('content_id', parsed.data.contentId)
      .eq('id', parsed.data.versionId)
      .maybeSingle()
    if (
      versionError ||
      version?.content_id !== parsed.data.contentId ||
      version?.fingerprint !== parsed.data.currentVersionFingerprint
    ) {
      return failure(
        '최신 버전을 다시 열고 이미지를 생성해 주세요.',
        'content-image-generation-stale',
      )
    }

    const activeHarness = await loadActiveByreumImageHarness({
      client: supabase,
      workspaceId: parsed.data.workspaceId,
      channel: parsed.data.channel,
    }).catch(() => null)
    const visibleHarness = activeHarness?.harness
      ?? (isByreumTestAccount(userData.user?.email) ? BYREUM_IMAGE_HARNESS : null)
    // 전용 하네스가 없는 작업공간도 막지 않고, 대화 이미지 생성과 같은 중립 프롬프트로 만든다.
    const workspaceStyle = visibleHarness === null
      ? await loadWorkspaceImageStyle(supabase, parsed.data.workspaceId)
      : null
    const composedPrompt = visibleHarness === null
      ? composeNeutralImagePrompt({
          channel: parsed.data.channel,
          userPrompt: parsed.data.prompt,
          workspaceStyle,
        })
      : composeByreumImagePrompt({
          harness: visibleHarness,
          channel: parsed.data.channel,
          userPrompt: parsed.data.prompt,
        })

    const config = readOpenAIImageConfig()
    const provider = createOpenAIImageProvider(new OpenAI({ apiKey: config.apiKey }), config.model)
    const requestedReferenceIds = workspaceStyle && workspaceStyle.referenceAssetIds.length > 0
      ? Array.from(new Set(workspaceStyle.referenceAssetIds.filter((id) => typeof id === 'string' && id.length > 0)))
      : []
    let references: LoadedReferenceImage[] = []
    if (requestedReferenceIds.length > 0) {
      try {
        references = await loadReferenceImages(
          createAdminSupabaseClient(),
          parsed.data.workspaceId,
          requestedReferenceIds,
        )
      } catch {
        return failure('기준 사진을 불러오거나 반영하지 못했어요. 사진을 확인하고 다시 시도해 주세요.')
      }
      if (
        references.length !== requestedReferenceIds.length ||
        references.some((reference) => !reference.bytes || reference.bytes.byteLength === 0)
      ) {
        return failure('기준 사진을 불러오거나 반영하지 못했어요. 사진을 확인하고 다시 시도해 주세요.')
      }
    }
    const generated = await provider.generate({
      prompt: composedPrompt,
      size: '1024x1536',
      ...(references.length > 0 ? { references } : {}),
    })
    const file = new File(
      [copyAsArrayBuffer(generated.bytes)],
      'sohee-byreum-harness-draft.png',
      { type: generated.mimeType },
    )
    const upload = new FormData()
    upload.set('workspaceId', parsed.data.workspaceId)
    upload.set('file', file)
    upload.set('rightsAcknowledged', 'true')
    const uploaded = await uploadContentMediaAction(upload)
    if (uploaded.error) return failure(uploaded.error.message)

    revalidatePath(`/app/work/${parsed.data.contentId}/edit`)
    return {
      data: {
        source: 'openai',
        assetId: uploaded.data.assetId,
        rightsStatus: 'confirmed',
      },
    }
  } catch (error) {
    if (
      error instanceof OpenAIImageProviderError &&
      error.code === 'IMAGE_REFERENCE_UNAVAILABLE'
    ) {
      return failure('기준 사진을 불러오거나 반영하지 못했어요. 사진을 확인하고 다시 시도해 주세요.')
    }
    return failure('AI 이미지를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
}
