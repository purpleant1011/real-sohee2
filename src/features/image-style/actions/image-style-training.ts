'use server'

import { Buffer } from 'node:buffer'
import { z } from 'zod'
import { createProductionConversationImageArtifact } from '@/features/chat/conversation-image-generation.server'
import type { ActionResult } from '@/lib/errors/result'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { authorizeManager, type ManagerAuth } from '../server/manager-auth'
import { storePrivateImage } from '../server/store-private-image'
import {
  analyzeReferenceImages,
  validateReferenceFiles,
} from '../reference-style-analysis'
import {
  normalizeWorkspaceImageStyleInput,
  type WorkspaceImageStyleForm,
} from '../workspace-image-style'

const requestId = 'image-style-training'
const PREVIEW_DAILY_LIMIT = 6
const ANALYSIS_DAILY_LIMIT = 20
const uuid = z.string().uuid()

function failure<T>(message: string): ActionResult<T> {
  return { error: { message, requestId } }
}

async function usedToday(workspaceId: string, eventType: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const result = await createAdminSupabaseClient()
    .from('audit_events')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('event_type', eventType)
    .gte('created_at', since)
  return result.count ?? 0
}

async function recordUse(workspaceId: string, userId: string, eventType: string): Promise<void> {
  await createAdminSupabaseClient().from('audit_events').insert({
    workspace_id: workspaceId,
    actor_id: userId,
    event_type: eventType,
    entity_type: 'workspace_image_style',
    metadata: {},
  })
}

/** 기준 사진을 비공개 저장소에 보관한다. 하나가 실패해도 나머지는 계속하고, 전부 실패해도 분석 결과는 돌려준다. */
async function storeReferencePhotos(
  workspaceId: string,
  auth: ManagerAuth,
  files: readonly File[],
  notes: readonly string[],
): Promise<Array<{ id: string; url: string; note: string }>> {
  const stored: Array<{ id: string; url: string; note: string }> = []
  for (const [index, file] of files.entries()) {
    const assetId = await storePrivateImage(workspaceId, auth, file)
    if (assetId) stored.push({ id: assetId, url: `/api/workspaces/${workspaceId}/media/${assetId}`, note: notes[index] ?? '' })
  }
  return stored
}

export async function analyzeReferenceImagesAction(
  formData: FormData,
): Promise<ActionResult<{ form: WorkspaceImageStyleForm & { analysis: string }; references: ReadonlyArray<{ id: string; url: string; note: string }> }>> {
  const workspaceId = uuid.safeParse(formData.get('workspaceId'))
  if (!workspaceId.success) return failure('작업공간을 확인해 주세요.')
  if (formData.get('rightsAcknowledged') !== 'true') {
    return failure('내가 사용할 수 있는 사진인지 확인해 주세요. (직접 찍었거나 사용 허락을 받은 사진)')
  }
  const files = formData.getAll('files').filter((entry): entry is File => entry instanceof File)
  const valid = validateReferenceFiles(files)
  if (!valid.ok) return failure(valid.message)

  try {
    const auth = await authorizeManager(workspaceId.data)
    if ('message' in auth) return failure(auth.message)
    if (await usedToday(workspaceId.data, 'image_style_analysis') >= ANALYSIS_DAILY_LIMIT) {
      return failure('오늘 사진 분석을 모두 썼어요. 내일 다시 시도해 주세요.')
    }
    const images = await Promise.all(files.map(async (file) => ({
      mimeType: file.type,
      base64: Buffer.from(await file.arrayBuffer()).toString('base64'),
    })))
    const form = await analyzeReferenceImages(images)
    await recordUse(workspaceId.data, auth.userId, 'image_style_analysis')
    const references = await storeReferencePhotos(workspaceId.data, auth, files, form.notes)
    return { data: { form, references } }
  } catch {
    return failure('사진의 느낌을 읽지 못했어요. 다른 사진으로 다시 시도하거나 직접 적어 주세요.')
  }
}

const previewSchema = z.object({
  workspaceId: uuid,
  subject: z.string().max(2_000),
  mood: z.string().max(2_000),
  setting: z.string().max(2_000),
  lookAndColor: z.string().max(2_000),
  people: z.string().max(20),
  avoid: z.string().max(4_000),
  extra: z.string().max(4_000),
  composition: z.string().max(2_000).optional(),
  guide: z.string().max(4_000).optional(),
  references: z.array(uuid).max(8).optional(),
  referenceNotes: z.record(uuid, z.string().max(200)).optional(),
  scene: z.string().max(300).optional(),
}).strict()

export async function previewImageStyleAction(
  input: unknown,
): Promise<ActionResult<{ assetId: string; previewUrl: string; remainingToday: number }>> {
  const parsed = previewSchema.safeParse(input)
  if (!parsed.success) return failure('입력 내용을 확인해 주세요.')
  const { workspaceId, scene, ...form } = parsed.data
  const normalized = normalizeWorkspaceImageStyleInput(form)
  if (!normalized.ok) return failure(normalized.message)

  try {
    const auth = await authorizeManager(workspaceId)
    if ('message' in auth) return failure(auth.message)

    const referenceIds = normalized.style.referenceAssetIds
    if (referenceIds.length > 0) {
      const admin = createAdminSupabaseClient()
      const owned = await admin
        .from('media_assets')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('rights_status', 'confirmed')
        .in('id', referenceIds)
      if (owned.error || !Array.isArray(owned.data) || owned.data.length !== referenceIds.length) {
        return failure('기준 사진을 다시 확인해 주세요. 이 작업공간의 사진만 쓸 수 있어요.')
      }
    }

    const used = await usedToday(workspaceId, 'image_style_preview')
    if (used >= PREVIEW_DAILY_LIMIT) return failure('오늘 만들 수 있는 시안을 모두 썼어요. 내일 다시 만들어 보세요.')

    const artifact = await createProductionConversationImageArtifact({
      workspaceId,
      userId: auth.userId,
      prompt: scene?.trim()
        ? `이 장면을 그려 주세요: ${scene.trim()}`
        : '이 스타일로 우리 매장 인스타그램에 올릴 대표 이미지 시안',
      channel: 'instagram',
      workspaceStyleOverride: normalized.style,
    })
    await recordUse(workspaceId, auth.userId, 'image_style_preview')
    return { data: { assetId: artifact.id, previewUrl: artifact.previewUrl, remainingToday: PREVIEW_DAILY_LIMIT - used - 1 } }
  } catch {
    return failure('시안을 만들지 못했어요. 잠시 후 다시 시도해 주세요.')
  }
}
