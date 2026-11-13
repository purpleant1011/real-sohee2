export const PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024

export type ProfileImageExtension = 'jpg' | 'png' | 'webp'

export type ProfileImageSnapshot =
  | Readonly<{ ok: true; body: Blob; extension: ProfileImageExtension; mimeType: string }>
  | Readonly<{ ok: false; error: { code: string; message: string } }>

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const NativeArrayBuffer = ArrayBuffer
const NativeBlob = Blob
const NativeUint8Array = Uint8Array

const rules = {
  'image/jpeg': { extension: 'jpg', signature: [0xff, 0xd8, 0xff] },
  'image/png': { extension: 'png', signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  'image/webp': { extension: 'webp', signature: [0x52, 0x49, 0x46, 0x46] },
} as const

export function buildProfileImagePath(input: Readonly<{
  userId: string
  resourceId: string
  extension: ProfileImageExtension
}>): string {
  const { extension, resourceId, userId } = input
  if (!uuidPattern.test(userId) || !uuidPattern.test(resourceId)) {
    throw new Error('프로필 사진 경로가 올바르지 않습니다.')
  }
  return `${userId}/${resourceId}/avatar.${extension}`
}

export async function snapshotProfileImage(input: unknown): Promise<ProfileImageSnapshot> {
  if ((typeof input !== 'object' && typeof input !== 'function') || input === null) {
    return failure('PROFILE_IMAGE_READ_FAILED', '사진을 읽을 수 없어요. 다시 선택해 주세요.')
  }

  let size: number
  let type: string
  let arrayBuffer: File['arrayBuffer']
  try {
    const file = input as File
    size = file.size
    type = file.type
    arrayBuffer = file.arrayBuffer
  } catch {
    return failure('PROFILE_IMAGE_READ_FAILED', '사진을 읽을 수 없어요. 다시 선택해 주세요.')
  }

  if (!Number.isSafeInteger(size) || size < 0 || typeof type !== 'string' || typeof arrayBuffer !== 'function') {
    return failure('PROFILE_IMAGE_READ_FAILED', '사진을 읽을 수 없어요. 다시 선택해 주세요.')
  }
  if (size === 0) return failure('PROFILE_IMAGE_EMPTY', '빈 사진은 저장할 수 없어요.')
  if (size > PROFILE_IMAGE_MAX_BYTES) {
    return failure('PROFILE_IMAGE_TOO_LARGE', '5MB 이하의 사진을 선택해 주세요.')
  }

  const rule = rules[type as keyof typeof rules]
  if (!rule) {
    return failure('PROFILE_IMAGE_TYPE_INVALID', 'JPEG, PNG 또는 WebP 사진을 선택해 주세요.')
  }

  let buffer: ArrayBuffer
  try {
    buffer = await Reflect.apply(arrayBuffer, input, [])
  } catch {
    return failure('PROFILE_IMAGE_READ_FAILED', '사진을 읽을 수 없어요. 다시 선택해 주세요.')
  }
  if (!(buffer instanceof NativeArrayBuffer) || buffer.byteLength !== size) {
    return failure('PROFILE_IMAGE_READ_FAILED', '사진을 읽을 수 없어요. 다시 선택해 주세요.')
  }

  const bytes = new NativeUint8Array(buffer)
  if (!hasBytes(bytes, rule.signature)) {
    return failure('PROFILE_IMAGE_SIGNATURE_INVALID', '사진 파일의 내용과 형식이 일치하지 않아요.')
  }
  if (rule.extension === 'webp' && !hasBytes(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return failure('PROFILE_IMAGE_SIGNATURE_INVALID', '사진 파일의 내용과 형식이 일치하지 않아요.')
  }

  const copy = new NativeUint8Array(bytes.byteLength)
  copy.set(bytes)
  return Object.freeze({
    ok: true,
    body: new NativeBlob([copy.buffer], { type }),
    extension: rule.extension,
    mimeType: type,
  })
}

function hasBytes(bytes: Uint8Array, expected: readonly number[], offset = 0): boolean {
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[offset + index] !== expected[index]) return false
  }
  return true
}

function failure(code: string, message: string): ProfileImageSnapshot {
  return Object.freeze({ ok: false, error: Object.freeze({ code, message }) })
}
