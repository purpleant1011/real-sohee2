/**
 * 서버 사진 asset DTO → M06 미리보기 입력 (ANI-1764).
 *
 * - 서버 응답은 믿지 않고 모양을 검사한다. 하나라도 어긋나면 `null`(미리보기 만들지 않음).
 * - 사진 사용 권리는 서버가 `CONFIRMED` 라고 준 경우, 또는 사용자가 낸 권리 선언이
 *   게시 가능(`canPublish`)일 때만 `CONFIRMED` 다. 그 외·누락은 `UNCONFIRMED`(fail-closed).
 * - 실제 데이터(`ACTUAL`)의 사진 주소는 **이 워크스페이스의 media 경로**여야 한다.
 *   다른 워크스페이스 경로나 바깥 출처 주소는 받지 않는다(임의 URL·샘플 금지).
 * - 주소·크기·id 를 지어내지 않는다.
 *
 * 네트워크를 모른다. 업로드 계약(ANI-1675)이 정해지면 `PhotoAssetDto` 필드명만 맞춘다.
 */
import { canSubmitRights, type RightsDeclaration } from '@/features/mobile-onboarding/photo-intake'
import { parseDatasetMode, type DatasetMode } from './dataset-mode'
import type { AssetRights, PreviewAsset } from './preview-set'

export interface PhotoAssetDto {
  assetId?: unknown
  url?: unknown
  width?: unknown
  height?: unknown
  rightsStatus?: unknown
  datasetMode?: unknown
}

export interface AssetScope {
  /** 서버 초안의 워크스페이스 id. 실제 데이터에서 media 경로의 소유자를 검증한다. */
  workspaceId?: string
  /**
   * 이 미리보기가 보여 주려는 자산 id. media 경로의 자산 세그먼트와 **반드시** 같아야 한다.
   * 다르면 화면에 그린 사진과 승인·게시가 묶는 사진이 어긋난다.
   */
  assetId?: string
  /** 화면이 실행 중인 출처. 같은 출처 상대/절대 주소를 판정할 때 쓴다. */
  origin?: string
  datasetMode?: DatasetMode
}

export type AssetScopeVerdict =
  | 'OK'
  | 'INVALID_URL'
  | 'CROSS_WORKSPACE'
  | 'EXTERNAL_ORIGIN'
  | 'NOT_WORKSPACE_SCOPED'
  | 'NO_WORKSPACE'
  | 'NO_ASSET_ID'
  | 'ASSET_MISMATCH'

const MEDIA_PATH = /^\/api\/workspaces\/([^/]+)\/media\/([^/]+)\/?$/
const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml)(?:;base64|;utf8|),/i

function originOf(value: string | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

/**
 * media 경로 판정. 워크스페이스만 보지 않고 **자산 id 까지** 대조한다.
 * 자산 id 를 모르면 통과시키지 않는다(fail-closed) — 화면 사진과 승인 대상이
 * 어긋난 채로 넘어가는 것을 막는 지점이다.
 */
function mediaVerdict(pathname: string, workspaceId: string | undefined, assetId: string | undefined): AssetScopeVerdict {
  const media = MEDIA_PATH.exec(pathname)
  if (!media) return 'NOT_WORKSPACE_SCOPED'
  if (!workspaceId) return 'NO_WORKSPACE'
  if (media[1] !== workspaceId) return 'CROSS_WORKSPACE'
  if (!assetId) return 'NO_ASSET_ID'
  return media[2] === assetId ? 'OK' : 'ASSET_MISMATCH'
}

/**
 * 사진 주소가 이 워크스페이스의 실제 자산인지 판정한다.
 * - 실제 데이터: `/api/workspaces/{id}/media/{assetId}`(같은 출처)만 통과.
 * - 예시·시험: 같은 출처의 상대 경로와 인라인 자리표시자를 허용하되 바깥 출처는 막는다.
 */
export function assetScopeVerdict(raw: unknown, scope: AssetScope = {}): AssetScopeVerdict {
  if (typeof raw !== 'string' || !raw) return 'INVALID_URL'
  const mode = scope.datasetMode ?? 'ACTUAL'
  const actual = mode === 'ACTUAL'

  if (raw.startsWith('data:')) return !actual && DATA_IMAGE.test(raw) ? 'OK' : 'INVALID_URL'
  if (raw.startsWith('//')) return 'EXTERNAL_ORIGIN'
  if (raw.startsWith('/')) {
    const media = MEDIA_PATH.exec(raw)
    if (media) return mediaVerdict(raw, scope.workspaceId, scope.assetId)
    return actual ? 'NOT_WORKSPACE_SCOPED' : 'OK'
  }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return 'INVALID_URL'
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'INVALID_URL'

  const expected = originOf(scope.origin)
  if (!expected || url.origin !== expected) return 'EXTERNAL_ORIGIN'
  return mediaVerdict(url.pathname, scope.workspaceId, scope.assetId)
}

function positive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

export function rightsOf(dto: PhotoAssetDto, declaration?: RightsDeclaration | null): AssetRights {
  if (dto.rightsStatus === 'CONFIRMED') return 'CONFIRMED'
  if (dto.rightsStatus === undefined && declaration && canSubmitRights(declaration).canPublish) return 'CONFIRMED'
  return 'UNCONFIRMED'
}

/** 서버 DTO 에서 미리보기용 asset 을 만든다. 근거가 부족하면 null. */
export function toPreviewAsset(
  dto: PhotoAssetDto | null | undefined,
  declaration?: RightsDeclaration | null,
  scope: AssetScope = {},
): PreviewAsset | null {
  if (!dto || typeof dto !== 'object') return null
  if (typeof dto.assetId !== 'string' || !dto.assetId.trim()) return null
  if (typeof dto.url !== 'string' || !dto.url) return null
  if (!positive(dto.width) || !positive(dto.height)) return null

  // 서버가 모드를 선언했는데 모르는 값이면 추측하지 않는다.
  const declared = dto.datasetMode
  const parsed = declared === undefined ? null : parseDatasetMode(declared)
  if (declared !== undefined && parsed === null) return null
  const mode = parsed ?? scope.datasetMode ?? 'ACTUAL'
  // 호출자가 기대한 자산 id 와 DTO 자신의 id 가 다르면 다른 사진이다.
  // 기대값을 DTO 값으로 덮어쓰면 잘못된 자산이 그대로 통과한다.
  if (scope.assetId !== undefined && scope.assetId !== dto.assetId) return null
  if (assetScopeVerdict(dto.url, { ...scope, assetId: dto.assetId, datasetMode: mode }) !== 'OK') return null

  return {
    assetId: dto.assetId,
    imageUrl: dto.url,
    width: dto.width,
    height: dto.height,
    rights: rightsOf(dto, declaration),
  }
}
