import {
  resolveFirstValueSourceIds,
} from '@/features/media/first-value-source'
import type { ExactApprovalRights } from './conversational-first-post'

export interface ResolveFirstPostUserMediaParams {
  admin: any
  workspaceId: string
  explicitAssetId?: string | null
  selectedAssetId?: string | null
}

export interface FirstPostMediaPreview {
  id: string
  url: string
}

export interface FirstPostUserMediaResult {
  selectedImageIds: string[]
  mediaPreviews: FirstPostMediaPreview[]
  rights: ExactApprovalRights | null
}

export function deriveAssetRights(asset: any): ExactApprovalRights | null {
  const uploadRights = asset?.generation_metadata?.uploadRights
  if (!uploadRights) return null
  const rightsStatus =
    uploadRights.copyright === 'owned'
      ? 'OWNED'
      : uploadRights.copyright === 'licensed'
        ? 'LICENSED'
        : null
  const consentStatus =
    uploadRights.identifiablePeople === 'none'
      ? 'NOT_APPLICABLE'
      : uploadRights.identifiablePeople === 'consented' && uploadRights.consentReference
        ? 'CONFIRMED'
        : null
  if (!rightsStatus || !consentStatus) return null
  return { rightsStatus, consentStatus }
}

/**
 * 첫 포스팅 사용자 업로드 실사진 resolver (ANI-1764).
 *
 * 우선순위:
 * 1) explicitAssetId 가 지정되면 최우선 사용.
 * 2) 없으면 selectedAssetId (쿠키/클라이언트 선택값) 사용.
 * 3) 둘 다 없으면 기존 동일 workspace 유일 업로드 resolver 정책 재사용.
 *
 * 'none' 또는 미등록 상태인 경우 빈 배열([])을 반환하며 예시 사진으로 대체하지 않는다.
 * 타 테넌트, READY 미도달, 권리 미확인, 철회 등은 기존 helper 검증을 통과하며
 * 실패 시 FirstValueSourceError 가 그대로 상위로 전달된다.
 */
export async function resolveFirstPostUserMedia({
  admin,
  workspaceId,
  explicitAssetId,
  selectedAssetId,
}: ResolveFirstPostUserMediaParams): Promise<FirstPostUserMediaResult> {
  const targetAssetId =
    explicitAssetId !== undefined && explicitAssetId !== null
      ? explicitAssetId
      : selectedAssetId !== undefined && selectedAssetId !== null
        ? selectedAssetId
        : undefined

  const selectedImageIds = await resolveFirstValueSourceIds({
    admin,
    workspaceId,
    explicitAssetId: targetAssetId,
  })

  const mediaPreviews: FirstPostMediaPreview[] = selectedImageIds.map(id => ({
    id,
    url: `/api/workspaces/${encodeURIComponent(workspaceId)}/media/${encodeURIComponent(id)}`,
  }))

  let rights: ExactApprovalRights | null = null
  if (selectedImageIds.length > 0) {
    const { data: assetRow } = await admin
      .from('media_assets')
      .select('*')
      .eq('id', selectedImageIds[0])
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (assetRow) {
      rights = deriveAssetRights(assetRow)
    }
  }

  return {
    selectedImageIds,
    mediaPreviews,
    rights,
  }
}
