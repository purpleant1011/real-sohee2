import { describe, expect, it } from 'vitest'
import { evaluateExecutionGate, type GateFacts } from './gate'

const ok: GateFacts = { role: 'owner', featureEnabled: true, killSwitchActive: false, workspaceAllowed: true, providerReady: true, tokenValid: true,
  scopeGranted: true, policyWindowOpen: true, costRequired: false, costAcknowledged: null, consentsSatisfied: true, sourceFresh: true,
  alreadySent: false, inFlight: false, datasetMode: 'ACTUAL' }

describe('execution gate (fail-closed)', () => {
  it('opens only when every fact is explicitly safe', () => {
    expect(evaluateExecutionGate(ok)).toMatchObject({ enabled: true, blockers: [] })
  })
  it.each((Object.keys(ok) as (keyof GateFacts)[]).filter(field => field !== 'costAcknowledged'))('unknown %s blocks', field => {
    expect(evaluateExecutionGate({ ...ok, [field]: null }).enabled).toBe(false)
  })
  it.each<[Partial<GateFacts>, string]>([
    [{ role: 'member' }, 'ROLE'], [{ role: null }, 'ROLE'],
    [{ featureEnabled: false }, 'FEATURE_OFF'], [{ killSwitchActive: true }, 'KILL_SWITCH'],
    [{ workspaceAllowed: false }, 'WORKSPACE_NOT_ALLOWED'], [{ providerReady: false }, 'PROVIDER_NOT_READY'],
    [{ tokenValid: false }, 'TOKEN_EXPIRED'], [{ scopeGranted: false }, 'SCOPE_MISSING'],
    [{ policyWindowOpen: false }, 'POLICY_WINDOW_EXPIRED'],
    [{ costRequired: true, costAcknowledged: false }, 'COST_UNACKNOWLEDGED'],
    [{ consentsSatisfied: false }, 'CONSENT_MISSING'], [{ sourceFresh: false }, 'SOURCE_STALE'],
    [{ alreadySent: true }, 'ALREADY_SENT'], [{ inFlight: true }, 'IDEMPOTENCY_IN_FLIGHT'],
    [{ datasetMode: 'TEST' }, 'DATASET_NOT_ACTUAL'], [{ datasetMode: 'SHOWCASE_DEMO' }, 'DATASET_NOT_ACTUAL'],
    [{ datasetMode: 'UNKNOWN' }, 'DATASET_NOT_ACTUAL'],
  ])('maps unsafe facts %j to %s', (override, blocker) => {
    expect(evaluateExecutionGate({ ...ok, ...override })).toMatchObject({ enabled: false, blockers: [blocker] })
  })
  it('requires cost acknowledgement whenever cost applies or is unknown', () => {
    expect(evaluateExecutionGate({ ...ok, costRequired: true, costAcknowledged: false }).blockers).toEqual(['COST_UNACKNOWLEDGED'])
    expect(evaluateExecutionGate({ ...ok, costRequired: null }).blockers).toEqual(['COST_UNACKNOWLEDGED'])
    expect(evaluateExecutionGate({ ...ok, costRequired: null, costAcknowledged: true }).blockers).toEqual(['COST_UNACKNOWLEDGED'])
    expect(evaluateExecutionGate({ ...ok, costRequired: true, costAcknowledged: null }).enabled).toBe(false)
    expect(evaluateExecutionGate({ ...ok, costRequired: true, costAcknowledged: true }).enabled).toBe(true)
    expect(evaluateExecutionGate({ ...ok, costRequired: false, costAcknowledged: null }).enabled).toBe(true)
  })
  it('gives a Korean reason without internal codes', () => {
    const gate = evaluateExecutionGate({ ...ok, policyWindowOpen: false })
    expect(gate.userMessage).toMatch(/답장 가능 시간/)
    expect(gate.userMessage).not.toMatch(/[A-Z_]{4,}/)
  })
})
