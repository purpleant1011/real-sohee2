import { describe, expect, it, vi } from 'vitest'
import { classifyQueue, countVerified, guardExternalRetry, manualConfirm, recheckReadback, loadReconcileQueue, type ReconcileStore } from './service'

const ws = 'e1111111-1111-4111-8111-111111111111'
const id = 'e2222222-2222-4222-8222-222222222222'
const operator = 'e3333333-3333-4333-8333-333333333333'
const request = { id, workspace_id: ws, channel: 'instagram', status: 'unknown_result', failure_code: 'UNKNOWN_RESULT', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:10:00Z' }
const attempt = { id: 'e4444444-4444-4444-8444-444444444444', action_request_id: id, workspace_id: ws, status: 'unknown_result', provider_request_id: 'secret-request', provider_reference: 'post-1', started_at: '2026-10-01T00:01:00Z', finished_at: '2026-10-01T00:10:00Z' }
const receipt = { id: 'e5555555-5555-4555-8555-555555555555', action_request_id: id, workspace_id: ws, receipt_kind: 'observed_result', provider_reference: 'post-1', result_url: 'https://instagram.com/p/post?access_token=SECRET', observed_payload: { verified: true, read_after_write: true, access_token: 'SECRET' }, recorded_at: '2026-10-01T00:02:00Z' }

function store(overrides: Partial<ReconcileStore> = {}): ReconcileStore {
  return {
    listRequests: vi.fn().mockResolvedValue([request]),
    listAttempts: vi.fn().mockResolvedValue([attempt]),
    listReceipts: vi.fn().mockResolvedValue([]),
    loadRequest: vi.fn().mockResolvedValue(request),
    loadProviderReference: vi.fn().mockResolvedValue('post-1'),
    appendAudit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('ANI-1559 reconciliation safety', () => {
  it('classifies unknown, accepted awaiting readback, stalled execution and receipt/DB mismatch without counting accepted as success', () => {
    expect(classifyQueue(request, attempt, [], Date.parse('2026-10-01T01:00:00Z'))?.kind).toBe('RESULT_UNKNOWN')
    expect(classifyQueue({ ...request, status: 'submitted', failure_code: null }, { ...attempt, status: 'submitted' }, [], Date.now())?.kind).toBe('PENDING_READBACK')
    expect(classifyQueue({ ...request, status: 'executing', failure_code: null }, { ...attempt, status: 'claimed' }, [], Date.parse('2026-10-01T01:00:00Z'))?.kind).toBe('EXECUTING_STALLED')
    expect(classifyQueue({ ...request, status: 'submitted', failure_code: null }, attempt, [receipt], Date.now())?.kind).toBe('RECEIPT_DB_MISMATCH')
    expect(countVerified([{ ...request, status: 'submitted', failure_code: null }], [receipt])).toBe(0)
    expect(countVerified([{ ...request, status: 'succeeded', failure_code: null }], [receipt])).toBe(1)
    expect(classifyQueue({ ...request, status: 'succeeded', failure_code: null }, attempt, [], Date.now())?.kind).toBe('RECEIPT_DB_MISMATCH')
    expect(classifyQueue({ ...request, status: 'succeeded', failure_code: null }, { ...attempt, status: 'succeeded' }, [receipt], Date.now())).toBeNull()
  })

  it('rejects blind retry even after a manual declaration; GET-only recheck cannot produce verified success', async () => {
    const db = store()
    await expect(guardExternalRetry({ workspaceId: ws, requestId: id }, db)).rejects.toThrow('대사')
    const readback = vi.fn().mockResolvedValue({ state: 'NOT_FOUND', observedAt: '2026-10-01T01:00:00Z' })
    const result = await recheckReadback({ workspaceId: ws, requestId: id, operatorId: operator }, db, { lookup: readback })
    expect(result.state).toBe('NOT_FOUND')
    await expect(guardExternalRetry({ workspaceId: ws, requestId: id }, db)).rejects.toThrow('대사')
    expect(readback).toHaveBeenCalledTimes(1)
  })

  it('requires a reason, writes a masked durable audit, and does not promote request to succeeded', async () => {
    const db = store()
    await expect(manualConfirm({ workspaceId: ws, requestId: id, operatorId: operator, reason: '   ', decision: 'POST_PRESENT' }, db)).rejects.toThrow('사유')
    expect(db.appendAudit).not.toHaveBeenCalled()
    await manualConfirm({ workspaceId: ws, requestId: id, operatorId: operator, reason: '관리자 확인: 게시 증거 검토', decision: 'POST_PRESENT' }, db)
    expect(db.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: ws, actor_id: operator, event_type: 'admin.reconcile.manual_confirm', metadata: { decision: 'POST_PRESENT', reason: '관리자 확인: 게시 증거 검토' } }))
    expect(db.loadRequest).toHaveBeenCalled()
  })

  it('distinguishes DB failure from an empty queue and does not expose raw response secrets', async () => {
    await expect(loadReconcileQueue({ scopes: 'all' }, store({ listRequests: vi.fn().mockRejectedValue(new Error('db offline')) }))).rejects.toThrow()
    const empty = await loadReconcileQueue({ scopes: 'all' }, store({ listRequests: vi.fn().mockResolvedValue([]) }))
    expect(empty.items).toEqual([])
    const populated = await loadReconcileQueue({ scopes: 'all' }, store({ listReceipts: vi.fn().mockResolvedValue([receipt]) }))
    expect(JSON.stringify(populated)).not.toContain('SECRET')
    expect(JSON.stringify(populated)).not.toContain('secret-request')
    expect(JSON.stringify(populated)).not.toContain('access_token')
    expect(populated.items).toHaveLength(1)
    await expect(loadReconcileQueue({ scopes: 'all' }, store({ listReceipts: vi.fn().mockRejectedValue(new Error('receipt query failed')) }))).rejects.toThrow()
    const found = await recheckReadback({ workspaceId: ws, requestId: id, operatorId: operator }, store(), { lookup: async () => ({ state: 'FOUND', observedAt: '2026-10-01T01:00:00Z' }) })
    expect(found.state).toBe('FOUND')
    expect(countVerified([{ ...request, status: 'unknown_result' }], [receipt])).toBe(0)
  })
})
