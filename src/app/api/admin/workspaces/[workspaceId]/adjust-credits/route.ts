export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { requireOperator } from '@/features/operator-auth/require-operator'
import { OperatorAccessError } from '@/features/operator-auth/current-operator'

const paramsSchema = z.object({
  workspaceId: z.string().uuid({ message: '유효한 워크스페이스 UUID가 필요합니다.' }),
})

const adjustCreditsBodySchema = z.object({
  amount: z
    .number({ message: '0이 아닌 유효한 크레딧 수량이 필요합니다.' })
    .int({ message: '크레딧 수량은 정수여야 합니다.' })
    .refine((val) => val !== 0, {
      message: '0이 아닌 유효한 크레딧 수량이 필요합니다.',
    }),
  reason: z
    .string()
    .trim()
    .min(1, '크레딧 조정 사유(reason) 입력이 필수입니다.')
    .max(500, '사유는 최대 500자까지 가능합니다.'),
  idempotencyKey: z
    .string()
    .trim()
    .min(1, '중복 지급 방지를 위한 고유 idempotencyKey가 필수입니다.')
    .max(200, 'idempotencyKey는 최대 200자까지 가능합니다.'),
  approverId: z.string().uuid({ message: '유효한 승인자 UUID 형식이어야 합니다.' }).optional().nullable(),
  approverOperatorId: z.string().uuid({ message: '유효한 승인자 UUID 형식이어야 합니다.' }).optional().nullable(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const rawParams = await params
    const parsedParams = paramsSchema.safeParse(rawParams)
    if (!parsedParams.success) {
      return NextResponse.json({ error: parsedParams.error.issues[0]?.message ?? '잘못된 파라미터입니다.' }, { status: 400 })
    }
    const { workspaceId } = parsedParams.data

    const operator = await requireOperator('credit.adjust.request', workspaceId)

    let bodyJson: unknown
    try {
      bodyJson = await req.json()
    } catch {
      return NextResponse.json({ error: '올바른 JSON 요청 본문이 필요합니다.' }, { status: 400 })
    }

    const parsedBody = adjustCreditsBodySchema.safeParse(bodyJson)
    if (!parsedBody.success) {
      return NextResponse.json({ error: parsedBody.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 })
    }

    const { amount, reason, idempotencyKey, approverOperatorId, approverId } = parsedBody.data
    const candidateApprover = approverOperatorId || approverId || null

    // Dual control check for high-value (> 50,000 SC)
    if (Math.abs(amount) > 50000) {
      if (!candidateApprover) {
        return NextResponse.json({ error: '고액 크레딧 조정(50,000 SC 초과)은 승인자(approver) 지정이 필수입니다.' }, { status: 400 })
      }
      if (candidateApprover === operator.userId) {
        return NextResponse.json({ error: '고액 크레딧 조정 시 요청자 본인을 승인자로 지정할 수 없습니다.' }, { status: 400 })
      }
    }

    // Query credit_accounts with service client after workspace-scoped operator permission check.
    // The session client is RLS-filtered to the operator's workspace membership and fails to see
    // the customer's account.
    const adminSupabase = createAdminSupabaseClient()
    const { data: accounts, error: accountError } = await (adminSupabase as any)
      .from('credit_accounts')
      .select('id, period_start, period_end, created_at')
      .eq('workspace_id', workspaceId)
      .order('period_end', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })

    if (accountError) {
      console.error('[adjust-credits] Failed to fetch credit accounts:', accountError)
      return NextResponse.json({ error: '크레딧 계좌 조회 실패' }, { status: 500 })
    }

    if (!accounts || accounts.length === 0) {
      return NextResponse.json(
        { error: '해당 워크스페이스의 크레딧 계좌가 존재하지 않습니다.' },
        { status: 404 },
      )
    }

    // Prioritize active period (period_start <= today AND period_end >= today in KST/Asia/Seoul),
    // then deterministic fallback to the latest account.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
    const activeAccount = accounts.find(
      (a: { period_start: string; period_end: string }) => a.period_start <= today && a.period_end >= today,
    )
    const targetAccount = activeAccount ?? accounts[0]

    // The RPC atomically commits the ledger and audit event; never fall back
    // to direct writes (nor attempt compensating deletes on audit failure).
    const { data: rpcResult, error: rpcError } = await (adminSupabase as any).rpc('apply_operator_credit_adjustment', {
      p_workspace_id: workspaceId,
      p_account_id: targetAccount.id,
      p_amount: amount,
      p_reason: reason.trim(),
      p_idempotency_key: idempotencyKey.trim(),
      p_operator_id: operator.userId,
      p_approver_id: candidateApprover,
    })

    if (rpcError || !rpcResult || typeof rpcResult !== 'object' || Array.isArray(rpcResult) || rpcResult.success !== true) {
      console.error('[adjust-credits] Atomic RPC failed:', rpcError)
      return NextResponse.json({ error: '크레딧 원자적 조정에 실패했습니다. 원장에 변경 사항을 기록하지 않았습니다.' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      workspaceId,
      isReplay: rpcResult.is_replay,
      adjustedAmount: rpcResult.adjusted_amount,
      newAuthoritativeBalance: rpcResult.new_balance,
      message: rpcResult.message,
    })
  } catch (error) {
    if (error instanceof OperatorAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.code === 'AUTH_REQUIRED' || error.code === 'MFA_REQUIRED' ? 401 : 403 })
    }
    console.error('[adjust-credits] Server error:', error)
    return NextResponse.json({ error: '크레딧 조정 처리 실패' }, { status: 500 })
  }
}

