export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { reconcileMetaVerifications } from '@/lib/external-actions/reconcile-meta-verification'

import { requireOperator } from '@/features/operator-auth/require-operator'
import { OperatorAccessError } from '@/features/operator-auth/current-operator'

export async function POST(req: Request) {
  try {
    let targetWorkspaceId: string | undefined
    try {
      const body = await req.json()
      if (body?.workspaceId) {
        targetWorkspaceId = body.workspaceId
      }
    } catch {
      // Body is optional
    }

    try {
      await requireOperator('publish.reconcile.request', targetWorkspaceId)
    } catch (authErr: any) {
      if (authErr instanceof OperatorAccessError && authErr.code === 'AUTH_REQUIRED') {
        return NextResponse.json({ error: '인증 세션이 필요합니다.' }, { status: 401 })
      }
      return NextResponse.json(
        { error: authErr?.code || 'PERMISSION_DENIED', message: authErr?.message || 'AAL2 운영자 권한이 필요합니다.' },
        { status: 403 }
      )
    }

    const report = await reconcileMetaVerifications(targetWorkspaceId)

    return NextResponse.json({
      success: true,
      report,
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Reconciliation error' },
      { status: 500 },
    )
  }
}
