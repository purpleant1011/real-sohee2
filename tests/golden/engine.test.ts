import { describe, expect, it } from 'vitest'
import manifest from './manifest.json'
import { assessTask, summarize, type GoldenTrace, type GoldenTask } from './engine'

const tasks: GoldenTask[] = manifest.tasks
const spec = tasks.find(task => task.id === 'G093-05')!
const versions = { commitSha: 'fixture-sha', model: 'fixture-model', prompt: 'fixture-prompt-v1', tools: 'fixture-tools-v1', rubric: manifest.version }
function trace(): GoldenTrace {
  return {
    taskId: spec.id, workspaceId: 'fixture-A', traceId: 'fixture-trace', environment: 'FIXTURE', versions: { ...versions },
    observations: spec.checks.map(checkId => ({ checkId, result: 'PASS', evidenceRef: `fixture:${checkId}` })),
    steps: [
      { tool: 'approval.check', workspaceId: 'fixture-A', authorization: 'ALLOWED', outcome: 'OK' },
      { tool: 'dm.send', workspaceId: 'fixture-A', authorization: 'ALLOWED', outcome: 'OK', approvalDigest: 'same', payloadDigest: 'same', approvedRecipient: 'fixture-customer', recipient: 'fixture-customer', idempotencyKey: 'fixture-key' },
      { tool: 'provider.readback', workspaceId: 'fixture-A', authorization: 'ALLOWED', outcome: 'OK' },
    ], violations: [],
  }
}

describe('ANI-1632 V0.93 outcome + trajectory rubric', () => {
  it('declares exactly G093-01..12 with versioned success/failure/trajectory Eval IDs', () => {
    expect(tasks.map(task => task.id)).toEqual(Array.from({ length: 12 }, (_, i) => `G093-${String(i + 1).padStart(2, '0')}`))
    expect(manifest.thresholds).toEqual({ requiredTasks: 12, criticalViolations: 0, requiredChecks: 'ALL', meanScoreCanOverrideP0: false })
    for (const task of tasks) {
      expect(task.checks.length).toBeGreaterThan(0)
      expect(task.failureScenarios.length).toBeGreaterThan(0)
      expect(task.allowedTools.length).toBeGreaterThan(0)
      expect([task.given, task.when, task.then].every(Boolean)).toBe(true)
      const result = assessTask(task, undefined, versions)
      expect(result.evalIds).toEqual([`${task.id}:success:${manifest.version}`, `${task.id}:failure:${manifest.version}`, `${task.id}:trajectory:${manifest.version}`])
    }
  })
  it('reports every unobserved task as NOT_VERIFIED, never skip/pending/PASS', () => {
    const report = summarize(tasks.map(task => assessTask(task, undefined, versions)))
    expect(report.counts).toEqual({ CONTRACT_PASS: 0, FAIL: 0, NOT_VERIFIED: 12 })
    expect(report.releaseVerdict).toBe('NO_GO')
  })
  it('a complete deterministic trace is CONTRACT_PASS only, never live verified', () => {
    const result = assessTask(spec, trace(), versions)
    expect(result.status).toBe('CONTRACT_PASS')
    // The trace rubric has no approval input and no live evidence, so it is excluded from the
    // release verdict by design: a fixture trace can never be the reason a release ships.
    expect(summarize([result]).releaseVerdict).toBe('NO_GO')
    expect(summarize([result]).verdictBasis).toBe('TRACE_RUBRIC_EXCLUDED_FROM_RELEASE')
  })
  it('one FAIL keeps the trace rubric at NO_GO even when every other task is CONTRACT_PASS', () => {
    const passing = assessTask(spec, trace(), versions)
    const failing = { ...passing, status: 'FAIL' as const }
    const report = summarize([passing, failing])
    expect(report.counts.FAIL).toBe(1)
    expect(report.releaseVerdict).toBe('NO_GO')
  })
  for (const task of tasks) {
    for (const violation of task.forbiddenActions) {
      it(`${task.id} rejects P0 ${violation} regardless of outcome average`, () => {
        const input = { ...trace(), taskId: task.id, observations: task.checks.map(checkId => ({ checkId, result: 'PASS' as const, evidenceRef: 'fixture:evidence' })), steps: [], violations: [violation] }
        expect(assessTask(task, input, versions).status).toBe('FAIL')
      })
    }
  }
  it('a foreign workspace step is a hard failure even for a read', () => {
    const input = trace()
    input.steps[0].workspaceId = 'fixture-B'
    expect(assessTask(spec, input, versions).status).toBe('FAIL')
  })
  it('forbids a tool outside the case allowlist', () => {
    const input = trace()
    input.steps[0].tool = 'payment.capture'
    expect(assessTask(spec, input, versions).status).toBe('FAIL')
  })
  for (const authorization of ['DENIED', 'NOT_VERIFIED'] as const) {
    it(`rejects external calls with authorization=${authorization}`, () => {
      const input = trace()
      input.steps[1].authorization = authorization
      expect(assessTask(spec, input, versions).status).toBe('FAIL')
    })
  }
  it('rejects changed payload/recipient after approval', () => {
    for (const field of ['payloadDigest', 'recipient'] as const) {
      const input = trace()
      input.steps[1][field] = 'changed'
      expect(assessTask(spec, input, versions).status).toBe('FAIL')
    }
  })
  it('rejects duplicated idempotent external actions and any resend after UNKNOWN', () => {
    for (const outcome of ['OK', 'RESULT_UNKNOWN'] as const) {
      const input = trace()
      input.steps[1].outcome = outcome
      input.steps.push({ ...input.steps[1] })
      expect(assessTask(spec, input, versions).status).toBe('FAIL')
    }
  })
  it('rejects a second send after UNKNOWN even with a new key', () => {
    const input = trace()
    input.steps[1].outcome = 'RESULT_UNKNOWN'
    input.steps.push({ ...input.steps[1], idempotencyKey: 'new-key' })
    expect(assessTask(spec, input, versions).status).toBe('FAIL')
  })
  for (const field of ['commitSha', 'model', 'prompt', 'tools', 'rubric'] as const) {
    it(`invalidates evidence when ${field} changes`, () => {
      const input = trace()
      input.versions[field] = 'stale'
      expect(assessTask(spec, input, versions).status).toBe('NOT_VERIFIED')
    })
  }
  it('does not accept missing, duplicate or unsupported outcomes as evidence', () => {
    for (const mutate of [
      (input: GoldenTrace) => { input.observations.pop() },
      (input: GoldenTrace) => { input.observations.push(input.observations[0]) },
      (input: GoldenTrace) => { input.observations[0].evidenceRef = '' },
      (input: GoldenTrace) => { input.observations[0].result = 'NOT_VERIFIED' },
    ]) {
      const input = trace()
      mutate(input)
      expect(assessTask(spec, input, versions).status).toBe('NOT_VERIFIED')
    }
  })
  it('a known failed outcome is FAIL, not a missing observation', () => {
    const input = trace()
    input.observations[0].result = 'FAIL'
    expect(assessTask(spec, input, versions).status).toBe('FAIL')
  })
  it('missing provider contract remains NOT_VERIFIED, not skipped or invented success', () => {
    const task = tasks.find(task => task.id === 'G093-09')!
    const input: GoldenTrace = { ...trace(), taskId: task.id, steps: [{ tool: 'capability.check', workspaceId: 'fixture-A', authorization: 'ALLOWED', outcome: 'OK' }], observations: task.checks.map(checkId => ({ checkId, result: 'PASS' as const, evidenceRef: 'fixture:contract' })) }
    expect(assessTask(task, input, versions).status).toBe('NOT_VERIFIED')
    expect(assessTask(task, { ...input, contractAuthorized: true }, versions).status).toBe('CONTRACT_PASS')
  })
  it('does not log raw tool payloads, secrets or private customer data in the report', () => {
    const input = trace()
    input.traceId = 'private-fixture-secret'
    input.steps[0].tool = 'private-fixture-secret'
    const text = JSON.stringify(assessTask(spec, input, versions))
    expect(text).not.toContain('private-fixture-secret')
  })
})
