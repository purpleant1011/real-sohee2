export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { authenticateWorkspaceMember } from '@/features/vault/query/auth'
import { readInterventionState } from '@/features/admin/interventions/read-state'
import {
  SupabaseVaultQueryRepository,
  VaultQueryService,
} from '@/features/vault/query/vault-query-service'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params

  const auth = await authenticateWorkspaceMember(workspaceId)
  if (!auth.success) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  try {
    const repository = new SupabaseVaultQueryRepository(auth.context.supabase)
    const service = new VaultQueryService(repository)
    const [summary, safety] = await Promise.all([service.getSummary(workspaceId), readInterventionState(auth.context.supabase, workspaceId)])
    const result = { ...summary, intervention: safety }

    return NextResponse.json(
      { success: true, data: result },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
      },
    )
  } catch (err: any) {
    console.error('[Vault Summary API] GET failed:', err)
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'FETCH_VAULT_SUMMARY_FAILED',
          message: '보관함을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
        },
      },
      { status: 500 },
    )
  }
}
