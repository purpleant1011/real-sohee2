import { describe, expect, it } from 'vitest'
import { pgClient, query } from './pg-client'
import { SupabaseReconcileStore } from '../../../src/features/admin/reconcile/repository'
import { guardExternalRetry, loadReconcileQueue, manualConfirm } from '../../../src/features/admin/reconcile/service'

const ws = 'e1559000-0000-4000-8000-000000000001'
const actor = 'e1559000-0000-4000-8000-000000000002'
const requestId = 'e1559000-0000-4000-8000-000000000003'
const attemptId = 'e1559000-0000-4000-8000-000000000004'
const client = pgClient()

describe('ANI-1559 isolated PostgreSQL reconcile contract', () => {
  it('does not count accepted as verified; denies retry and appends reasoned audit without promoting DB status', async () => {
    query(`with u as (insert into auth.users(id) values ('${actor}') returning id) select id from u`)
    query(`with w as (insert into workspaces(id,name,created_by) values ('${ws}','대사 통합 검사','${actor}') returning id) select id from w`)
    query(`with r as (insert into external_action_requests(id, workspace_id, channel, action_kind, target_external_id, target_label, exact_payload, idempotency_key, status, created_by) values ('${requestId}','${ws}','instagram','feed_publish','evidence-target','대상','{}','ani1559-fixture','unknown_result','${actor}') returning id) select id from r`)
    query(`with a as (insert into external_action_attempts(id,workspace_id,action_request_id,attempt_number,status,provider_reference,created_by) values ('${attemptId}','${ws}','${requestId}',1,'unknown_result','external-post','${actor}') returning id) select id from a`)
    const db = new SupabaseReconcileStore(client as never)
    const before = await loadReconcileQueue({ scopes: [ws] }, db)
    expect(before.items.map(item => item.kind)).toEqual(['RESULT_UNKNOWN'])
    expect(before.verifiedCount).toBe(0)
    await expect(guardExternalRetry({ workspaceId: ws, requestId }, db)).rejects.toThrow('대사')
    await manualConfirm({ workspaceId: ws, requestId, operatorId: actor, reason: '제공자 화면과 결과 비교', decision: 'POST_PRESENT' }, db)
    expect(query<{ event_type: string; metadata: { reason: string; decision: string } }>(`select event_type, metadata from audit_events where workspace_id='${ws}' and entity_id='${requestId}'`)).toEqual([{ event_type: 'admin.reconcile.manual_confirm', metadata: { decision: 'POST_PRESENT', reason: '제공자 화면과 결과 비교' } }])
    expect(query<{ status: string }>(`select status from external_action_requests where id='${requestId}'`)[0].status).toBe('unknown_result')
  })
})
