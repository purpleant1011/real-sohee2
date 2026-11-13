import { validateKnowledgeFile } from '@/features/knowledge/file-validation'

export const BUSINESS_DOCUMENT_BUCKET = 'business-documents' as const

/** 한 매장이 올릴 수 있는 사업자등록증 파일 수 상한(재제출·반려 대비 여유 포함). */
export const MAX_BUSINESS_DOCUMENTS_PER_WORKSPACE = 10

const EXT_BY_KIND = { pdf: 'pdf', jpeg: 'jpg', png: 'png' } as const
const MIME_BY_EXT = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png' } as const

export type BusinessDocumentExt = keyof typeof MIME_BY_EXT

export type BusinessDocumentCheck =
  | { ok: true; ext: BusinessDocumentExt; contentType: (typeof MIME_BY_EXT)[BusinessDocumentExt] }
  | { ok: false; message: string }

const TYPE_MESSAGE = '사업자등록증은 PDF 또는 사진(JPG, PNG) 파일만 올릴 수 있어요.'

/** 크기·형식·파일 시그니처 검증은 기존 지식 파일 검증을 쓰고, 텍스트·WebP는 여기서 걸러낸다. */
export async function validateBusinessDocument(file: File): Promise<BusinessDocumentCheck> {
  const result = await validateKnowledgeFile(file)
  if (!result.ok) return { ok: false, message: result.error.message }
  if (result.kind !== 'pdf' && result.kind !== 'jpeg' && result.kind !== 'png') {
    return { ok: false, message: TYPE_MESSAGE }
  }
  const ext = EXT_BY_KIND[result.kind]
  return { ok: true, ext, contentType: MIME_BY_EXT[ext] }
}

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const UUID_PATTERN = new RegExp(`^${UUID_SOURCE}$`)

export function buildBusinessDocumentPath(
  workspaceId: string,
  ext: BusinessDocumentExt,
  id: string = globalThis.crypto.randomUUID(),
): string {
  return `${workspaceId}/${id}.${ext}`
}

/** 클라이언트가 보낸 경로가 정말 이 워크스페이스 폴더의 파일인지 확인한다. */
export function isOwnBusinessDocumentPath(path: unknown, workspaceId: string): path is string {
  if (typeof path !== 'string' || !UUID_PATTERN.test(workspaceId)) return false
  return new RegExp(`^${workspaceId}/${UUID_SOURCE}\\.(pdf|jpg|png)$`).test(path)
}
