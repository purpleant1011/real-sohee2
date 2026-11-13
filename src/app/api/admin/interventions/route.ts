export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOperator } from '@/features/operator-auth/require-operator'
import { OperatorAccessError } from '@/features/operator-auth/current-operator'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { previewIntervention, interventionInput, executeIntervention } from '@/features/admin/interventions/service'

const previewSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('WORKSPACE'), workspaceId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('CHANNEL'), workspaceId: z.string().uuid(), channel: z.enum(['instagram', 'threads', 'naver_blog', 'daangn_business']) }).strict(),
  z.object({ kind: z.literal('GLOBAL'), workspaceId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('CREDIT'), workspaceId: z.string().uuid(), amount: z.number().int().positive().max(50000) }).strict(),
])
const denied = (error: unknown) => NextResponse.json({ error: error instanceof OperatorAccessError ? error.message : '상태를 확인하지 못했어요' }, { status: error instanceof OperatorAccessError ? 403 : 503 })
const permission = (kind: string, read: boolean) => kind === 'CREDIT' ? read ? 'credit.read' : 'credit.adjust.request' : read ? 'runtime_control.read' : 'runtime_control.change.request'

export async function PUT(request: Request) {
  const input = previewSchema.safeParse(await request.json().catch(() => null))
  if (!input.success) return NextResponse.json({ error: '대상과 유형을 다시 확인해 주세요' }, { status: 400 })
  try {
    await requireOperator(permission(input.data.kind, true), input.data.kind === 'GLOBAL' ? undefined : input.data.workspaceId)
    const result = await previewIntervention(createAdminSupabaseClient() as never, input.data)
    return NextResponse.json({ data: result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return denied(error) }
}

export async function POST(request: Request) {
  const input = interventionInput.safeParse(await request.json().catch(() => null))
  if (!input.success) return NextResponse.json({ error: '사유와 확인, 대상 및 요청 번호를 다시 확인해 주세요' }, { status: 400 })
  try {
    const operator = await requireOperator(permission(input.data.kind, false), input.data.kind === 'GLOBAL' ? undefined : input.data.workspaceId)
    const result = await executeIntervention(createAdminSupabaseClient() as never, operator.userId, input.data)
    return NextResponse.json({ data: result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return denied(error) }
}
