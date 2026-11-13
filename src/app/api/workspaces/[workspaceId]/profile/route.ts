import { NextResponse } from 'next/server'
import {
  saveWorkspaceProfile,
  getWorkspaceProfile,
} from '@/lib/profile/workspace-profile-service'
import { SupabasePersistenceError } from '@/lib/supabase/require-success'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  props: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await props.params

  if (!workspaceId) {
    return NextResponse.json({ error: 'WORKSPACE_ID_REQUIRED' }, { status: 400 })
  }

  // Cross-tenant guard (E2E-F F-2): a non-member must be refused before any profile read,
  // not answered with a 200 shell that only RLS happens to empty out.
  const auth = await authorizeQuickRequest(workspaceId)
  if (isResponse(auth)) return auth

  try {
    const profile = await getWorkspaceProfile({ workspaceId })
    return NextResponse.json({ success: true, profile }, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'GET_PROFILE_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

export async function POST(
  request: Request,
  props: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await props.params

  if (!workspaceId) {
    return NextResponse.json({ error: 'WORKSPACE_ID_REQUIRED' }, { status: 400 })
  }

  // Cross-tenant guard (E2E-F F-2): refuse a non-member before any profile write.
  const auth = await authorizeQuickRequest(workspaceId)
  if (isResponse(auth)) return auth

  try {
    const body = await request.json()
    const { business, brand } = body || {}

    if (!business || !business.businessName || !business.businessName.trim()) {
      return NextResponse.json(
        { error: 'INVALID_INPUT', message: '사업체명(businessName)은 필수 항목입니다.' },
        { status: 400 }
      )
    }

    const saved = await saveWorkspaceProfile({
      workspaceId,
      business,
      brand: brand || {},
    })

    return NextResponse.json(
      {
        success: true,
        profile: saved,
        readbackVerified: saved.readbackVerified,
      },
      { status: 200 }
    )
  } catch (error) {
    if (error instanceof SupabasePersistenceError) {
      return NextResponse.json(
        {
          error: 'PERSISTENCE_FAILED',
          code: error.code,
          message: error.message,
          details: error.details,
        },
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        error: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
