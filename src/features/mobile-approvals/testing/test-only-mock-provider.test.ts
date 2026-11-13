import { describe, expect, it } from 'vitest'
import type { ApprovalSnapshot } from '../execute'
import { executeApproval } from '../execute'
import type { GateFacts } from '../gate'
import type { ApprovalPortBinding } from '../ports'
import { createMockApprovalProvider, createMockExecutePorts } from './test-only-mock-provider'

const facts: GateFacts = {
  role: 'owner',
  featureEnabled: true,
  killSwitchActive: false,
  workspaceAllowed: true,
  providerReady: true,
  tokenValid: true,
  scopeGranted: true,
  policyWindowOpen: true,
  costRequired: false,
  costAcknowledged: null,
  consentsSatisfied: true,
  sourceFresh: true,
  alreadySent: false,
  inFlight: false,
  datasetMode: 'ACTUAL',
}

const binding: ApprovalPortBinding = { workspaceId: 'ws-1', actorId: 'actor-1', role: 'owner' }
const FP = 'b'.repeat(64)
const KEY = 'dm:22222222-2222-4222-8222-222222222222'
const snapshot: ApprovalSnapshot = { version: 4, fingerprint: FP, facts }
const req = (idempotencyKey = 'idem-mock-1') => ({
  key: KEY,
  idempotencyKey,
  expectedVersion: 4,
  expectedFingerprint: FP,
})

function setup(options: Parameters<typeof createMockApprovalProvider>[0] = {}, ledger?: Map<string, 'REQUESTED'>) {
  const mock = createMockApprovalProvider(options)
  const harness = createMockExecutePorts({ binding, snapshot, provider: mock.provider, ledger })
  return { mock, harness }
}

describe('test-only mock provider harness', () => {
  it('drives the real executor to VERIFIED only through independent readback', async () => {
    const { harness, mock } = setup()
    await expect(executeApproval(req(), harness.ports)).resolves.toMatchObject({
      ok: true,
      status: 'VERIFIED',
      replayed: false,
    })
    expect(mock.calls).toEqual({ send: 1, readback: 1 })
    expect(harness.ledger.get('idem-mock-1')).toBe('VERIFIED')
    // 승인 스냅샷은 claim 시점 값이 그대로 전달된다(승인 후 수정 차단).
    expect(mock.sends[0]).toMatchObject({ workspaceId: 'ws-1', itemKey: KEY, approved: snapshot })
  })

  it('replays the same idempotency key without a second provider send', async () => {
    const { harness, mock } = setup()
    await executeApproval(req(), harness.ports)
    await expect(executeApproval(req(), harness.ports)).resolves.toMatchObject({ replayed: true, status: 'VERIFIED' })
    expect(mock.calls.send).toBe(1)
  })

  it('never reports VERIFIED when readback is unknown', async () => {
    const { harness } = setup({ readback: 'unknown' })
    await expect(executeApproval(req(), harness.ports)).resolves.toMatchObject({ status: 'RESULT_UNKNOWN' })
  })

  it('absorbs a throwing send as RESULT_UNKNOWN and does not retry on replay', async () => {
    const { harness, mock } = setup({ throwsOnSend: true })
    await expect(executeApproval(req(), harness.ports)).resolves.toMatchObject({ status: 'RESULT_UNKNOWN' })
    await executeApproval(req(), harness.ports)
    expect(mock.calls.send).toBe(1)
  })

  it('maps a provider rejection to MANUAL_REQUIRED without touching readback', async () => {
    const { harness, mock } = setup({ outcome: { kind: 'rejected' } })
    await expect(executeApproval(req(), harness.ports)).resolves.toMatchObject({ status: 'MANUAL_REQUIRED' })
    expect(mock.calls).toEqual({ send: 1, readback: 0 })
  })
})
