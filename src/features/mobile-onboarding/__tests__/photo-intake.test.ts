// ANI-1675/1676 (M04/M04b): 클라이언트 사전 검증과 권리 선언. 서버 검증이 최종 권위.
// 계약은 src/features/media/media-upload.ts 와 같아야 한다(10MB, JPG/PNG만).
import { describe, expect, it } from 'vitest'
import { MAX_PHOTO_BYTES, canSubmitRights, classifyPhotoFile, planPhotoPipeline } from '../photo-intake'

const f = (name: string, type: string, size: number) => ({ name, type, size })
const MB = 1024 * 1024

describe('classifyPhotoFile', () => {
  it('계약 상수는 서버와 같은 10MB다', () => {
    expect(MAX_PHOTO_BYTES).toBe(10 * MB)
  })

  it('jpeg/png 는 그대로 통과한다', () => {
    expect(classifyPhotoFile(f('a.jpg', 'image/jpeg', 1000))).toEqual({ ok: true })
    expect(classifyPhotoFile(f('a.jpeg', 'image/jpeg', 1000))).toEqual({ ok: true })
    expect(classifyPhotoFile(f('a.png', 'image/png', 1000))).toEqual({ ok: true })
    // iOS가 MIME을 비워 보내는 경우 확장자로 판별한다.
    expect(classifyPhotoFile(f('IMG_2.JPG', '', 1000))).toEqual({ ok: true })
  })

  it('10MB 경계: 10MB는 통과, 10MB+1바이트는 거절한다', () => {
    expect(classifyPhotoFile(f('a.jpg', 'image/jpeg', MAX_PHOTO_BYTES))).toEqual({ ok: true })
    expect(classifyPhotoFile(f('a.jpg', 'image/jpeg', MAX_PHOTO_BYTES + 1))).toMatchObject({
      ok: false,
      reason: 'TOO_LARGE',
    })
  })

  it('용량 거절 문구는 10MB 기준을 사용자에게 알린다', () => {
    const result = classifyPhotoFile(f('a.jpg', 'image/jpeg', 11 * MB))
    expect(result).toMatchObject({ ok: false, reason: 'TOO_LARGE' })
    if (!result.ok) expect(result.message).toContain('10MB')
  })

  it('HEIC/HEIF 는 변환을 약속하지 않고 미지원으로 거절한다', () => {
    // 변환기가 없으므로 needsConvert 같은 통과 판정을 내리지 않는다.
    expect(classifyPhotoFile(f('IMG_1.HEIC', '', 3_000_000))).toMatchObject({
      ok: false,
      reason: 'UNSUPPORTED_TYPE',
    })
    expect(classifyPhotoFile(f('a.heif', 'image/heif', 10))).toMatchObject({
      ok: false,
      reason: 'UNSUPPORTED_TYPE',
    })
  })

  it('webp 는 서버가 받지 않으므로 미지원으로 거절한다', () => {
    expect(classifyPhotoFile(f('a.webp', 'image/webp', 1000))).toMatchObject({
      ok: false,
      reason: 'UNSUPPORTED_TYPE',
    })
    expect(classifyPhotoFile(f('a.webp', '', 1000))).toMatchObject({ ok: false, reason: 'UNSUPPORTED_TYPE' })
  })

  it('이미지가 아니거나 0바이트는 한국어 사유로 거절한다', () => {
    expect(classifyPhotoFile(f('a.pdf', 'application/pdf', 10))).toMatchObject({ ok: false, reason: 'NOT_IMAGE' })
    expect(classifyPhotoFile(f('a.jpg', 'image/jpeg', 0))).toMatchObject({ ok: false, reason: 'EMPTY' })
  })
})

describe('planPhotoPipeline', () => {
  it('변환 단계 없이 축소 → 업로드만 계획한다', () => {
    expect(planPhotoPipeline()).toEqual(['resize', 'upload'])
  })
})

describe('canSubmitRights (권리 불확실은 게시 단계에서 차단)', () => {
  it("'확인할 수 없음' 은 저장은 되지만 게시 불가", () => {
    expect(canSubmitRights({ ownership: 'UNKNOWN', hasPerson: false })).toEqual({ canSave: true, canPublish: false })
  })
  it('사람이 있으면 초상권 동의 없이는 게시 불가', () => {
    expect(canSubmitRights({ ownership: 'OWN', hasPerson: true, personConsent: false }).canPublish).toBe(false)
    expect(canSubmitRights({ ownership: 'OWN', hasPerson: true, personConsent: true }).canPublish).toBe(true)
  })
  it('내 사진 + 사람 없음이면 게시 가능', () => {
    expect(canSubmitRights({ ownership: 'OWN', hasPerson: false }).canPublish).toBe(true)
  })
})
