import { randomUUID } from 'node:crypto'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { uploadValidatedPrivateFile } from '@/lib/supabase/validated-upload'
import { createValidatedUploadRepository } from '@/lib/supabase/validated-upload-repository'
import type { ManagerAuth } from './manager-auth'

/** 이미지 한 장을 비공개 저장소에 올리고 권리 확인 상태로 등록한다. 실패하면 null. */
export async function storePrivateImage(
  workspaceId: string,
  auth: ManagerAuth,
  file: File,
): Promise<string | null> {
  try {
    const admin = createAdminSupabaseClient()
    const assetId = randomUUID()
    const uploaded = await uploadValidatedPrivateFile({
      workspaceId, userId: auth.userId, resourceId: assetId, bucket: 'content-media', role: auth.role, file,
    }, createValidatedUploadRepository(admin))
    if (!uploaded.ok) return null
    const confirmed = await admin.from('media_assets')
      .update({ rights_status: 'confirmed' })
      .eq('workspace_id', workspaceId)
      .eq('id', assetId)
      .eq('rights_status', 'pending')
      .select('id')
      .maybeSingle()
    if (confirmed.error || confirmed.data?.id === undefined) return null
    return assetId
  } catch {
    return null
  }
}
