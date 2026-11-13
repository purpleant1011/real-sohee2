import { describe, it, expect } from 'vitest'
import {
  createSharedMissionEntry,
  resolveDockUIMode,
  reviseContentWithNaturalLanguage,
  type SharedMissionParams,
  type ContentItem,
  type ContentApprovalRecord,
} from '@/features/content/shared-mission-runtime'
import type { SoheeReadinessSnapshot } from '@/features/sohee-ready/types'

describe('HF-22 & HF-24: Shared Mission Entry API & Snapshot Lineage', () => {
  const preReadySnapshot: SoheeReadinessSnapshot = {
    workspaceId: 'ws-pre-ready',
    ready: false,
    evaluatedAt: new Date().toISOString(),
    facts: {
      BUSINESS_VERIFIED: { key: 'BUSINESS_VERIFIED', verified: true, status: 'VERIFIED', source: 'test', evidenceId: '1', version: null, verifiedAt: null, freshness: 'FRESH' },
      INSTAGRAM_VERIFIED: { key: 'INSTAGRAM_VERIFIED', verified: true, status: 'VERIFIED', source: 'test', evidenceId: '2', version: null, verifiedAt: null, freshness: 'FRESH' },
      THREADS_VERIFIED: { key: 'THREADS_VERIFIED', verified: false, status: 'PENDING', source: 'test', evidenceId: null, version: null, verifiedAt: null, freshness: 'STALE' },
      BUSINESS_KNOWLEDGE_CONFIRMED: { key: 'BUSINESS_KNOWLEDGE_CONFIRMED', verified: true, status: 'CONFIRMED', source: 'test', evidenceId: '3', version: '1', verifiedAt: null, freshness: 'FRESH' },
      TEXT_HARNESS_CONFIRMED: { key: 'TEXT_HARNESS_CONFIRMED', verified: true, status: 'CONFIRMED', source: 'test', evidenceId: '4', version: '1', verifiedAt: null, freshness: 'FRESH' },
      IMAGE_HARNESS_CONFIRMED: { key: 'IMAGE_HARNESS_CONFIRMED', verified: true, status: 'CONFIRMED', source: 'test', evidenceId: '5', version: '1', verifiedAt: null, freshness: 'FRESH' },
      OPERATING_POLICY_CONFIRMED: { key: 'OPERATING_POLICY_CONFIRMED', verified: true, status: 'CONFIRMED', source: 'test', evidenceId: '6', version: '1', verifiedAt: null, freshness: 'FRESH' },
    },
    blockers: [
      {
        code: 'THREADS_NOT_VERIFIED',
        factKey: 'THREADS_VERIFIED',
        message: '스레드 채널 연동이 검증되지 않았습니다.',
        remediationAction: '스레드 계정 연동',
        remediationHref: '/onboarding/channels/threads',
      },
    ],
  }

  const fullyReadySnapshot: SoheeReadinessSnapshot = {
    workspaceId: 'ws-ready',
    ready: true,
    evaluatedAt: new Date().toISOString(),
    facts: {
      BUSINESS_VERIFIED: { key: 'BUSINESS_VERIFIED', verified: true, status: 'VERIFIED', source: 'test', evidenceId: '1', version: null, verifiedAt: null, freshness: 'FRESH' },
      INSTAGRAM_VERIFIED: { key: 'INSTAGRAM_VERIFIED', verified: true, status: 'VERIFIED', source: 'test', evidenceId: '2', version: null, verifiedAt: null, freshness: 'FRESH' },
      THREADS_VERIFIED: { key: 'THREADS_VERIFIED', verified: true, status: 'VERIFIED', source: 'test', evidenceId: '2b', version: null, verifiedAt: null, freshness: 'FRESH' },
      BUSINESS_KNOWLEDGE_CONFIRMED: { key: 'BUSINESS_KNOWLEDGE_CONFIRMED', verified: true, status: 'CONFIRMED', source: 'test', evidenceId: '3', version: 'v1.0', verifiedAt: null, freshness: 'FRESH' },
      TEXT_HARNESS_CONFIRMED: { key: 'TEXT_HARNESS_CONFIRMED', verified: true, status: 'CONFIRMED', source: 'test', evidenceId: '4', version: 'v1', verifiedAt: null, freshness: 'FRESH' },
      IMAGE_HARNESS_CONFIRMED: { key: 'IMAGE_HARNESS_CONFIRMED', verified: true, status: 'CONFIRMED', source: 'test', evidenceId: '5', version: 'v1', verifiedAt: null, freshness: 'FRESH' },
      OPERATING_POLICY_CONFIRMED: { key: 'OPERATING_POLICY_CONFIRMED', verified: true, status: 'CONFIRMED', source: 'test', evidenceId: '6', version: 'v1', verifiedAt: null, freshness: 'FRESH' },
    },
    blockers: [],
  }

  it('rejects mission creation when workspace is not SOHEE_READY (fail-closed)', async () => {
    const params: SharedMissionParams = {
      workspaceId: 'ws-pre-ready',
      source: 'CONTENT_UI',
      intent: '봄 신메뉴 인스타그램/스레드 동시 홍보',
      channelTargets: ['instagram', 'threads'],
    }

    await expect(
      createSharedMissionEntry(params, { readinessSnapshot: preReadySnapshot })
    ).rejects.toThrowError(/SOHEE_NOT_READY/)
  })

  it('pins immutable harness snapshots (business, text, image) when creating mission for ready workspace', async () => {
    const params: SharedMissionParams = {
      workspaceId: 'ws-ready',
      source: 'CHAT_COMMAND',
      intent: '프랑스 유기농 샤워도우 굽는 일상 포스팅 작성해줘',
      channelTargets: ['instagram', 'threads'],
    }

    const mission = await createSharedMissionEntry(params, { readinessSnapshot: fullyReadySnapshot })

    expect(mission.id).toBeDefined()
    expect(mission.status).toBe('PLANNING')
    expect(mission.harnessSnapshot).toEqual({
      businessKnowledgeVersionId: '3',
      textHarnessVersionId: '4',
      imageHarnessVersionId: '5',
      operatingPolicyVersionId: '6',
    })
    expect(mission.channelTargets).toEqual(['instagram', 'threads'])
  })
})

describe('HF-23: Persistent Sohee Dock Modes (Education / Work / Attention)', () => {
  it('resolves to EDUCATION mode when workspace is not ready', () => {
    const mode = resolveDockUIMode({
      isSoheeReady: false,
      hasPendingApproval: false,
      runtimeReadiness: 'BLOCKED',
    })
    expect(mode).toBe('EDUCATION')
  })

  it('resolves to ATTENTION mode when ready but has pending approval or degraded token', () => {
    const modeWithApproval = resolveDockUIMode({
      isSoheeReady: true,
      hasPendingApproval: true,
      runtimeReadiness: 'SOHEE_READY',
    })
    expect(modeWithApproval).toBe('ATTENTION')

    const modeDegraded = resolveDockUIMode({
      isSoheeReady: true,
      hasPendingApproval: false,
      runtimeReadiness: 'READY_DEGRADED',
    })
    expect(modeDegraded).toBe('ATTENTION')
  })

  it('resolves to WORK mode when fully ready without pending blockers', () => {
    const mode = resolveDockUIMode({
      isSoheeReady: true,
      hasPendingApproval: false,
      runtimeReadiness: 'SOHEE_READY',
    })
    expect(mode).toBe('WORK')
  })
})

describe('HF-25: Natural-Language Revision & Approval Invalidation', () => {
  it('creates new version, updates fingerprint, and invalidates previous approval', () => {
    const initialContent: ContentItem = {
      id: 'cnt-1',
      workspaceId: 'ws-ready',
      version: 1,
      caption: '대박 할인! 오늘만 샤워도우 50% 세일!',
      imageUrl: 'https://cdn.example.com/bread.jpg',
      channels: ['instagram'],
      fingerprint: 'fp-v1-sale',
      harnessVersionSnapshot: {
        textVersion: 'v1',
        imageVersion: 'v1',
      },
    }

    const initialApproval: ContentApprovalRecord = {
      id: 'appr-1',
      contentId: 'cnt-1',
      contentVersion: 1,
      fingerprint: 'fp-v1-sale',
      status: 'APPROVED',
      approvedAt: new Date().toISOString(),
    }

    const revisionResult = reviseContentWithNaturalLanguage({
      content: initialContent,
      existingApproval: initialApproval,
      revisionPrompt: '광고 느낌 줄이고 매장의 따뜻한 아침 풍경을 강조해줘',
    })

    // 1. Content version incremented
    expect(revisionResult.newContent.version).toBe(2)
    expect(revisionResult.newContent.caption).toContain('따뜻한 아침')
    expect(revisionResult.newContent.fingerprint).not.toBe(initialContent.fingerprint)

    // 2. Previous approval invalidated
    expect(revisionResult.invalidatedApproval.status).toBe('INVALIDATED')
    expect(revisionResult.invalidatedApproval.invalidationReason).toContain('NATURAL_LANGUAGE_REVISION')
  })
})
