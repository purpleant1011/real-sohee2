import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOperator } from '@/features/operator-auth/require-operator'
import { OperatorAccessError } from '@/features/operator-auth/current-operator'
import { SupabaseReconcileStore } from '@/features/admin/reconcile/repository'
import { guardExternalRetry, manualConfirm, recheckReadback } from '@/features/admin/reconcile/service'
import { operatorReadbackPort } from '@/features/admin/reconcile/readback-port'

export const dynamic = 'force-dynamic'
const schema = z.object({
  action: z.enum(['retry', 'readback', 'manual_confirm']),
  workspaceId: z.string().uuid(), requestId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500).optional(),
  decision: z.enum(['POST_PRESENT', 'POST_ABSENT']).optional(),
}).strict()

export async function POST(request: Request) {
  let input: z.infer<typeof schema>
  try { input = schema.parse(await request.json()) } catch {
    return NextResponse.json({ error: '대사 요청을 확인해 주세요.' }, { status: 400 })
  }
  try {
    const actor = await requireOperator('publish.reconcile.request', input.workspaceId)
    if (input.action === 'manual_confirm' && (!input.reason || !input.decision)) {
      return NextResponse.json({ error: '수동 확정 사유와 판단을 입력해 주세요.' }, { status: 400 })
    }
    const store = new SupabaseReconcileStore()
    if (input.action === 'retry') await guardExternalRetry(input, store)
    if (input.action === 'manual_confirm') {
      const result = await manualConfirm({ ...input, operatorId: actor.userId, reason: input.reason!, decision: input.decision! }, store)
      return NextResponse.json(result)
    }
    const result = await recheckReadback({ ...input, operatorId: actor.userId }, store, operatorReadbackPort)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const status = error instanceof OperatorAccessError
      ? error.code === 'AUTH_REQUIRED' || error.code === 'MFA_REQUIRED' ? 401 : 403
      : message.includes('대사로 게시') ? 409 : 503
    return NextResponse.json({ error: status === 503 ? '대사 기록 또는 조회에 접근하지 못했습니다. 나중에 다시 확인해 주세요.' : status === 401 || status === 403 ? '운영자 권한을 확인해 주세요.' : message }, { status })
  }
}
