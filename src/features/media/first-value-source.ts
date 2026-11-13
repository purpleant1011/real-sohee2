import { z } from 'zod'
import { canPublishUploadedMedia } from './media-rights'

export function firstValueSourceCookieName(workspaceId: string): string {
  return `sohee-first-value-photo-${workspaceId}`
}

export class FirstValueSourceError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, status: number, message: string) {
    super(message)
    this.name = 'FirstValueSourceError'
    this.code = code
    this.status = status
  }
}

export interface ResolveFirstValueSourceIdsParams {
  admin: any
  workspaceId: string
  explicitAssetId?: string | null
}

export async function resolveFirstValueSourceIds({
  admin,
  workspaceId,
  explicitAssetId,
}: ResolveFirstValueSourceIdsParams): Promise<string[]> {
  if (explicitAssetId !== undefined && explicitAssetId !== null) {
    if (explicitAssetId === 'none') {
      return []
    }

    const parsed = z.string().uuid().safeParse(explicitAssetId)
    if (!parsed.success) {
      throw new FirstValueSourceError('MEDIA_SELECTION_INVALID', 409, '선택한 사진 식별자가 올바르지 않아요.')
    }
    const targetId = parsed.data

    const { data, error } = await admin
      .from('media_assets')
      .select('*')
      .eq('id', targetId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (error) {
      throw new FirstValueSourceError('MEDIA_FETCH_FAILED', 503, '사진 정보를 조회하는 중 오류가 발생했어요.')
    }

    if (!data) {
      throw new FirstValueSourceError('MEDIA_SELECTION_INVALID', 409, '선택한 사진을 찾을 수 없어요.')
    }

    if (data.id !== targetId) {
      throw new FirstValueSourceError('MEDIA_SELECTION_INVALID', 409, '선택한 사진 식별자가 일치하지 않아요.')
    }

    if (!canPublishUploadedMedia(data, workspaceId)) {
      throw new FirstValueSourceError('MEDIA_SELECTION_INVALID', 409, '공개 사용할 수 없는 사진이에요.')
    }

    return [data.id]
  }

  const { data, error } = await admin
    .from('media_assets')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('provenance_kind', 'USER_UPLOAD')
    .in('lifecycle_status', ['READY', 'PENDING_VALIDATION'])
    .order('created_at', { ascending: false })
    .limit(2)

  if (error || !Array.isArray(data)) {
    throw new FirstValueSourceError('MEDIA_FETCH_FAILED', 503, '사진 목록을 조회하는 중 오류가 발생했어요.')
  }

  const rows = data
  if (rows.length === 0) {
    return []
  }

  if (rows.length > 1) {
    throw new FirstValueSourceError('MEDIA_SELECTION_REQUIRED', 409, '첫 글에 사용할 사진을 선택해 주세요.')
  }

  const candidate = rows[0]
  if (!canPublishUploadedMedia(candidate, workspaceId)) {
    throw new FirstValueSourceError('MEDIA_SELECTION_INVALID', 409, '저장된 사진의 공개 사용 권리가 확인되지 않았어요.')
  }

  return [candidate.id]
}
