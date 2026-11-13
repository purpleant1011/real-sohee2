export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { authenticateWorkspaceMember } from '@/features/vault/query/auth'
import {
  SupabaseVaultQueryRepository,
  VaultQueryService,
} from '@/features/vault/query/vault-query-service'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params

  const auth = await authenticateWorkspaceMember(workspaceId)
  if (!auth.success) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  const ymParam = request.nextUrl.searchParams.get('ym')
  if (ymParam && !/^\d{4}-\d{2}$/.test(ymParam)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INVALID_QUERY_PARAMS',
          message: `ym 파라미터는 YYYY-MM 형식이어야 합니다: ${ymParam}`,
        },
      },
      { status: 400 },
    )
  }

  try {
    const repository = new SupabaseVaultQueryRepository(auth.context.supabase)
    const service = new VaultQueryService(repository)
    const result = await service.getCalendar(workspaceId, ymParam || undefined)

    return NextResponse.json(
      { success: true, data: result },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
      },
    )
  } catch (err: any) {
    console.error('[Vault Calendar API] GET failed:', err)
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'FETCH_VAULT_CALENDAR_FAILED',
          message: '보관함을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
        },
      },
      { status: 500 },
    )
  }
}
