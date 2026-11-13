export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { createCatalogActor } from '@/features/service-catalog/server'
import {
  CatalogForbiddenError,
  CatalogInvalidError,
  CatalogUnavailableError,
  createCatalogService,
  listCatalogServices,
} from '@/features/service-catalog/catalog-service'

const NO_STORE = { 'Cache-Control': 'no-store' }

function failure(error: unknown) {
  if (error instanceof CatalogForbiddenError) {
    return NextResponse.json({ error: error.message }, { status: 403, headers: NO_STORE })
  }
  if (error instanceof CatalogInvalidError) {
    return NextResponse.json(
      { error: error.message, issues: error.issues },
      { status: 422, headers: NO_STORE },
    )
  }
  if (error instanceof CatalogUnavailableError) {
    return NextResponse.json({ error: error.message }, { status: 503, headers: NO_STORE })
  }
  console.error('[service-catalog] unexpected failure', error)
  return NextResponse.json({ error: '서비스 카탈로그를 처리하지 못했어요.' }, { status: 500, headers: NO_STORE })
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params
  const auth = await authorizeQuickRequest(workspaceId)
  if (isResponse(auth)) return auth
  try {
    const services = await listCatalogServices(createCatalogActor(auth).gateway, auth.workspaceId)
    return NextResponse.json({ services, canEdit: auth.role === 'owner' || auth.role === 'manager' }, { headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params
  const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
  if (isResponse(auth)) return auth
  const body = await request.json().catch(() => null)
  try {
    const result = await createCatalogService(createCatalogActor(auth), body)
    return NextResponse.json(result, { status: 201, headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}
