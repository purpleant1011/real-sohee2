import { describe, it, expect } from 'vitest'
import { resolveAppShellMode } from '@/features/sohee-ready/shell-resolver'
import { requireSoheeReady, SoheeNotReadyError } from '@/features/sohee-ready/admission-guard'
import type { SoheeReadinessSnapshot, ReadinessFactProvenance } from '@/features/sohee-ready/types'

describe('HF-07: Education Shell & Onboarding Routing Guard', () => {
  const makeProvenance = (
    key: any,
    verified: boolean,
    status: any
  ): ReadinessFactProvenance => ({
    key,
    verified,
    status,
    source: 'db:test',
    evidenceId: null,
    version: null,
    verifiedAt: verified ? '2026-09-12T00:00:00.000Z' : null,
    freshness: 'FRESH',
  })

  const preReadySnapshot: SoheeReadinessSnapshot = {
    workspaceId: 'ws-pre-ready-001',
    ready: false,
    evaluatedAt: '2026-09-12T00:00:00.000Z',
    blockers: [
      {
        code: 'INSTAGRAM_NOT_VERIFIED',
        factKey: 'INSTAGRAM_VERIFIED',
        message: '인스타그램 계정이 연동되지 않았습니다.',
        remediationAction: '인스타그램 연동하기',
        remediationHref: '/onboarding/channels/instagram',
      },
      {
        code: 'THREADS_NOT_VERIFIED',
        factKey: 'THREADS_VERIFIED',
        message: '스레드 계정이 연동되지 않았습니다.',
        remediationAction: '스레드 연동하기',
        remediationHref: '/onboarding/channels/threads',
      },
    ],
    facts: {
      BUSINESS_VERIFIED: makeProvenance('BUSINESS_VERIFIED', true, 'VERIFIED'),
      INSTAGRAM_VERIFIED: makeProvenance('INSTAGRAM_VERIFIED', false, 'MISSING'),
      THREADS_VERIFIED: makeProvenance('THREADS_VERIFIED', false, 'MISSING'),
      BUSINESS_KNOWLEDGE_CONFIRMED: makeProvenance('BUSINESS_KNOWLEDGE_CONFIRMED', true, 'CONFIRMED'),
      TEXT_HARNESS_CONFIRMED: makeProvenance('TEXT_HARNESS_CONFIRMED', false, 'MISSING'),
      IMAGE_HARNESS_CONFIRMED: makeProvenance('IMAGE_HARNESS_CONFIRMED', false, 'MISSING'),
      OPERATING_POLICY_CONFIRMED: makeProvenance('OPERATING_POLICY_CONFIRMED', true, 'CONFIRMED'),
    },
  }

  const fullyReadySnapshot: SoheeReadinessSnapshot = {
    workspaceId: 'ws-fully-ready-001',
    ready: true,
    evaluatedAt: '2026-09-12T00:00:00.000Z',
    blockers: [],
    facts: {
      BUSINESS_VERIFIED: makeProvenance('BUSINESS_VERIFIED', true, 'VERIFIED'),
      INSTAGRAM_VERIFIED: makeProvenance('INSTAGRAM_VERIFIED', true, 'VERIFIED'),
      THREADS_VERIFIED: makeProvenance('THREADS_VERIFIED', true, 'VERIFIED'),
      BUSINESS_KNOWLEDGE_CONFIRMED: makeProvenance('BUSINESS_KNOWLEDGE_CONFIRMED', true, 'CONFIRMED'),
      TEXT_HARNESS_CONFIRMED: makeProvenance('TEXT_HARNESS_CONFIRMED', true, 'CONFIRMED'),
      IMAGE_HARNESS_CONFIRMED: makeProvenance('IMAGE_HARNESS_CONFIRMED', true, 'CONFIRMED'),
      OPERATING_POLICY_CONFIRMED: makeProvenance('OPERATING_POLICY_CONFIRMED', true, 'CONFIRMED'),
    },
  }

  it('routes pre-ready workspace strictly to EDUCATION_SHELL', () => {
    const shellMode = resolveAppShellMode(preReadySnapshot)
    expect(shellMode).toBe('EDUCATION_SHELL')
  })

  it('routes fully-ready workspace to WORK_APP_SHELL', () => {
    const shellMode = resolveAppShellMode(fullyReadySnapshot)
    expect(shellMode).toBe('WORK_APP_SHELL')
  })

  it('enforces fail-closed admission: blocks mission create in pre-ready fixture workspace', async () => {
    // ws-ig-only has INSTAGRAM_VERIFIED=true but THREADS_VERIFIED=false
    await expect(
      requireSoheeReady('ws-ig-only', { action: 'MISSION_CREATE' })
    ).rejects.toThrow(SoheeNotReadyError)
  })

  it('permits mission create when workspace fixture is fully ready', async () => {
    const result = await requireSoheeReady('ws-all-7-ready', { action: 'MISSION_CREATE' })
    expect(result.ready).toBe(true)
    expect(result.blockers.length).toBe(0)
  })
})
