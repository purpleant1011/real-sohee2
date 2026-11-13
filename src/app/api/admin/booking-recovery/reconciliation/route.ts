import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOperator } from '@/features/operator-auth/require-operator'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { loadReconciliationSupportQueue } from '@/features/capabilities/reconciliation-support'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'no-store' }

/** Read-only support view. No resend or manual-success command is exposed. */
export async function GET(request: Request) {
  const parsed = z.string().uuid().safeParse(new URL(request.url).searchParams.get('workspaceId'))
  if (!parsed.success) return NextResponse.json({ error: '확인할 사업장을 선택해 주세요.' }, { status: 400, headers })
  const workspaceId = parsed.data
  try {
    await requireOperator('booking.read', workspaceId)
  } catch {
    return NextResponse.json({ error: '운영자 권한을 확인해 주세요.' }, { status: 403, headers })
  }
  try {
    const result = await loadReconciliationSupportQueue({
      client: createAdminSupabaseClient(), workspaceId,
      authorize: id => requireOperator('booking.read', id),
    })
    return NextResponse.json(result, { headers })
  } catch {
    return NextResponse.json({ error: '결과 확인 목록을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.' }, { status: 503, headers })
  }
}
