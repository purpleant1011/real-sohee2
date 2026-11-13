import { describe, expect, it } from 'vitest'
import { getSoheeReadiness } from '@/features/sohee-ready/read-model'
import { SOHEE_READINESS_FACT_KEYS } from '@/features/sohee-ready/types'
import { evaluateFirstPostReadiness, requireFirstPostReady } from '../first-post-readiness'

async function snapshot(state: Partial<Record<(typeof SOHEE_READINESS_FACT_KEYS)[number], boolean>>) {
  const base = Object.fromEntries(SOHEE_READINESS_FACT_KEYS.map((k) => [k, false]))
  return getSoheeReadiness('ws-fixture', { fixtureState: { ...base, ...state } })
}

describe('first-post readiness (quick lane)', () => {
  it('is ready with one channel and the four quick-start facts, without NTS business verification', async () => {
    const snap = await snapshot({
      INSTAGRAM_VERIFIED: true,
      BUSINESS_KNOWLEDGE_CONFIRMED: true,
      TEXT_HARNESS_CONFIRMED: true,
      IMAGE_HARNESS_CONFIRMED: true,
      OPERATING_POLICY_CONFIRMED: true,
    })
    expect(snap.ready).toBe(false) // full SOHEE_READY still requires business + both channels
    expect(evaluateFirstPostReadiness(snap).ready).toBe(true)
  })

  it('accepts Threads alone', async () => {
    const snap = await snapshot({
      THREADS_VERIFIED: true,
      BUSINESS_KNOWLEDGE_CONFIRMED: true,
      TEXT_HARNESS_CONFIRMED: true,
      IMAGE_HARNESS_CONFIRMED: true,
      OPERATING_POLICY_CONFIRMED: true,
    })
    expect(evaluateFirstPostReadiness(snap).ready).toBe(true)
  })

  it('blocks with a plain-language channel blocker when no channel is verified', async () => {
    const snap = await snapshot({
      BUSINESS_KNOWLEDGE_CONFIRMED: true,
      TEXT_HARNESS_CONFIRMED: true,
      IMAGE_HARNESS_CONFIRMED: true,
      OPERATING_POLICY_CONFIRMED: true,
    })
    const result = evaluateFirstPostReadiness(snap)
    expect(result.ready).toBe(false)
    expect(result.blockers.map((b) => b.message)).toContain('인스타그램 또는 스레드를 하나 이상 연결해 주세요.')
  })

  it('returns a channel-specific user message on direct publish attempts', async () => {
    await expect(requireFirstPostReady('ws-fixture', {
      fixtureState: { ...Object.fromEntries(SOHEE_READINESS_FACT_KEYS.map((k) => [k, false])),
        BUSINESS_KNOWLEDGE_CONFIRMED: true, TEXT_HARNESS_CONFIRMED: true,
        IMAGE_HARNESS_CONFIRMED: true, OPERATING_POLICY_CONFIRMED: true },
      action: 'PUBLISH_FIRST_POST',
    })).rejects.toMatchObject({ message: '채널을 연결하면 발행할 수 있어요' })
  })

  it('blocks when the quick-start facts are missing even if a channel is connected', async () => {
    const snap = await snapshot({ INSTAGRAM_VERIFIED: true, THREADS_VERIFIED: true, BUSINESS_VERIFIED: true })
    const result = evaluateFirstPostReadiness(snap)
    expect(result.ready).toBe(false)
    expect(result.blockers.length).toBe(4)
  })
})
