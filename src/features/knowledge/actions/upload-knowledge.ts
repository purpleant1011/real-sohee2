'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { uploadPrivateFileAction } from './upload-private-file'

type UploadedKnowledge = Readonly<{ knowledgeId: string; status: 'checking' }>
const uuidSchema = z.string().uuid()

function failure(message: string): ActionResult<UploadedKnowledge> {
  return { error: { message, requestId: 'knowledge-upload' } }
}

export async function uploadKnowledgeAction(
  source: FormData,
): Promise<ActionResult<UploadedKnowledge>> {
  const workspaceId = source.get('workspaceId')
  const file = source.get('file')
  const parsedWorkspaceId = uuidSchema.safeParse(workspaceId)
  if (
    !parsedWorkspaceId.success ||
    (typeof file !== 'object' && typeof file !== 'function') ||
    file === null
  ) {
    return failure('작업공간과 업로드할 파일을 확인해 주세요.')
  }

  const upload = new FormData()
  upload.set('workspaceId', parsedWorkspaceId.data)
  upload.set('bucket', 'knowledge-files')
  upload.set('file', file as Blob)

  const result = await uploadPrivateFileAction(upload)
  if (result.error) return { error: result.error }
  if (result.data.kind !== 'knowledge' || result.data.status !== 'checking') {
    return failure('지식 자료 업로드 상태를 확인하지 못했습니다.')
  }

  revalidatePath('/app/account')
  revalidatePath('/app/account/knowledge')
  return { data: { knowledgeId: result.data.assetId, status: 'checking' } }
}
