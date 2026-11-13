export const KNOWLEDGE_MAX_BYTES = 8 * 1024 * 1024
export const CONTENT_MEDIA_MAX_BYTES = 10 * 1024 * 1024

type FileKind = 'pdf' | 'text' | 'jpeg' | 'png' | 'webp'
type BinaryFileKind = Exclude<FileKind, 'text'>
type UploadErrorCode =
  | 'UPLOAD_EMPTY'
  | 'UPLOAD_TOO_LARGE'
  | 'UPLOAD_TYPE_INVALID'
  | 'UPLOAD_SIGNATURE_INVALID'
  | 'UPLOAD_TEXT_ENCODING_INVALID'
  | 'UPLOAD_READ_FAILED'

export type FileValidationResult =
  | { ok: true; kind: FileKind }
  | { ok: false; error: { code: UploadErrorCode; message: string } }

type FileRule = { kind: BinaryFileKind } | { kind: 'text' }

const KNOWLEDGE_RULES: Record<string, FileRule> = {
  'application/pdf': { kind: 'pdf' },
  'text/plain': { kind: 'text' },
  'image/jpeg': { kind: 'jpeg' },
  'image/png': { kind: 'png' },
}

const CONTENT_MEDIA_RULES: Record<string, FileRule> = {
  'image/jpeg': { kind: 'jpeg' },
  'image/png': { kind: 'png' },
  'image/webp': { kind: 'webp' },
}

const BINARY_PREFIX_BYTES = 12
const NativeTextDecoder = TextDecoder
const NativeUint8Array = Uint8Array

const errorMessages: Record<UploadErrorCode, string> = {
  UPLOAD_EMPTY: '빈 파일은 업로드할 수 없습니다.',
  UPLOAD_TOO_LARGE: '파일 크기가 제한을 초과했습니다.',
  UPLOAD_TYPE_INVALID: '허용되지 않은 파일 형식입니다.',
  UPLOAD_SIGNATURE_INVALID: '파일 내용이 선언된 형식과 일치하지 않습니다.',
  UPLOAD_TEXT_ENCODING_INVALID: '텍스트 파일의 인코딩이 올바르지 않습니다.',
  UPLOAD_READ_FAILED: '파일을 읽을 수 없습니다. 다시 시도해 주세요.',
}

export async function validateKnowledgeFile(file: File): Promise<FileValidationResult> {
  return validateFile(file, KNOWLEDGE_MAX_BYTES, KNOWLEDGE_RULES)
}

export async function validateContentMedia(file: File): Promise<FileValidationResult> {
  return validateFile(file, CONTENT_MEDIA_MAX_BYTES, CONTENT_MEDIA_RULES)
}

async function validateFile(
  file: File,
  maxBytes: number,
  rules: Record<string, FileRule>,
): Promise<FileValidationResult> {
  let size: number
  let type: string
  try {
    size = file.size
    type = file.type
  } catch {
    return failure('UPLOAD_READ_FAILED')
  }

  if (!Number.isSafeInteger(size) || size < 0 || typeof type !== 'string') {
    return failure('UPLOAD_READ_FAILED')
  }

  if (size === 0) return failure('UPLOAD_EMPTY')
  if (size > maxBytes) return failure('UPLOAD_TOO_LARGE')

  const rule = rules[type]
  if (!rule) return failure('UPLOAD_TYPE_INVALID')

  if (rule.kind === 'text') return validateUtf8Text(file)

  let prefix: Uint8Array
  try {
    prefix = new NativeUint8Array(await file.slice(0, BINARY_PREFIX_BYTES).arrayBuffer())
  } catch {
    return failure('UPLOAD_READ_FAILED')
  }

  return hasExpectedSignature(prefix, rule.kind)
    ? { ok: true, kind: rule.kind }
    : failure('UPLOAD_SIGNATURE_INVALID')
}

async function validateUtf8Text(file: File): Promise<FileValidationResult> {
  let bytes: ArrayBuffer
  try {
    bytes = await file.arrayBuffer()
  } catch {
    return failure('UPLOAD_READ_FAILED')
  }

  try {
    new NativeTextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return failure('UPLOAD_TEXT_ENCODING_INVALID')
  }

  return { ok: true, kind: 'text' }
}

function hasExpectedSignature(bytes: Uint8Array, kind: BinaryFileKind): boolean {
  switch (kind) {
    case 'jpeg':
      return hasBytes(bytes, [0xff, 0xd8, 0xff])
    case 'png':
      return hasBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'pdf':
      return hasBytes(bytes, [0x25, 0x50, 0x44, 0x46])
    case 'webp':
      return hasBytes(bytes, [0x52, 0x49, 0x46, 0x46]) && hasBytes(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  }
}

function hasBytes(bytes: Uint8Array, expected: number[], offset = 0): boolean {
  const expectedLength = expected.length
  for (let index = 0; index < expectedLength; index += 1) {
    if (bytes[offset + index] !== expected[index]) return false
  }
  return true
}

function failure(code: UploadErrorCode): FileValidationResult {
  return { ok: false, error: { code, message: errorMessages[code] } }
}
