export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { readPreferredWorkspaceIdFromCookies } from '@/features/auth/active-workspace.server'
import { resolveCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { validateMissionContract } from '@/lib/mission-os/mission-contract'
import { computeContractApprovalHash } from '@/lib/mission-os/mission-plan-diff'

interface RouteParams { params: Promise<{ id: string }> }

/** Contract consent uses the existing snapshot + transactional mission-event ledger.
 * It is NOT a content/version approval in public.approvals and cannot authorize a post.
 */
export async function POST(req: Request, { params }: RouteParams) {
  try {
    const { id } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증 세션이 필요합니다.' }, { status: 401 })
    const resolution = await resolveCurrentWorkspaceContext(await readPreferredWorkspaceIdFromCookies())
    if (resolution.status !== 'ready') {
      const status = resolution.status === 'expired' ? 401 : resolution.status === 'forbidden' ? 403 : resolution.status === 'missing' ? 404 : 500
      return NextResponse.json({ error: '업무 승인 권한을 확인하지 못했습니다.' }, { status })
    }
    const workspace = resolution.context
    if (workspace.role !== 'owner' && workspace.role !== 'manager') {
      return NextResponse.json({ error: '마케팅 업무 승인 권한이 없습니다.' }, { status: 403 })
    }
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some((key) => !['expectedSnapshotVersion', 'idempotencyKey', 'contractPayloadHash'].includes(key)) ||
      !Number.isSafeInteger(body.expectedSnapshotVersion) || body.expectedSnapshotVersion < 1 ||
      typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.idempotencyKey) ||
      typeof body.contractPayloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.contractPayloadHash)) {
      return NextResponse.json({ error: '검토한 계약 버전과 승인 요청 정보가 필요합니다.' }, { status: 422 })
    }
    const { expectedSnapshotVersion, idempotencyKey, contractPayloadHash } = body
    const read = () => (supabase as any).from('marketing_missions').select('*')
      .eq('id', id).eq('workspace_id', workspace.workspaceId).maybeSingle()
    const { data: mission, error: readError } = await read()
    if (readError) return NextResponse.json({ error: '업무를 조회하지 못했습니다.' }, { status: 500 })
    if (!mission) return NextResponse.json({ error: '업무를 찾을 수 없습니다.' }, { status: 404 })

    const response = (row: any, replayed = false) => NextResponse.json({
      success: true, mission_id: id, contract_version: row.metadata?.contract?.contract_version,
      snapshot_version: row.metadata?.snapshot_version, execution_state: row.metadata?.execution_state, replayed,
    })
    // Durable replay precedes snapshot/expiry/state checks, but NEVER authentication/authorization.
    const replay = (row: any): NextResponse | null => {
      const records = row.metadata?.contract_approvals
      if (!records || !Object.prototype.hasOwnProperty.call(records, idempotencyKey)) return null
      const record = records[idempotencyKey]
      if (record.payload_hash !== contractPayloadHash || record.expected_snapshot_version !== expectedSnapshotVersion) {
        return NextResponse.json({ error: '같은 승인 요청에 다른 계약이 사용되었습니다.', code: 'IDEMPOTENCY_CONFLICT' }, { status: 409 })
      }
      return response(row, true)
    }
    const replayResponse = replay(mission)
    if (replayResponse) return replayResponse
    const metadata = mission.metadata || {}
    if (metadata.snapshot_version !== expectedSnapshotVersion) {
      return NextResponse.json({ error: '업무가 변경되었습니다. 최신 계약을 확인해 주세요.', code: 'STALE_SNAPSHOT_VERSION' }, { status: 409 })
    }
    // Approval is not a resume command. Both the legacy status and the dual-state axis must agree.
    if (metadata.execution_state !== 'NEEDS_DECISION' || !['DRAFT', 'AWAITING_APPROVAL', 'APPROVED'].includes(mission.status)) {
      return NextResponse.json({ error: '현재 업무 상태에서는 계약을 승인할 수 없습니다.', code: 'CONTRACT_APPROVAL_STATE_CONFLICT' }, { status: 409 })
    }
    let contract
    try { contract = validateMissionContract(metadata.contract) } catch {
      return NextResponse.json({ error: '유효한 업무 계약이 필요합니다.' }, { status: 422 })
    }
    if (Date.now() > Date.parse(contract.expires_at)) {
      return NextResponse.json({ error: '계약 유효기간이 만료되었습니다.' }, { status: 422 })
    }
    if (computeContractApprovalHash(contract) !== contractPayloadHash) {
      return NextResponse.json({ error: '검토한 계약과 현재 계약이 다릅니다.', code: 'CONTRACT_PAYLOAD_MISMATCH' }, { status: 409 })
    }
    const approvedAt = new Date().toISOString()
    const record = {
      approval_kind: 'MISSION_CONTRACT', payload_hash: contractPayloadHash,
      expected_snapshot_version: expectedSnapshotVersion, approved_snapshot_version: expectedSnapshotVersion + 1,
      contract_version: contract.contract_version, actor_id: user.id, approved_at: approvedAt,
    }
    const { data: saved, error: saveError } = await (createAdminSupabaseClient() as any).rpc('update_mission_snapshot_atomic', {
      p_workspace_id: workspace.workspaceId, p_mission_id: id, p_expected_snapshot_version: expectedSnapshotVersion,
      p_new_metadata: {
        contract: { ...contract, approval_fingerprint: `appr_${contractPayloadHash}` }, execution_state: 'READY',
        contract_approvals: { ...(metadata.contract_approvals || {}), [idempotencyKey]: record },
      },
      p_new_status: 'APPROVED', p_new_goal: contract.goal, p_new_receipt_id: null,
      p_actor_type: 'user', p_actor_id: user.id, p_event_name: 'MISSION_CONTRACT_EXPLICITLY_APPROVED',
      p_event_payload: { ...record, idempotency_key: idempotencyKey }, p_receipt_entry: null,
    })
    if (saveError || !saved) {
      // A simultaneous identical request may have won. Re-read only, never approve changed terms.
      const latest = await read()
      if (!latest.error && latest.data) {
        const replayResponse = replay(latest.data)
        if (replayResponse) return replayResponse
      }
      return NextResponse.json({ error: '업무가 변경되었거나 승인을 저장하지 못했습니다.', code: 'STALE_SNAPSHOT_VERSION' }, { status: 409 })
    }
    return response(saved)
  } catch {
    return NextResponse.json({ error: '계약 승인을 처리하지 못했습니다.' }, { status: 500 })
  }
}
