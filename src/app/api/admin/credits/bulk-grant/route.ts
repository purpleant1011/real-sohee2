import { NextRequest, NextResponse } from 'next/server'
import { requireOperator } from '@/features/operator-auth/require-operator'
import { OperatorAccessError } from '@/features/operator-auth/current-operator'
import { bulkGrantSchema } from '@/features/operator-credits/bulk-grant-schemas'
import { grantBulkCredits } from '@/features/operator-credits/bulk-grant-repository'

export async function POST(req: NextRequest) {
  try {
    const operator = await requireOperator('credit.adjust.approve')
    const input = bulkGrantSchema.safeParse(await req.json())
    if (!input.success) return NextResponse.json({ error: '지급 대상, 수량, 사유와 요청 값을 확인해 주세요.' }, { status: 400 })
    return NextResponse.json(await grantBulkCredits(operator.userId, input.data))
  } catch (error) {
    if (error instanceof OperatorAccessError) return NextResponse.json({ error: error.message }, { status: error.code === 'AUTH_REQUIRED' || error.code === 'MFA_REQUIRED' ? 401 : 403 })
    return NextResponse.json({ error: error instanceof Error && /[가-힣]/.test(error.message) ? error.message : '지급 요청을 처리하지 못했어요.' }, { status: 500 })
  }
}
