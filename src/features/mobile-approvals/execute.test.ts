import { describe, expect, it } from 'vitest'
import { executeApproval, type ApprovalSnapshot, type ExecutePorts, type ExecuteStatus, type ProviderOutcome } from './execute'
import type { GateFacts } from './gate'

const facts: GateFacts = { role: 'manager', featureEnabled: true, killSwitchActive: false, workspaceAllowed: true, providerReady: true, tokenValid: true,
  scopeGranted: true, policyWindowOpen: true, costRequired: false, costAcknowledged: null, consentsSatisfied: true, sourceFresh: true,
  alreadySent: false, inFlight: false, datasetMode: 'ACTUAL' }
const FP = 'a'.repeat(64)
const KEY = 'dm:11111111-1111-4111-8111-111111111111'

function harness(over: Partial<ApprovalSnapshot> = {}, provider: ProviderOutcome = { kind: 'accepted' }, readback: 'verified' | 'not_found' | 'unknown' = 'verified') {
  const ledger = new Map<string, ExecuteStatus>()
  const calls = { send: 0, readback: 0 }
  const snapshot: ApprovalSnapshot = { version: 3, fingerprint: FP, facts, ...over }
  const ports: ExecutePorts = {
    now: () => '2026-10-22T00:00:00.000Z',
    loadSnapshot: async () => snapshot,
    findByKey: async r => ledger.get(r.idempotencyKey) ?? null,
    claim: async r => { const k = r.idempotencyKey; const e = ledger.get(k); if (e) return { fresh: false, status: e }; ledger.set(k, 'REQUESTED'); return { fresh: true } },
    send: async () => { calls.send++; if (provider.kind === 'unknown') throw new Error('timeout'); return provider },
    readback: async () => { calls.readback++; return readback },
    record: async (_key, k, s) => { ledger.set(k, s) },
  }
  return { ports, calls, ledger }
}
const req = (idem = 'idem-1') => ({ key: KEY, idempotencyKey: idem, expectedVersion: 3, expectedFingerprint: FP })

describe('executeApproval', () => {
  it('reports VERIFIED only after readback', async () => {
    const h = harness()
    expect(await executeApproval(req(), h.ports)).toMatchObject({ ok: true, status: 'VERIFIED', replayed: false })
  })
  it('stays PROVIDER_ACCEPTED→RESULT_UNKNOWN when readback is unknown, never VERIFIED', async () => {
    const h = harness({}, { kind: 'accepted' }, 'unknown')
    expect(await executeApproval(req(), h.ports)).toMatchObject({ status: 'RESULT_UNKNOWN' })
  })
  it('does not resend after an unknown outcome', async () => {
    const h = harness({}, { kind: 'unknown' })
    expect(await executeApproval(req(), h.ports)).toMatchObject({ status: 'RESULT_UNKNOWN' })
    await executeApproval(req(), h.ports)
    expect(h.calls.send).toBe(1)
  })
  it('same idempotency key twice → one provider call, same result', async () => {
    const h = harness()
    await executeApproval(req(), h.ports)
    expect(await executeApproval(req(), h.ports)).toMatchObject({ ok: true, replayed: true, status: 'VERIFIED' })
    expect(h.calls.send).toBe(1)
  })
  it('different key after a completed send is blocked by ALREADY_SENT (server state)', async () => {
    const h = harness({ facts: { ...facts, alreadySent: true } })
    const r = await executeApproval(req('idem-2'), h.ports)
    expect(r).toMatchObject({ ok: false, code: 'GATE_BLOCKED' })
    expect(h.calls.send).toBe(0)
  })
  it('edited content (fingerprint mismatch) and stale version never reach the provider', async () => {
    const h = harness({ fingerprint: 'b'.repeat(64) })
    expect(await executeApproval(req(), h.ports)).toMatchObject({ ok: false, code: 'FINGERPRINT_MISMATCH' })
    const h2 = harness({ version: 4 })
    expect(await executeApproval(req(), h2.ports)).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' })
    expect(h.calls.send + h2.calls.send).toBe(0)
  })
  it('blocked gate, unknown item and malformed requests make zero external calls', async () => {
    const h = harness({ facts: { ...facts, killSwitchActive: true } })
    expect(await executeApproval(req(), h.ports)).toMatchObject({ ok: false, code: 'GATE_BLOCKED' })
    expect(await executeApproval({ ...req(), expectedFingerprint: 'zz' }, h.ports)).toMatchObject({ code: 'INVALID_REQUEST' })
    expect(await executeApproval({ ...req(), idempotencyKey: ' ' }, h.ports)).toMatchObject({ code: 'INVALID_REQUEST' })
    h.ports.loadSnapshot = async () => null
    expect(await executeApproval(req('x'), h.ports)).toMatchObject({ code: 'NOT_FOUND' })
    expect(h.calls.send).toBe(0)
  })
  it('concurrent double tap sends once', async () => {
    const h = harness()
    const [a, b] = await Promise.all([executeApproval(req(), h.ports), executeApproval(req(), h.ports)])
    expect(h.calls.send).toBe(1)
    expect([a, b].filter(r => r.ok && r.replayed)).toHaveLength(1)
  })
  it('different idempotency keys competing for one item send once with an atomic item claim', async () => {
    const h = harness()
    let reserved = false
    h.ports.claim = async () => {
      if (reserved) return { blocked: true, result: { ok: false, code: 'GATE_BLOCKED' } }
      reserved = true
      return { fresh: true }
    }
    const results = await Promise.all([executeApproval(req('first'), h.ports), executeApproval(req('second'), h.ports)])
    expect(h.calls.send).toBe(1)
    expect(results.filter(result => result.ok)).toHaveLength(1)
    expect(results.filter(result => !result.ok)).toHaveLength(1)
  })
  it.each<[Partial<ApprovalSnapshot>, string]>([
    [{ fingerprint: 'b'.repeat(64) }, 'FINGERPRINT_MISMATCH'],
    [{ version: 4 }, 'VERSION_CONFLICT'],
    [{ facts: { ...facts, killSwitchActive: true } }, 'GATE_BLOCKED'],
    [{ facts: { ...facts, role: 'member' } }, 'GATE_BLOCKED'],
    [{ facts: { ...facts, role: null } }, 'GATE_BLOCKED'],
  ])('blocks unsafe execution %j with %s before any external call', async (override, code) => {
    const h = harness(override)
    expect(await executeApproval(req(), h.ports)).toMatchObject({ ok: false, code })
    expect(h.calls).toEqual({ send: 0, readback: 0 })
    expect(h.ledger.size).toBe(0)
  })
  it('record failure remains an error and leaves REQUESTED for reconciliation without resending', async () => {
    const h = harness()
    h.ports.record = async () => { throw new Error('database unavailable') }
    await expect(executeApproval(req(), h.ports)).rejects.toThrow('database unavailable')
    expect(h.ledger.get('idem-1')).toBe('REQUESTED')
    expect(await executeApproval(req(), h.ports)).toMatchObject({ status: 'REQUESTED', replayed: true })
    expect(h.calls.send).toBe(1)
  })
  it('atomic claim revalidation failure never reaches the provider', async () => {
    const h = harness()
    h.ports.claim = async () => ({ blocked: true, result: { ok: false, code: 'VERSION_CONFLICT' } })
    expect(await executeApproval(req(), h.ports)).toEqual({ ok: false, code: 'VERSION_CONFLICT' })
    expect(h.calls.send).toBe(0)
  })
  it('readback failure never becomes VERIFIED', async () => {
    const h = harness()
    h.ports.readback = async () => { throw new Error('offline') }
    expect(await executeApproval(req(), h.ports)).toMatchObject({ status: 'RESULT_UNKNOWN' })
  })
  it('accepted but not yet found stays pending provider acceptance', async () => {
    const h = harness({}, { kind: 'accepted' }, 'not_found')
    expect(await executeApproval(req(), h.ports)).toMatchObject({ status: 'PROVIDER_ACCEPTED' })
  })
  it('rejects negative versions and empty item keys', async () => {
    const h = harness()
    expect(await executeApproval({ ...req(), expectedVersion: -1 }, h.ports)).toMatchObject({ code: 'INVALID_REQUEST' })
    expect(await executeApproval({ ...req(), key: ' ' }, h.ports)).toMatchObject({ code: 'INVALID_REQUEST' })
    expect(h.calls.send).toBe(0)
  })
  it('provider rejection → manual path, not success', async () => {
    const h = harness({}, { kind: 'rejected' })
    expect(await executeApproval(req(), h.ports)).toMatchObject({ status: 'MANUAL_REQUIRED' })
  })
})
