import { describe, expect, it } from 'vitest'
import { ImageBinaryValidationError, validateImageBinary } from './image-binary-validator'

/**
 * 최소 JPEG 바이트를 만든다. APP1 EXIF 의 Orientation 만 필요하므로 SOI → APP1 → SOF0 → EOI
 * 순서로 세그먼트를 직접 쌓는다.
 */
function buildJpeg(input: {
  width: number
  height: number
  orientation?: number
  littleEndian?: boolean
}): Uint8Array {
  const { width, height, orientation, littleEndian = false } = input
  const bytes: number[] = [0xff, 0xd8] // SOI

  if (orientation !== undefined) {
    // TIFF: byte order(2) + magic(2) + IFD0 offset(4) + IFD0 count(2) + entry(12) + next IFD(4)
    const tiff: number[] = []
    if (littleEndian) tiff.push(0x49, 0x49)
    else tiff.push(0x4d, 0x4d)
    const u16 = (value: number) => (littleEndian ? [value & 0xff, value >> 8] : [value >> 8, value & 0xff])
    const u32 = (value: number) =>
      littleEndian
        ? [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff]
        : [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
    tiff.push(...u16(0x002a)) // TIFF magic
    tiff.push(...u32(8)) // IFD0 은 TIFF 시작 + 8
    tiff.push(...u16(1)) // 엔트리 1개
    tiff.push(...u16(0x0112)) // Orientation
    tiff.push(...u16(3)) // SHORT
    tiff.push(...u32(1)) // 개수 1
    tiff.push(...u16(orientation)) // 값은 값 필드 첫 2바이트
    tiff.push(0, 0)
    tiff.push(...u32(0)) // 다음 IFD 없음

    const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff] // 'Exif\0\0'
    const segmentLength = payload.length + 2
    bytes.push(0xff, 0xe1, segmentLength >> 8, segmentLength & 0xff, ...payload)
  }

  // SOF0: precision(1) + height(2) + width(2) + components(1) + 성분 3바이트
  const sofPayload = [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0]
  bytes.push(0xff, 0xc0, (sofPayload.length + 2) >> 8, (sofPayload.length + 2) & 0xff, ...sofPayload)
  bytes.push(0xff, 0xd9) // EOI
  return new Uint8Array(bytes)
}

describe('validateImageBinary — EXIF 방향 보정', () => {
  it('EXIF 가 없으면 SOF 치수를 그대로 쓴다', () => {
    const binary = validateImageBinary(buildJpeg({ width: 4032, height: 3024 }))

    expect(binary).toMatchObject({ format: 'jpeg', mimeType: 'image/jpeg', width: 4032, height: 3024 })
    expect(binary.sha256Digest).toHaveLength(64)
  })

  it('orientation 6(90도 회전)은 가로·세로를 뒤바꿔 저장한다', () => {
    const binary = validateImageBinary(buildJpeg({ width: 4032, height: 3024, orientation: 6 }))

    expect(binary).toMatchObject({ width: 3024, height: 4032 })
  })

  it('orientation 8(270도 회전)도 뒤바꾸고 리틀엔디언 TIFF 도 읽는다', () => {
    const binary = validateImageBinary(
      buildJpeg({ width: 1280, height: 960, orientation: 8, littleEndian: true }),
    )

    expect(binary).toMatchObject({ width: 960, height: 1280 })
  })

  it('orientation 5·7(뒤집힌 90도 회전)도 뒤바꾼다', () => {
    expect(validateImageBinary(buildJpeg({ width: 800, height: 600, orientation: 5 }))).toMatchObject({
      width: 600,
      height: 800,
    })
    expect(validateImageBinary(buildJpeg({ width: 800, height: 600, orientation: 7 }))).toMatchObject({
      width: 600,
      height: 800,
    })
  })

  it('orientation 1·2·3·4(회전 없음·뒤집기·180도)는 치수를 유지한다', () => {
    for (const orientation of [1, 2, 3, 4]) {
      expect(validateImageBinary(buildJpeg({ width: 800, height: 600, orientation }))).toMatchObject({
        width: 800,
        height: 600,
      })
    }
  })

  it('깨진 EXIF 는 방향 없음으로 보고 검증을 막지 않는다', () => {
    const bytes = buildJpeg({ width: 640, height: 480, orientation: 6 })
    // APP1 의 'Exif' 표식을 지워 TIFF 헤더를 읽을 수 없게 만든다.
    bytes[6] = 0x00

    expect(validateImageBinary(bytes)).toMatchObject({ width: 640, height: 480 })
  })

  it('SOF 가 없는 JPEG 는 기존처럼 실패한다', () => {
    const bytes = buildJpeg({ width: 10, height: 10 }).subarray(0, 2)

    expect(() => validateImageBinary(bytes)).toThrow(ImageBinaryValidationError)
  })
})
