import { describe, expect, it } from 'vitest'
import { makeMobileApproval } from '../mobile-decision/test-fixtures'
import { canExecuteApproval } from '../mobile-decision/selectors'
import { executionGateSchema, mobileApprovalExecuteBodySchema, mobileApprovalIdempotencyKeySchema, mobileApprovalKeySchema, mobileApprovalV1Schema, mobileApprovalV2Schema, toMobileApprovalV1 } from './contracts'

function fixture() {
  const { writeState: _writeState, ...view } = makeMobileApproval()
  void _writeState
  return {
    ...view, v: 2 as const, datasetMode: 'ACTUAL' as const, version: 3, fingerprint: 'a'.repeat(64),
    recipients: [{ label: '고객', verified: true }], schedule: { sendAt: null, windowEndsAt: null },
    cost: { estimated: null, unit: '원' as const, basis: 'NONE' as const }, changes: [], consents: [],
    gate: { enabled: true, blockers: [], userMessage: '', evaluatedAt: '2026-10-22T00:00:00.000Z' },
  }
}

describe('mobile approval v2 and read-only R1 compatibility', () => {
  it('validates v2 without altering the R1 schema', () => {
    const v2 = mobileApprovalV2Schema.parse(fixture())
    const v1 = mobileApprovalV1Schema.parse(toMobileApprovalV1(v2))
    expect(v1.writeState).toBe('unsupported')
    expect(canExecuteApproval(v1, Date.now())).toBe(false)
    expect(canExecuteApproval(v2, Date.now())).toBe(false)
  })
  it.each(['ACTUAL', 'SHOWCASE_DEMO', 'TEST', 'UNKNOWN'] as const)('maps %s explicitly into R1', datasetMode => {
    const v1 = toMobileApprovalV1(mobileApprovalV2Schema.parse({ ...fixture(), datasetMode }))
    expect(v1.datasetMode).toBe(datasetMode === 'SHOWCASE_DEMO' ? 'DEMO' : datasetMode)
    expect(v1.writeState).toBe('unsupported')
  })
  it.each([
    { enabled: true, blockers: ['ROLE'] },
    { enabled: false, blockers: [] },
  ])('rejects inconsistent gates %j', override => {
    expect(executionGateSchema.safeParse({ ...fixture().gate, ...override }).success).toBe(false)
  })
  it.each([
    { version: -1 }, { version: Number.MAX_SAFE_INTEGER + 1 }, { fingerprint: 'invalid' },
    { writeState: 'ready' }, { datasetMode: 'DEMO' }, { v: 1 },
  ])('rejects invalid v2 fields %j', override => {
    expect(mobileApprovalV2Schema.safeParse({ ...fixture(), ...override }).success).toBe(false)
  })
  it('strictly validates the proposed HTTP request, not client authority', () => {
    const body = { expectedVersion: 3, expectedFingerprint: 'a'.repeat(64), acknowledged: { cost: true, consent: true } }
    expect(mobileApprovalExecuteBodySchema.safeParse(body).success).toBe(true)
    expect(mobileApprovalExecuteBodySchema.safeParse({ ...body, role: 'owner' }).success).toBe(false)
    expect(mobileApprovalExecuteBodySchema.safeParse({ ...body, acknowledged: { cost: true } }).success).toBe(false)
    expect(mobileApprovalIdempotencyKeySchema.safeParse('11111111-1111-4111-8111-111111111111').success).toBe(true)
    expect(mobileApprovalIdempotencyKeySchema.safeParse('idem-1').success).toBe(false)
    expect(mobileApprovalKeySchema.safeParse('dm:11111111-1111-4111-8111-111111111111').success).toBe(true)
    expect(mobileApprovalKeySchema.safeParse('dm:../../other').success).toBe(false)
  })
})
