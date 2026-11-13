import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  OutcomeObservationService,
  type ObservationProviderClient,
  type PostLineageContext,
} from '@/features/outcome-observation'

describe('HF-54 / ANI-1404 · Post-Publish Outcome Observation & Lineage Tracking', () => {
  const WORKSPACE_ID = 'ws-outcome-1'
  const OTHER_WORKSPACE_ID = 'ws-outcome-2'

  let mockProvider: ObservationProviderClient
  let service: OutcomeObservationService

  const sampleLineage: PostLineageContext = {
    missionId: 'msn-100',
    contentItemId: 'cnt-item-200',
    contentVersionId: 'cnt-ver-300',
    creativeBundleId: 'cb-bundle-400',
    approvalId: 'appr-500',
    actionRequestId: 'act-req-600',
    actionAttemptId: 'act-att-700',
    businessKnowledgeVersionId: 'bk-v1',
    textHarnessVersionId: 'th-v1',
    imageHarnessVersionId: 'ih-v1',
  }

  beforeEach(() => {
    mockProvider = {
      fetchPostMetrics: vi.fn(),
    }
    service = new OutcomeObservationService({ providerClient: mockProvider })
  })

  // Test 1: verified provider post -> outcome snapshot 생성
  it('1. records outcome snapshot for verified published post with exact lineage', async () => {
    vi.mocked(mockProvider.fetchPostMetrics).mockResolvedValueOnce({
      status: 'AVAILABLE',
      likes: 120,
      comments: 15,
      impressions: 1500,
      permalink: 'https://instagram.com/p/post_123',
    })

    const snapshot = await service.observePost({
      workspaceId: WORKSPACE_ID,
      channel: 'instagram',
      providerPostId: 'ig_post_123',
      lineage: sampleLineage,
    })

    expect(snapshot.observedStatus).toBe('OBSERVED')
    expect(snapshot.metrics.likes).toBe(120)
    expect(snapshot.metrics.comments).toBe(15)
    expect(snapshot.metrics.impressions).toBe(1500)
    expect(snapshot.permalink).toBe('https://instagram.com/p/post_123')
    expect(snapshot.lineage.businessKnowledgeVersionId).toBe('bk-v1')
    expect(snapshot.lineage.textHarnessVersionId).toBe('th-v1')
  })

  // Test 2: provider metric unavailable -> NOT_AVAILABLE, zero로 위장 금지
  it('2. records NOT_AVAILABLE instead of false 0 when provider does not supply metric', async () => {
    vi.mocked(mockProvider.fetchPostMetrics).mockResolvedValueOnce({
      status: 'AVAILABLE',
      likes: 45,
      comments: 'NOT_AVAILABLE', // API에서 댓글 수 미제공
      impressions: 'NOT_AVAILABLE',
    })

    const snapshot = await service.observePost({
      workspaceId: WORKSPACE_ID,
      channel: 'threads',
      providerPostId: 'th_post_456',
      lineage: sampleLineage,
    })

    expect(snapshot.metrics.likes).toBe(45)
    expect(snapshot.metrics.comments).toBe('NOT_AVAILABLE')
    expect(snapshot.metrics.comments).not.toBe(0) // 0으로 위장 절대 금지!
    expect(snapshot.metrics.impressions).toBe('NOT_AVAILABLE')
  })

  // Test 3: provider timeout -> RESULT_UNKNOWN, 기존 verified publish 상태 유지
  it('3. isolates timeout as RESULT_UNKNOWN without invalidating verified publish state', async () => {
    vi.mocked(mockProvider.fetchPostMetrics).mockRejectedValueOnce(new Error('ETIMEDOUT: Meta Graph API timeout'))

    const snapshot = await service.observePost({
      workspaceId: WORKSPACE_ID,
      channel: 'instagram',
      providerPostId: 'ig_post_timeout',
      lineage: sampleLineage,
    })

    expect(snapshot.observedStatus).toBe('RESULT_UNKNOWN')
    // 발행 실패로 오인하지 않고 관찰 불확실성으로 유지
    expect(snapshot.errorMessage).toContain('Meta Graph API timeout')
  })

  // Test 4: 동일 post 재관찰 -> duplicate corruption 없음
  it('4. preserves historical snapshots without corruption across multiple observations', async () => {
    vi.mocked(mockProvider.fetchPostMetrics)
      .mockResolvedValueOnce({ status: 'AVAILABLE', likes: 10 })
      .mockResolvedValueOnce({ status: 'AVAILABLE', likes: 25 })

    await service.observePost({
      workspaceId: WORKSPACE_ID,
      channel: 'instagram',
      providerPostId: 'ig_post_history',
      lineage: sampleLineage,
    })

    await service.observePost({
      workspaceId: WORKSPACE_ID,
      channel: 'instagram',
      providerPostId: 'ig_post_history',
      lineage: sampleLineage,
    })

    const history = service.getObservationHistory(WORKSPACE_ID, 'ig_post_history')
    expect(history.length).toBe(2)
    expect(history[0].metrics.likes).toBe(10)
    expect(history[1].metrics.likes).toBe(25)
  })

  // Test 5: Instagram/Threads observations 독립
  it('5. maintains independent observation records for Instagram and Threads', async () => {
    vi.mocked(mockProvider.fetchPostMetrics)
      .mockResolvedValueOnce({ status: 'AVAILABLE', likes: 100 })
      .mockResolvedValueOnce({ status: 'AVAILABLE', likes: 20 })

    const igSnap = await service.observePost({
      workspaceId: WORKSPACE_ID,
      channel: 'instagram',
      providerPostId: 'post_same_id',
      lineage: sampleLineage,
    })

    const thSnap = await service.observePost({
      workspaceId: WORKSPACE_ID,
      channel: 'threads',
      providerPostId: 'post_same_id',
      lineage: sampleLineage,
    })

    expect(igSnap.channel).toBe('instagram')
    expect(igSnap.metrics.likes).toBe(100)
    expect(thSnap.channel).toBe('threads')
    expect(thSnap.metrics.likes).toBe(20)
  })

  // Test 6: cross-tenant provider post/action id 주입 -> deny
  it('6. denies cross-tenant post observation queries', async () => {
    vi.mocked(mockProvider.fetchPostMetrics).mockResolvedValueOnce({ status: 'AVAILABLE', likes: 50 })

    await service.observePost({
      workspaceId: WORKSPACE_ID,
      channel: 'instagram',
      providerPostId: 'ig_tenant_1',
      lineage: sampleLineage,
    })

    expect(() => {
      service.getObservationHistory(OTHER_WORKSPACE_ID, 'ig_tenant_1')
    }).toThrowError(/CROSS_TENANT_ACCESS_DENIED/)
  })

  // Test 7: deleted/unavailable post -> observation 상태 정확히 기록
  it('7. accurately records DELETED status when provider reports post unavailable', async () => {
    vi.mocked(mockProvider.fetchPostMetrics).mockResolvedValueOnce({
      status: 'DELETED',
      message: 'Post was deleted or removed by user',
    })

    const snapshot = await service.observePost({
      workspaceId: WORKSPACE_ID,
      channel: 'instagram',
      providerPostId: 'ig_deleted_post',
      lineage: sampleLineage,
    })

    expect(snapshot.observedStatus).toBe('DELETED')
  })

  // Test 8: observation에서 content/harness version lineage 역추적 가능
  it('8. allows complete retrospective lineage lookup from observation to harness versions', async () => {
    vi.mocked(mockProvider.fetchPostMetrics).mockResolvedValueOnce({ status: 'AVAILABLE', likes: 77 })

    const snapshot = await service.observePost({
      workspaceId: WORKSPACE_ID,
      channel: 'instagram',
      providerPostId: 'ig_lineage_trace',
      lineage: sampleLineage,
    })

    const lineage = service.getPostLineage(WORKSPACE_ID, snapshot.id)
    expect(lineage.missionId).toBe('msn-100')
    expect(lineage.contentVersionId).toBe('cnt-ver-300')
    expect(lineage.businessKnowledgeVersionId).toBe('bk-v1')
    expect(lineage.textHarnessVersionId).toBe('th-v1')
    expect(lineage.imageHarnessVersionId).toBe('ih-v1')
  })

  // Test 9: outcome 기반 Harness Candidate 제안이 있더라도 user confirm 전 active 변경 없음
  it('9. does not mutate active harness versions upon outcome suggestion without user confirm', async () => {
    const candidate = service.proposeHarnessImprovementCandidate({
      workspaceId: WORKSPACE_ID,
      harnessType: 'text_harness',
      currentVersionId: 'th-v1',
      suggestedRule: '문장 끝에 친근한 이모지 추가 권장',
      basedOnObservationId: 'obs-1',
    })

    expect(candidate.status).toBe('PROPOSED')
    // 능동적/자동 active 승격 금지 (정본 원칙: user confirm 전 active 변경 절대 금지)
    expect(service.isCandidateActive(WORKSPACE_ID, candidate.id)).toBe(false)
  })
})
