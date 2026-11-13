export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { createCatalogActor } from '@/features/service-catalog/server'
import {
  CatalogConflictError,
  CatalogForbiddenError,
  CatalogInvalidError,
  CatalogNotFoundError,
  CatalogUnavailableError,
  updateCatalogService,
} from '@/features/service-catalog/catalog-service'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; serviceId: string }> },
) {
  const { workspaceId, serviceId } = await params
  const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
  if (isResponse(auth)) return auth
  const body = await request.json().catch(() => null)
  try {
    const result = await updateCatalogService(createCatalogActor(auth), serviceId, body)
    return NextResponse.json(result, { headers: NO_STORE })
  } catch (error) {
    if (error instanceof CatalogForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403, headers: NO_STORE })
    }
    if (error instanceof CatalogInvalidError) {
      return NextResponse.json({ error: error.message, issues: error.issues }, { status: 422, headers: NO_STORE })
    }
    if (error instanceof CatalogNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404, headers: NO_STORE })
    }
    if (error instanceof CatalogConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409, headers: NO_STORE })
    }
    if (error instanceof CatalogUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503, headers: NO_STORE })
    }
    console.error('[service-catalog] unexpected failure', error)
    return NextResponse.json({ error: '서비스를 저장하지 못했어요.' }, { status: 500, headers: NO_STORE })
  }
}
