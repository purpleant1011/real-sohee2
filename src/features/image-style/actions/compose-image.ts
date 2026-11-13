'use server'

import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { authorizeManager } from '../server/manager-auth'
import { storePrivateImage } from '../server/store-private-image'

const requestId = 'image-style-compose'
const MAX_BYTES = 8 * 1024 * 1024
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function failure(message: string): ActionResult<{ assetId: string; url: string }> {
  return { error: { message, requestId } }
}

/** 브라우저에서 문구·삽입컷을 얹어 만든 PNG를 비공개 저장소에 올린다. */
export async function saveComposedImageAction(formData: FormData): Promise<ActionResult<{ assetId: string; url: string }>> {
  const workspaceId = z.string().uuid().safeParse(formData.get('workspaceId'))
  if (!workspaceId.success) return failure('작업공간을 확인해 주세요.')
  const file = formData.get('file')
  if (!(file instanceof File) || file.type !== 'image/png' || file.size > MAX_BYTES) {
    return failure('합성한 이미지는 8MB 이하 PNG만 저장할 수 있어요.')
  }
  const head = new Uint8Array(await file.slice(0, PNG_SIGNATURE.length).arrayBuffer())
  if (!PNG_SIGNATURE.every((byte, index) => head[index] === byte)) return failure('합성한 이미지가 올바른 PNG가 아니에요.')

  try {
    const auth = await authorizeManager(workspaceId.data)
    if ('message' in auth) return failure(auth.message)
    const assetId = await storePrivateImage(workspaceId.data, auth, file)
    if (!assetId) return failure('합성한 이미지를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.')
    return { data: { assetId, url: `/api/workspaces/${workspaceId.data}/media/${assetId}` } }
  } catch {
    return failure('합성한 이미지를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.')
  }
}
