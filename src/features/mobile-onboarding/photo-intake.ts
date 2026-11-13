/**
 * 서버 계약(media-upload.ts)과 같은 값이다. 서버 검증이 최종 권위이며,
 * 이 상수는 업로드 전에 사용자에게 같은 기준으로 미리 알려 주기 위한 것이다.
 */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024
const HEIC_EXT = /\.(heic|heif)$/i
const IMAGE_EXT = /\.(jpe?g|png)$/i
const IMAGE_MIME = new Set(['image/jpeg', 'image/png'])
const HEIC_MIME = new Set(['image/heic', 'image/heif'])
const UNSUPPORTED_EXT = /\.webp$/i
const UNSUPPORTED_MIME = new Set(['image/webp'])

export type PhotoFileLike = { name: string; type: string; size: number }
export type PhotoClassification =
  | { ok: true }
  | { ok: false; reason: 'NOT_IMAGE' | 'EMPTY' | 'TOO_LARGE' | 'UNSUPPORTED_TYPE'; message: string }

export function classifyPhotoFile(file: PhotoFileLike): PhotoClassification {
  if (file.size <= 0) return { ok: false, reason: 'EMPTY', message: '비어 있는 파일이에요. 다른 사진을 골라 주세요.' }
  if (file.size > MAX_PHOTO_BYTES)
    return { ok: false, reason: 'TOO_LARGE', message: '사진이 너무 커요. 10MB 이하 사진을 골라 주세요.' }
  const type = file.type.toLowerCase()
  // HEIC 변환은 아직 지원하지 않는다. 받아 두고 나중에 변환한다고 약속하지 않고 지금 정직하게 거절한다.
  if (HEIC_MIME.has(type) || HEIC_EXT.test(file.name))
    return {
      ok: false,
      reason: 'UNSUPPORTED_TYPE',
      message: '아이폰 HEIC 사진은 아직 올릴 수 없어요. JPG 또는 PNG로 변환한 뒤 골라 주세요.',
    }
  if (UNSUPPORTED_MIME.has(type) || UNSUPPORTED_EXT.test(file.name))
    return {
      ok: false,
      reason: 'UNSUPPORTED_TYPE',
      message: 'JPG 또는 PNG 사진만 올릴 수 있어요. WEBP는 변환한 뒤 골라 주세요.',
    }
  if (IMAGE_MIME.has(type) || (type === '' && IMAGE_EXT.test(file.name))) return { ok: true }
  return { ok: false, reason: 'NOT_IMAGE', message: '사진 파일만 올릴 수 있어요.' }
}

/** 긴 변 기준 축소 계획. 확대하지 않는다. */
export function planResize(width: number, height: number, maxEdge = 2048): { width: number; height: number; scaled: boolean } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height, scaled: false }
  const r = maxEdge / longest
  return { width: Math.round(width * r), height: Math.round(height * r), scaled: true }
}

/** HEIC 변환 단계는 없다(미지원). 검증을 통과한 파일은 축소 → 업로드만 거친다. */
export type PhotoPipelineStep = 'resize' | 'upload'
export function planPhotoPipeline(): PhotoPipelineStep[] {
  return ['resize', 'upload']
}

export type RightsDeclaration = {
  ownership: 'OWN' | 'PERMITTED' | 'UNKNOWN'
  hasPerson: boolean
  personConsent?: boolean
}

/** 불확실한 권리는 저장만 허용하고 게시는 서버·화면 모두에서 막는다(fail-closed). */
export function canSubmitRights(d: RightsDeclaration): { canSave: boolean; canPublish: boolean } {
  const rightsOk = d.ownership === 'OWN' || d.ownership === 'PERMITTED'
  const personOk = !d.hasPerson || d.personConsent === true
  return { canSave: true, canPublish: rightsOk && personOk }
}
