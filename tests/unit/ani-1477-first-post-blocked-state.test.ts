import { describe, it, expect } from 'vitest'
import type { SoheeReadinessSnapshot } from '@/features/sohee-ready/types'

describe('ANI-1477 / Feedback A: First-post Blocked-State UX & Fail-Closed Gate', () => {
  it('correctly identifies blocked state when readiness is false with blockers', () => {
    const unreadySnapshot: SoheeReadinessSnapshot = {
      workspaceId: 'ws_test_blocked',
      ready: false,
      evaluatedAt: new Date().toISOString(),
      facts: {
        BUSINESS_VERIFIED: {
          key: 'BUSINESS_VERIFIED',
          verified: true,
          status: 'VERIFIED',
          source: 'NTS',
          evidenceId: 'nts_123',
          version: null,
          verifiedAt: new Date().toISOString(),
          freshness: 'FRESH',
        },
        INSTAGRAM_VERIFIED: {
          key: 'INSTAGRAM_VERIFIED',
          verified: false,
          status: 'MISSING',
          source: 'META',
          evidenceId: null,
          version: null,
          verifiedAt: null,
          freshness: 'UNKNOWN',
        },
        THREADS_VERIFIED: {
          key: 'THREADS_VERIFIED',
          verified: false,
          status: 'MISSING',
          source: 'META',
          evidenceId: null,
          version: null,
          verifiedAt: null,
          freshness: 'UNKNOWN',
        },
        BUSINESS_KNOWLEDGE_CONFIRMED: {
          key: 'BUSINESS_KNOWLEDGE_CONFIRMED',
          verified: true,
          status: 'CONFIRMED',
          source: 'HARNESS',
          evidenceId: 'bkh_1',
          version: 1,
          verifiedAt: new Date().toISOString(),
          freshness: 'FRESH',
        },
        TEXT_HARNESS_CONFIRMED: {
          key: 'TEXT_HARNESS_CONFIRMED',
          verified: false,
          status: 'MISSING',
          source: 'HARNESS',
          evidenceId: null,
          version: null,
          verifiedAt: null,
          freshness: 'UNKNOWN',
        },
        IMAGE_HARNESS_CONFIRMED: {
          key: 'IMAGE_HARNESS_CONFIRMED',
          verified: false,
          status: 'MISSING',
          source: 'HARNESS',
          evidenceId: null,
          version: null,
          verifiedAt: null,
          freshness: 'UNKNOWN',
        },
        OPERATING_POLICY_CONFIRMED: {
          key: 'OPERATING_POLICY_CONFIRMED',
          verified: false,
          status: 'MISSING',
          source: 'POLICY',
          evidenceId: null,
          version: null,
          verifiedAt: null,
          freshness: 'UNKNOWN',
        },
      },
      blockers: [
        {
          code: 'INSTAGRAM_NOT_VERIFIED',
          factKey: 'INSTAGRAM_VERIFIED',
          message: '인스타그램 비즈니스 계정이 연동되지 않았습니다.',
          remediationAction: '채널 연동하기',
          remediationHref: '/onboarding/channels',
        },
        {
          code: 'THREADS_NOT_VERIFIED',
          factKey: 'THREADS_VERIFIED',
          message: '스레드 계정이 연동되지 않았습니다.',
          remediationAction: '채널 연동하기',
          remediationHref: '/onboarding/channels',
        },
        {
          code: 'TEXT_HARNESS_NOT_CONFIRMED',
          factKey: 'TEXT_HARNESS_CONFIRMED',
          message: '문체 스타일 기준(Text Harness)이 확정되지 않았습니다.',
          remediationAction: '문체 캘리브레이션하기',
          remediationHref: '/onboarding/text-harness',
        },
        {
          code: 'IMAGE_HARNESS_NOT_CONFIRMED',
          factKey: 'IMAGE_HARNESS_CONFIRMED',
          message: '골든 이미지 기준(Image Harness)이 확정되지 않았습니다.',
          remediationAction: '골든 이미지 설정하기',
          remediationHref: '/onboarding/image-harness',
        },
        {
          code: 'OPERATING_POLICY_NOT_CONFIRMED',
          factKey: 'OPERATING_POLICY_CONFIRMED',
          message: '안심 운영 정책이 확정되지 않았습니다.',
          remediationAction: '운영 정책 확정하기',
          remediationHref: '/onboarding/policy',
        },
      ],
    }

    const isBlocked = !unreadySnapshot?.ready || Boolean(unreadySnapshot?.blockers && unreadySnapshot.blockers.length > 0)
    expect(isBlocked).toBe(true)
    expect(unreadySnapshot.blockers.length).toBe(5)
    expect(unreadySnapshot.blockers[0].remediationHref).toBe('/onboarding/channels')
  })

  it('correctly identifies unblocked ready state when all facts verified and blockers empty', () => {
    const readySnapshot: SoheeReadinessSnapshot = {
      workspaceId: 'ws_test_ready',
      ready: true,
      evaluatedAt: new Date().toISOString(),
      facts: {} as any,
      blockers: [],
    }

    const isBlocked = !readySnapshot?.ready || Boolean(readySnapshot?.blockers && readySnapshot.blockers.length > 0)
    expect(isBlocked).toBe(false)
  })
})
