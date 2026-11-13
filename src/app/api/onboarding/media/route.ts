export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { canPublishUploadedMedia } from '@/features/media/media-rights'
import { beginMediaUpload, completeMediaUpload, withdrawMediaRights, MediaUploadError } from '@/features/media/media-upload'
import { resolveFirstValueSourceIds, firstValueSourceCookieName, FirstValueSourceError } from '@/features/media/first-value-source'

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const auth = await authorizeQuickRequest(request.headers.get('x-workspace-id') || body?.workspaceId, { requireRole: 'manager' })
  if (isResponse(auth)) return auth
  try {
    const context = { admin: auth.admin, workspaceId: auth.workspaceId, userId: auth.userId }
    if (body?.action === 'begin') {
      return NextResponse.json(await beginMediaUpload({ ...context, input: body.input }), { headers: { 'Cache-Control': 'private, no-store' } })
    }
    const assetId = z.string().uuid().safeParse(body?.assetId)
    if (body?.action === 'withdraw' && assetId.success) {
      return NextResponse.json(await withdrawMediaRights({ ...context, assetId: assetId.data }), { headers: { 'Cache-Control': 'private, no-store' } })
    }
    if (body?.action === 'complete' && assetId.success) {
      return NextResponse.json(await completeMediaUpload({ ...context, assetId: assetId.data }), { headers: { 'Cache-Control': 'private, no-store' } })
    }
    const selectId = z.union([z.string().uuid(), z.literal('none')]).safeParse(body?.assetId)
    if (body?.action === 'select' && selectId.success) {
      await resolveFirstValueSourceIds({ admin: auth.admin, workspaceId: auth.workspaceId, explicitAssetId: selectId.data })
      const cookieName = firstValueSourceCookieName(auth.workspaceId)
      const isProd = process.env.NODE_ENV === 'production'
      const response = NextResponse.json({ selected: true }, { headers: { 'Cache-Control': 'private, no-store' } })
      response.cookies.set({
        name: cookieName,
        value: selectId.data,
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 86400,
        secure: isProd,
      })
      return response
    }
    return NextResponse.json({ error: '사진 저장 요청을 확인해 주세요.', code: 'INVALID_UPLOAD_ACTION' }, { status: 422 })
  } catch (error) {
    if (error instanceof FirstValueSourceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    if (error instanceof MediaUploadError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    return NextResponse.json({ error: '사진 저장 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.', code: 'MEDIA_UPLOAD_FAILED' }, { status: 503 })
  }
}

export async function GET(request: Request) {
  const auth = await authorizeQuickRequest(request.headers.get('x-workspace-id'))
  if (isResponse(auth)) return auth
  const { data, error } = await auth.admin.from('media_assets')
    .select('id,workspace_id,provenance_kind,mime_type,rights_status,publish_eligibility,lifecycle_status,generation_metadata,created_at')
    .eq('workspace_id', auth.workspaceId).eq('provenance_kind', 'USER_UPLOAD')
    .eq('lifecycle_status', 'READY').order('created_at', { ascending: false }).limit(20)
  if (error || !Array.isArray(data)) return NextResponse.json({ error: '저장한 사진을 불러오지 못했어요.', code: 'MEDIA_READ_FAILED' }, { status: 503 })
  const items = data.filter((asset: any) => asset.workspace_id === auth.workspaceId).map((asset: any) => ({
    id: asset.id, mime_type: asset.mime_type, rights_status: asset.rights_status,
    publish_eligibility: canPublishUploadedMedia(asset, auth.workspaceId), created_at: asset.created_at,
  }))
  return NextResponse.json({ items }, { headers: { 'Cache-Control': 'private, no-store' } })
}
