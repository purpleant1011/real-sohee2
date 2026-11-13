'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { uploadPrivateFileAction } from '@/features/knowledge/actions/upload-private-file'
import type { ActionResult } from '@/lib/errors/result'
import { recordPhotoUploaded } from '@/features/quick-start/first-value-observation'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const requestId = 'content-media-upload'
const uuidSchema = z.string().uuid()
type UploadedMedia = Readonly<{ assetId: string; rightsStatus: 'confirmed' }>

function failure(message: string): ActionResult<UploadedMedia> {
  return { error: { message, requestId } }
}

export async function uploadContentMediaAction(
  source: FormData,
): Promise<ActionResult<UploadedMedia>> {
  try {
    const workspaceId = source.get('workspaceId')
    const file = source.get('file')
    const rightsAcknowledged = source.get('rightsAcknowledged')
    const parsedWorkspaceId = uuidSchema.safeParse(workspaceId)

    if (
      !parsedWorkspaceId.success ||
      rightsAcknowledged !== 'true' ||
      (typeof file !== 'object' && typeof file !== 'function') ||
      file === null
    ) {
      return failure('파일과 사용권 확인 내용을 확인해 주세요.')
    }

    const uploadInput = new FormData()
    uploadInput.set('workspaceId', parsedWorkspaceId.data)
    uploadInput.set('bucket', 'content-media')
    uploadInput.set('file', file as Blob)
    const uploaded = await uploadPrivateFileAction(uploadInput)
    if (uploaded.error) return failure(uploaded.error.message)

    const supabase = await createServerSupabaseClient()
    const { data: userData, error: userError } = await supabase.auth.getUser()
    const userId = userData?.user?.id
    if (userError || typeof userId !== 'string' || userId.length === 0) {
      return failure('파일은 보관했지만 사용권을 확인하지 못했습니다. 다시 로그인해 주세요.')
    }

    const { data: membership, error: membershipError } = await supabase
      .from('workspace_members')
      .select('role, status')
      .eq('workspace_id', parsedWorkspaceId.data)
      .eq('user_id', userId)
      .maybeSingle()

    if (
      membershipError ||
      membership?.status !== 'active' ||
      (membership.role !== 'owner' && membership.role !== 'manager')
    ) {
      return failure('파일은 안전하게 보관했습니다. 작업공간 관리자가 사용권을 확인해 주세요.')
    }

    const { data: confirmed, error: confirmError } = await supabase
      .from('media_assets')
      .update({ rights_status: 'confirmed' })
      .eq('workspace_id', parsedWorkspaceId.data)
      .eq('id', uploaded.data.assetId)
      .eq('kind', 'content')
      .eq('rights_status', 'pending')
      .select('id')
      .maybeSingle()
    const confirmedId = uuidSchema.safeParse(confirmed?.id)
    if (confirmError || !confirmedId.success || confirmedId.data !== uploaded.data.assetId) {
      return failure('파일은 보관했지만 사용권 확인을 완료하지 못했습니다.')
    }

    // ANI-1602: funnel_events is service-role only; an observation failure must never fail the upload.
    try {
      await recordPhotoUploaded({ admin: createAdminSupabaseClient() as never, workspaceId: parsedWorkspaceId.data, userId, assetId: confirmedId.data })
    } catch {
      console.warn('[content-media] funnel observation skipped')
    }

    revalidatePath('/app/work')
    return { data: { assetId: confirmedId.data, rightsStatus: 'confirmed' } }
  } catch {
    return failure('미디어를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
}
