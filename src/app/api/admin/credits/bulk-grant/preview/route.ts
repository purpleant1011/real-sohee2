import { NextRequest, NextResponse } from 'next/server'
import { requireOperator } from '@/features/operator-auth/require-operator'
import { OperatorAccessError } from '@/features/operator-auth/current-operator'
import { bulkAudienceSchema } from '@/features/operator-credits/bulk-grant-schemas'
import { previewBulkGrant } from '@/features/operator-credits/bulk-grant-repository'

export async function POST(req: NextRequest) {
  try {
    await requireOperator('credit.adjust.approve')
    const input = bulkAudienceSchema.safeParse(await req.json())
    if (!input.success) return NextResponse.json({ error: '대상과 최근 가입 기간을 확인해 주세요.' }, { status: 400 })
    return NextResponse.json(await previewBulkGrant(input.data))
  } catch (error) {
    if (error instanceof OperatorAccessError) return NextResponse.json({ error: error.message }, { status: error.code === 'AUTH_REQUIRED' || error.code === 'MFA_REQUIRED' ? 401 : 403 })
    return NextResponse.json({ error: '대상을 확인하지 못했어요. 다시 시도해 주세요.' }, { status: 500 })
  }
}
