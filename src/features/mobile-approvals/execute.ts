import { evaluateExecutionGate, type ExecutionGate, type GateFacts } from './gate'

export type ExecuteStatus = 'REQUESTED' | 'PROVIDER_ACCEPTED' | 'VERIFIED' | 'RESULT_UNKNOWN' | 'MANUAL_REQUIRED'
export type ExecuteResult =
  | { ok: true; status: ExecuteStatus; replayed: boolean; observedAt: string }
  | { ok: false; code: 'NOT_FOUND' | 'GATE_BLOCKED' | 'VERSION_CONFLICT' | 'FINGERPRINT_MISMATCH' | 'INVALID_REQUEST'; gate?: ExecutionGate }

export interface ExecuteRequest { key: string; idempotencyKey: string; expectedVersion: number; expectedFingerprint: string }
/** Server-recomputed truth about the approval item. Never client-supplied. */
export interface ApprovalSnapshot { version: number; fingerprint: string; facts: GateFacts }
export type ProviderOutcome = { kind: 'accepted' } | { kind: 'rejected' } | { kind: 'unknown' }

/** Server-only ports, bound to an authorized workspace and actor before use.
 * No production adapter is provided here; process-memory storage is test-only.
 */
export interface ExecutePorts {
  now: () => string
  loadSnapshot: (key: string) => Promise<ApprovalSnapshot | null>
  /** Replay must match item, version and fingerprint, not just the idempotency key. */
  findByKey: (request: ExecuteRequest) => Promise<ExecuteStatus | null>
  /** Durable atomic claim: revalidate version, fingerprint and gate, reserve the item
   * across ALL idempotency keys, and insert REQUESTED in one transaction.
   * A stale/blocked snapshot returns a failure without calling the provider.
   */
  claim: (request: ExecuteRequest) => Promise<{ fresh: true } | { fresh: false; status: ExecuteStatus } | { blocked: true; result: Extract<ExecuteResult, { ok: false }> }>
  send: (key: string, idempotencyKey: string) => Promise<ProviderOutcome>
  readback: (key: string) => Promise<'verified' | 'not_found' | 'unknown'>
  record: (key: string, idempotencyKey: string, status: ExecuteStatus) => Promise<void>
}

const FP = /^[a-f0-9]{64}$/
export async function executeApproval(req: ExecuteRequest, ports: ExecutePorts): Promise<ExecuteResult> {
  if (!req.key.trim() || !req.idempotencyKey.trim() || !Number.isSafeInteger(req.expectedVersion) || req.expectedVersion < 0 || !FP.test(req.expectedFingerprint)) return { ok: false, code: 'INVALID_REQUEST' }
  const earlier = await ports.findByKey(req)
  if (earlier) return { ok: true, status: earlier, replayed: true, observedAt: ports.now() }
  const snapshot = await ports.loadSnapshot(req.key)
  if (!snapshot) return { ok: false, code: 'NOT_FOUND' }
  if (snapshot.version !== req.expectedVersion) return { ok: false, code: 'VERSION_CONFLICT' }
  if (snapshot.fingerprint !== req.expectedFingerprint) return { ok: false, code: 'FINGERPRINT_MISMATCH' }
  const gate = evaluateExecutionGate(snapshot.facts, ports.now)
  if (!gate.enabled) return { ok: false, code: 'GATE_BLOCKED', gate }
  const claim = await ports.claim(req)
  if ('blocked' in claim) return claim.result
  if (!claim.fresh) return { ok: true, status: claim.status, replayed: true, observedAt: ports.now() }
  let outcome: ProviderOutcome
  try { outcome = await ports.send(req.key, req.idempotencyKey) } catch { outcome = { kind: 'unknown' } }
  let status: ExecuteStatus
  if (outcome.kind === 'rejected') status = 'MANUAL_REQUIRED'
  else if (outcome.kind === 'unknown') status = 'RESULT_UNKNOWN'
  else {
    status = 'PROVIDER_ACCEPTED'
    const rb = await ports.readback(req.key).catch(() => 'unknown' as const)
    if (rb === 'verified') status = 'VERIFIED'
    else if (rb === 'unknown') status = 'RESULT_UNKNOWN'
  }
  await ports.record(req.key, req.idempotencyKey, status)
  return { ok: true, status, replayed: false, observedAt: ports.now() }
}
