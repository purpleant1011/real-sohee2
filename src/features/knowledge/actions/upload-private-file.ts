'use server'

import { randomUUID } from 'node:crypto'
import type { ActionResult } from '@/lib/errors/result'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { uploadValidatedPrivateFile } from '@/lib/supabase/validated-upload'
import { createValidatedUploadRepository } from '@/lib/supabase/validated-upload-repository'
import type { PrivateStorageBucket } from '@/lib/supabase/storage'
import type { WorkspaceRole } from '@/features/auth/workspace-context'

const requestId = 'private-upload'
const workspaceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const nativeReflectApply = Reflect.apply
const nativeRegExpTest = RegExp.prototype.test

type UploadActionData = {
  assetId: string
  objectPath: string
  kind: 'content' | 'knowledge'
  status: 'pending' | 'checking'
}

function failure(message: string): ActionResult<UploadActionData> {
  return { error: { message, requestId } }
}

export async function uploadPrivateFileAction(
  formData: FormData,
): Promise<ActionResult<UploadActionData>> {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: userData, error: userError } = await supabase.auth.getUser()
    const userId = userData?.user?.id

    if (userError || typeof userId !== 'string' || userId.length === 0) {
      return failure('로그인 후 다시 시도해 주세요.')
    }

    const workspaceId = formData.get('workspaceId')
    const bucket = formData.get('bucket')
    const file = formData.get('file')

    if (
      typeof workspaceId !== 'string' ||
      !nativeReflectApply(nativeRegExpTest, workspaceIdPattern, [workspaceId]) ||
      (bucket !== 'content-media' && bucket !== 'knowledge-files') ||
      (typeof file !== 'object' && typeof file !== 'function') ||
      file === null
    ) {
      return failure('업로드할 파일 정보를 확인해 주세요.')
    }

    const { data: membership, error: membershipError } = await supabase
      .from('workspace_members')
      .select('role, status')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle()

    if (
      membershipError ||
      membership?.status !== 'active' ||
      !isUploadRole(membership.role)
    ) {
      return failure('이 작업공간에서는 파일을 업로드할 수 없습니다.')
    }

    const admin = createAdminSupabaseClient()
    const result = await uploadValidatedPrivateFile(
      {
        workspaceId,
        userId,
        resourceId: randomUUID(),
        bucket: bucket as PrivateStorageBucket,
        role: membership.role,
        file: file as File,
      },
      createValidatedUploadRepository(admin),
    )

    if (!result.ok) return failure(result.error.message)

    return {
      data: {
        assetId: result.assetId,
        objectPath: result.objectPath,
        kind: result.kind,
        status: result.status,
      },
    }
  } catch {
    return failure('파일을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
}

function isUploadRole(value: unknown): value is Exclude<WorkspaceRole, 'viewer'> {
  return value === 'owner' || value === 'manager' || value === 'reviewer'
}
