export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireOperator } from '@/features/operator-auth/require-operator'
import { OperatorAccessError } from '@/features/operator-auth/current-operator'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { BUSINESS_DOCUMENT_BUCKET, isOwnBusinessDocumentPath } from '@/features/business-verification/document'

function noStoreJson(body: unknown, init?: ResponseInit) {
  const res = NextResponse.json(body, init)
  res.headers.set('Cache-Control', 'no-store')
  return res
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const { workspaceId } = await params
    const operator = await requireOperator('workspace.lifecycle.manage', workspaceId)
    const operatorUserId = operator?.userId ?? null

    const admin = createAdminSupabaseClient()
    const { data: bv, error: dbErr } = await (admin as any)
      .from('business_verifications')
      .select('document_url')
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (dbErr || !bv?.document_url) {
      return noStoreJson({ error: '제출된 사업자등록증이 없어요.' }, { status: 404 })
    }

    const documentPath = bv.document_url
    if (!isOwnBusinessDocumentPath(documentPath, workspaceId)) {
      return noStoreJson({ error: '제출된 사업자등록증이 없어요.' }, { status: 404 })
    }

    const redirectQuery = req.nextUrl.searchParams.get('redirect')
    const isRedirect = redirectQuery === '1'

    // fail-closed audit event before issuing signed URL
    const { error: auditErr } = await (admin as any)
      .from('audit_events')
      .insert({
        workspace_id: workspaceId,
        actor_id: operatorUserId,
        event_type: 'business_document_view',
        entity_type: 'business_verification',
        metadata: { via: isRedirect ? 'redirect' : 'json' },
      })

    if (auditErr) {
      console.error('[business-document] Audit event insert failed')
      return noStoreJson({ error: '서류를 불러오지 못했어요.' }, { status: 500 })
    }

    const { data: signedData, error: signErr } = await (admin as any)
      .storage
      .from(BUSINESS_DOCUMENT_BUCKET)
      .createSignedUrl(documentPath, 60)

    if (signErr || !signedData?.signedUrl) {
      return noStoreJson(
        { error: '사업자등록증을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' },
        { status: 500 },
      )
    }

    if (isRedirect) {
      const res = NextResponse.redirect(signedData.signedUrl, 302)
      res.headers.set('Cache-Control', 'no-store')
      return res
    }

    return noStoreJson(
      { url: signedData.signedUrl, expiresIn: 60 },
      { status: 200 },
    )
  } catch (err: unknown) {
    if (
      err instanceof OperatorAccessError ||
      (err && typeof err === 'object' && ('code' in err || (err as any).name === 'OperatorAccessError'))
    ) {
      const status = (err as any).code === 'AUTH_REQUIRED' ? 401 : 403
      return noStoreJson({ error: '권한이 없어요.' }, { status })
    }

    console.error('[business-document] Error:', err instanceof Error ? err.name : 'unknown')
    return noStoreJson(
      { error: '서류를 불러오지 못했어요.' },
      { status: 500 },
    )
  }
}
