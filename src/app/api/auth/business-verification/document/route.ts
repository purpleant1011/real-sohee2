export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import {
  BUSINESS_DOCUMENT_BUCKET,
  MAX_BUSINESS_DOCUMENTS_PER_WORKSPACE,
  buildBusinessDocumentPath,
  validateBusinessDocument,
} from '@/features/business-verification/document'

/** 사업자등록증 업로드. 매장 대표·관리자만, 서버(service role)가 비공개 버킷에 저장한다. */
export async function POST(req: Request) {
  const auth = await authorizeQuickRequest(req.headers.get('x-workspace-id'), { requireRole: 'manager' })
  if (isResponse(auth)) return auth

  let file: unknown = null
  try {
    const form = await req.formData()
    file = form.get('file')
  } catch {
    return NextResponse.json({ error: '파일을 확인해 주세요.', code: 'INVALID_FORM' }, { status: 400 })
  }
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: '사업자등록증 파일을 선택해 주세요.', code: 'FILE_REQUIRED' }, { status: 400 })
  }

  const check = await validateBusinessDocument(file as File)
  if (!check.ok) {
    return NextResponse.json({ error: check.message, code: 'INVALID_DOCUMENT' }, { status: 422 })
  }

  const { data: existing, error: listError } = await auth.admin.storage
    .from(BUSINESS_DOCUMENT_BUCKET)
    .list(auth.workspaceId, { limit: MAX_BUSINESS_DOCUMENTS_PER_WORKSPACE + 1 })
  if (listError) {
    console.error('[business-verification/document] list failed')
    return NextResponse.json(
      { error: '파일을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.', code: 'UPLOAD_FAILED' },
      { status: 500 },
    )
  }
  if ((existing?.length ?? 0) >= MAX_BUSINESS_DOCUMENTS_PER_WORKSPACE) {
    return NextResponse.json(
      { error: '올릴 수 있는 횟수를 넘었어요. 고객센터로 문의해 주세요.', code: 'UPLOAD_LIMIT' },
      { status: 429 },
    )
  }

  const documentPath = buildBusinessDocumentPath(auth.workspaceId, check.ext)
  const { error } = await auth.admin.storage
    .from(BUSINESS_DOCUMENT_BUCKET)
    .upload(documentPath, file as File, { contentType: check.contentType, upsert: false })
  if (error) {
    console.error('[business-verification/document] upload failed')
    return NextResponse.json(
      { error: '파일을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.', code: 'UPLOAD_FAILED' },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true, documentPath })
}
