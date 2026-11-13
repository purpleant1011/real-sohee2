import { describe, it, expect, beforeEach } from 'vitest'
import { HarnessJobRunner } from './harness-job-runner'
import { HarnessKernel } from './harness-kernel'
import { HarnessCompiler } from './harness-compiler'

describe('HarnessJobRunner Idempotency & Credit Settlement (v1.1)', () => {
  let kernel: HarnessKernel
  let compiler: HarnessCompiler
  let jobRunner: HarnessJobRunner
  const wsId = 'ws_settlement_test'

  beforeEach(() => {
    kernel = new HarnessKernel()
    compiler = new HarnessCompiler()
    jobRunner = new HarnessJobRunner(kernel, compiler)
  })

  it('AC-23 & AC-25: Idempotency key prevents double billing and duplicate versions', async () => {
    const key = 'idem_key_12345'

    // 1st run
    const run1 = await jobRunner.executeJob({
      workspaceId: wsId,
      sourceUrl: 'https://instagram.com/studio_by.reum',
      idempotencyKey: key,
      jobType: 'INITIAL_COMPILE',
      availableCreditBalance: 500
    })
    expect(run1.success).toBe(true)
    expect(run1.reservedSc).toBe(240)
    expect(run1.settledSc).toBe(240)

    // 2nd run with exact same idempotencyKey (network duplicate or double-click)
    const run2 = await jobRunner.executeJob({
      workspaceId: wsId,
      sourceUrl: 'https://instagram.com/studio_by.reum',
      idempotencyKey: key,
      jobType: 'INITIAL_COMPILE',
      availableCreditBalance: 500
    })
    expect(run2.success).toBe(true)
    expect(run2.versionId).toBe(run1.versionId)
    expect(run2.reservedSc).toBe(0) // No new reserve charged
  })

  it('AC-09 & AC-36: Credit reserve -> settle -> refund pipeline tracks ledger events', async () => {
    // 1st call populates global acquisition cache
    await jobRunner.executeJob({
      workspaceId: 'ws_other',
      sourceUrl: 'https://instagram.com/studio_by.reum',
      idempotencyKey: 'key_other_1',
      jobType: 'INITIAL_COMPILE',
      availableCreditBalance: 500
    })

    // 2nd call hits cache and gets 30% discount refund
    const run = await jobRunner.executeJob({
      workspaceId: wsId,
      sourceUrl: 'https://instagram.com/studio_by.reum',
      idempotencyKey: 'key_cache_hit_2',
      jobType: 'INITIAL_COMPILE',
      availableCreditBalance: 500
    })

    expect(run.isCacheHit).toBe(true)
    expect(run.reservedSc).toBe(240)
    expect(run.settledSc).toBe(168) // 70% of 240
    expect(run.refundedSc).toBe(72) // 240 - 168

    const events = jobRunner.getCreditEvents(wsId)
    expect(events.length).toBe(3) // RESERVE, SETTLE, REFUND
    expect(events.some(e => e.type === 'RESERVE')).toBe(true)
    expect(events.some(e => e.type === 'REFUND')).toBe(true)
  })

  it('Blocks job execution when credit balance is insufficient', async () => {
    const run = await jobRunner.executeJob({
      workspaceId: wsId,
      sourceUrl: 'https://instagram.com/studio_by.reum',
      idempotencyKey: 'key_insufficient',
      jobType: 'INITIAL_COMPILE',
      availableCreditBalance: 50 // Need 240
    })

    expect(run.success).toBe(false)
    expect(run.error).toBe('INSUFFICIENT_CREDIT_BALANCE')
  })
})
