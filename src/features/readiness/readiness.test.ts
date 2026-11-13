import { describe, expect, it } from 'vitest'
import { getSoheeReadiness } from '@/features/sohee-ready/read-model'
import { SOHEE_READINESS_FACT_KEYS } from '@/features/sohee-ready/types'
import { evaluateReadiness, evaluateGate } from './index'

async function snapshot(overrides: Partial<Record<(typeof SOHEE_READINESS_FACT_KEYS)[number], boolean>> = {}) {
  return getSoheeReadiness('ws-fixture', {
    fixtureState: { ...Object.fromEntries(SOHEE_READINESS_FACT_KEYS.map((key) => [key, false])), ...overrides },
  })
}

const prepared = {
  BUSINESS_KNOWLEDGE_CONFIRMED: true, TEXT_HARNESS_CONFIRMED: true,
  IMAGE_HARNESS_CONFIRMED: true, OPERATING_POLICY_CONFIRMED: true,
}

describe('ANI-1532 single server readiness truth', () => {
  it('permits onboarding, draft, preview, vault and bundle copy without channel or NTS', async () => {
    const result = evaluateReadiness(await snapshot(prepared))
    expect(result.stage).toBe('PREPARE_ONLY')
    expect(result.progressPercent).toBe(75)
    expect(result.connectionHint).toBe('채널을 연결하면 발행할 수 있어요')
    for (const action of ['ONBOARD', 'CREATE', 'PREVIEW', 'VAULT', 'COPY_BUNDLE'] as const) {
      expect(evaluateGate(result, action).allowed).toBe(true)
    }
    for (const action of ['PUBLISH', 'SCHEDULE', 'AUTONOMOUS'] as const) {
      expect(evaluateGate(result, action)).toMatchObject({ allowed: false, message: '채널을 연결하면 발행할 수 있어요' })
    }
    expect(result.trialAutoPublishEnabled).toBe(false)
  })

  it('allows manual publish and scheduling with one verified channel, not autonomous without NTS', async () => {
    const result = evaluateReadiness(await snapshot({ ...prepared, THREADS_VERIFIED: true }))
    expect(result.stage).toBe('PUBLISH_READY')
    expect(result.progressPercent).toBe(100)
    expect(evaluateGate(result, 'PUBLISH').allowed).toBe(true)
    expect(evaluateGate(result, 'SCHEDULE').allowed).toBe(true)
    expect(evaluateGate(result, 'AUTONOMOUS').allowed).toBe(false)
  })

  it('does not treat NTS alone or incomplete quick-start facts as publish-ready', async () => {
    expect(evaluateReadiness(await snapshot({ BUSINESS_VERIFIED: true, ...prepared })).stage).toBe('PREPARE_ONLY')
    const result = evaluateReadiness(await snapshot({ INSTAGRAM_VERIFIED: true }))
    expect(result.stage).toBe('PREPARE_ONLY')
    expect(evaluateGate(result, 'CREATE').allowed).toBe(false)
  })

  it('requires NTS for autonomous execution even with both channel statuses verified', async () => {
    const result = evaluateReadiness(await snapshot({ ...prepared, INSTAGRAM_VERIFIED: true, THREADS_VERIFIED: true, BUSINESS_VERIFIED: true }))
    expect(evaluateGate(result, 'AUTONOMOUS').allowed).toBe(true)
  })
})
