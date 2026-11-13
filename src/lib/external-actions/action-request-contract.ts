import { PersistenceError } from '@/lib/errors/persistence-error'

export class ActionRequestConflictError extends PersistenceError {
  readonly status = 409

  constructor() {
    super('createActionRequest', '같은 요청 키에 다른 작업 또는 승인 내용이 지정되었습니다.', undefined, 'IDEMPOTENCY_CONFLICT')
    Object.setPrototypeOf(this, new.target.prototype)
    this.name = 'ActionRequestConflictError'
  }
}

export interface ActionRequestContract {
  workspace_id: string
  channel: string
  action_kind: string
  target_external_id: string
  exact_payload: Record<string, unknown>
  content_version_id?: string | null
  approval_id?: string | null
  approval_fingerprint?: string | null
}

// Compare the persisted JSON representation: object order is immaterial, array order is not.
function canonicalJson(value: unknown): string {
  const json = JSON.parse(JSON.stringify(value)) as unknown
  function ordered(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(ordered)
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, ordered(child)]))
    }
    return item
  }
  return JSON.stringify(ordered(json))
}

export function assertSameActionRequest(existing: ActionRequestContract, expected: ActionRequestContract): void {
  const fields = ['workspace_id', 'channel', 'action_kind', 'target_external_id', 'content_version_id', 'approval_id', 'approval_fingerprint'] as const
  if (fields.some((field) => (existing[field] ?? null) !== (expected[field] ?? null))
    || canonicalJson(existing.exact_payload) !== canonicalJson(expected.exact_payload)) {
    throw new ActionRequestConflictError()
  }
}

export async function findMatchingActionRequest(db: any, idempotencyKey: string, contract: ActionRequestContract) {
  const result = await db.from('external_action_requests')
    .select('id, status, idempotency_key, workspace_id, channel, action_kind, target_external_id, exact_payload, content_version_id, approval_id, approval_fingerprint')
    .eq('workspace_id', contract.workspace_id)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  if (result.error) throw new PersistenceError('findActionRequest', '작업 요청을 조회하지 못했습니다.', result.error)
  if (result.data) assertSameActionRequest(result.data, contract)
  return result.data
}
