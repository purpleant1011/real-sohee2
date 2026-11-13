export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { requireOperator } from '@/features/operator-auth/require-operator'
import { OperatorAccessError } from '@/features/operator-auth/current-operator'

export interface GovernanceApprovalItem {
  id: string
  title: string
  domain: string
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  sourceKind: 'CANONICAL' | 'DEMO_FIXTURE'
  proposerActorId: string
  proposerEmail: string
  proposedAt: string
  reason: string
  status: 'PENDING_SECOND_APPROVAL' | 'APPROVED' | 'REJECTED' | 'POLICY_BLOCKED'
  isExecutable: boolean
  correlationId: string
}

// operator_audit_sessions is not in the generated Database types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const untypedAdmin = () => createAdminSupabaseClient() as any

const approvalSchema = z.object({
  requestId: z.string().min(1),
  action: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().optional(),
  stepUpToken: z.unknown().optional(), // legacy UI field: never an authentication credential
})

export async function GET() {
  try {
    const operator = await requireOperator('admin.read')
    const { data: dbApprovals, error } = await untypedAdmin()
      .from('operator_audit_sessions')
      .select('*')
      .eq('is_active', true)
      .order('opened_at', { ascending: false })

    if (error) throw error
    const canonicalItems: GovernanceApprovalItem[] = (dbApprovals || []).map((item: any) => ({
      id: item.session_id,
      title: item.reason || '고위험 런타임 제어 요청',
      domain: 'RUNTIME_CONTROL',
      riskLevel: 'CRITICAL',
      sourceKind: 'CANONICAL',
      proposerActorId: item.operator_id,
      proposerEmail: item.operator_id,
      proposedAt: item.opened_at,
      reason: item.reason,
      status: 'PENDING_SECOND_APPROVAL',
      isExecutable: true,
      correlationId: item.audit_receipt_hash || item.session_id,
    }))

    return NextResponse.json({
      success: true,
      approvals: canonicalItems,
      asOf: new Date().toISOString(),
      activeOperatorId: operator.userId,
      denominator: { totalPending: canonicalItems.length, canonicalPending: canonicalItems.length, demoPending: 0 },
    })
  } catch (error) {
    if (error instanceof OperatorAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.code === 'AUTH_REQUIRED' || error.code === 'MFA_REQUIRED' ? 401 : 403 })
    }
    return NextResponse.json({ error: '승인 대기 목록 조회 실패' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    // This is a global runtime-control operation, not governance.read.
    const operator = await requireOperator('runtime_control.change.request')
    const parsed = approvalSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'requestId와 action (APPROVE/REJECT)을 확인해 주세요.' }, { status: 400 })
    }
    const { requestId, action, reason } = parsed.data
    if (requestId.startsWith('req-40') || requestId.includes('demo') || requestId.includes('fixture')) {
      return NextResponse.json({ error: 'DEMO/SYNTHETIC 승인 요청은 프로덕션 권한 실행기에서 처리할 수 없습니다 (mutation blocked).', code: 'FIXTURE_MUTATION_BLOCKED' }, { status: 422 })
    }

    // A request body token is untrusted. Query the authenticated server session,
    // including the subject, to verify the current assurance level.
    const session = await createServerSupabaseClient()
    const { data: claims, error: claimsError } = await session.auth.getClaims()
    if (claimsError || claims?.claims?.sub !== operator.userId) {
      return NextResponse.json({ error: 'AAL2 MFA 세션을 확인해 주세요.', code: 'STEP_UP_REQUIRED' }, { status: 401 })
    }
    const { data: aal, error: aalError } = await session.auth.mfa.getAuthenticatorAssuranceLevel()
    if (aalError || aal?.currentLevel !== 'aal2') {
      return NextResponse.json({ error: 'AAL2 MFA 인증이 필요합니다.', code: 'STEP_UP_REQUIRED' }, { status: 401 })
    }

    const admin = untypedAdmin()
    const { data: target, error: sessionError } = await admin
      .from('operator_audit_sessions')
      .select('*')
      .eq('session_id', requestId)
      .maybeSingle()
    if (sessionError) return NextResponse.json({ error: '승인 요청 조회 실패' }, { status: 500 })
    if (!target || !target.is_active) {
      return NextResponse.json({ error: '활성 요청 대상을 찾을 수 없습니다.', code: 'NOT_FOUND' }, { status: 404 })
    }
    if (target.operator_id === operator.userId) {
      return NextResponse.json({ error: '제안자와 승인자는 동일인일 수 없습니다.', code: 'SELF_APPROVAL_FORBIDDEN' }, { status: 403 })
    }

    // Returning the updated row distinguishes success from an RLS miss or a
    // concurrent approval: a 0-row update is never an approval.
    const { data: updated, error: updateError } = await admin
      .from('operator_audit_sessions')
      .update({ is_active: false, closed_at: new Date().toISOString() })
      .eq('session_id', requestId)
      .eq('is_active', true)
      .select('session_id')
    if (updateError) return NextResponse.json({ error: '승인 상태 갱신 실패' }, { status: 500 })
    if (updated?.length !== 1) return NextResponse.json({ error: '이미 처리되었거나 변경되지 않은 요청입니다.' }, { status: 409 })

    const { error: auditError } = await admin.from('audit_events').insert({
      workspace_id: target.workspace_id,
      actor_id: operator.userId,
      entity_type: 'governance_two_man_approval',
      entity_id: requestId,
      event_type: action === 'APPROVE' ? 'two_man_approved' : 'two_man_rejected',
      created_at: new Date().toISOString(),
      metadata: {
        requestId, action, reason: reason || '운영자 2인 교차 승인',
        proposer_id: target.operator_id, approver_id: operator.userId, step_up_verified: true,
      },
    })
    if (auditError) {
      return NextResponse.json({ error: '승인 상태가 변경되었으나 감사 로그 기록에 실패했습니다. 운영자 확인이 필요합니다.' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      requestId,
      status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      message: `2인 승인 요청 [${requestId}]이 성공적으로 ${action === 'APPROVE' ? '최종 승인' : '반려'}되었습니다.`,
    })
  } catch (error) {
    if (error instanceof OperatorAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.code === 'AUTH_REQUIRED' || error.code === 'MFA_REQUIRED' ? 401 : 403 })
    }
    return NextResponse.json({ error: '승인 처리 실패' }, { status: 500 })
  }
}
