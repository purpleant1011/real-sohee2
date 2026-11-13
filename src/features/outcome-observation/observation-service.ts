/**
 * Post-Publish Outcome Observation Service (HF-54 / ANI-1404)
 * Collects legal/stable outcome metrics from Instagram & Threads,
 * links observation snapshots to mission/content/harness lineage,
 * prevents false-zeros, and isolates tenant boundaries.
 */

import { randomUUID } from 'node:crypto'
import type {
  ObservationProviderClient,
  ObservePostParams,
  ObservationSnapshot,
  PostLineageContext,
  HarnessImprovementCandidate,
} from './types'

export class OutcomeSecurityError extends Error {
  readonly code: string
  constructor(message: string, code = 'OUTCOME_SECURITY_ERROR') {
    super(`${code}: ${message}`)
    this.name = 'OutcomeSecurityError'
    this.code = code
  }
}

export interface OutcomeObservationServiceOptions {
  providerClient: ObservationProviderClient
}

export class OutcomeObservationService {
  private provider: ObservationProviderClient
  private snapshots = new Map<string, ObservationSnapshot>() // snapshotId -> snapshot
  private postHistory = new Map<string, string[]>() // `${workspaceId}:${channel}:${providerPostId}` -> snapshotId[]
  private postWorkspaceOwners = new Map<string, string>() // providerPostId -> workspaceId
  private candidates = new Map<string, HarnessImprovementCandidate>()

  constructor(options: OutcomeObservationServiceOptions) {
    this.provider = options.providerClient
  }

  /**
   * 게시물 성과/반응 관찰 스냅샷 생성
   */
  async observePost(params: ObservePostParams): Promise<ObservationSnapshot> {
    const { workspaceId, channel, providerPostId, lineage } = params

    // 테넌트 소유권 기록 및 검증
    const existingOwner = this.postWorkspaceOwners.get(providerPostId)
    if (existingOwner && existingOwner !== workspaceId) {
      throw new OutcomeSecurityError(
        `Post ${providerPostId} belongs to workspace ${existingOwner}`,
        'CROSS_TENANT_ACCESS_DENIED'
      )
    }
    this.postWorkspaceOwners.set(providerPostId, workspaceId)

    const snapshotId = randomUUID()
    const now = new Date().toISOString()

    try {
      const providerRes = await this.provider.fetchPostMetrics({ channel, providerPostId })

      let observedStatus: ObservationSnapshot['observedStatus'] = 'OBSERVED'
      if (providerRes.status === 'DELETED') {
        observedStatus = 'DELETED'
      } else if (providerRes.status === 'NOT_AVAILABLE') {
        observedStatus = 'NOT_AVAILABLE'
      }

      const snapshot: ObservationSnapshot = {
        id: snapshotId,
        workspaceId,
        channel,
        providerPostId,
        observedStatus,
        metrics: {
          likes: providerRes.likes,
          comments: providerRes.comments,
          impressions: providerRes.impressions,
        },
        permalink: providerRes.permalink,
        observedAt: now,
        lineage: { ...lineage },
      }

      this.saveSnapshot(snapshot)
      return { ...snapshot }
    } catch (err: unknown) {
      // 타임아웃/네트워크 오류 -> RESULT_UNKNOWN 격리 (발행 실패로 오인 금지)
      const snapshot: ObservationSnapshot = {
        id: snapshotId,
        workspaceId,
        channel,
        providerPostId,
        observedStatus: 'RESULT_UNKNOWN',
        metrics: {
          likes: 'NOT_AVAILABLE',
          comments: 'NOT_AVAILABLE',
          impressions: 'NOT_AVAILABLE',
        },
        errorMessage: (err as Error)?.message || 'Provider query timeout or network failure',
        observedAt: now,
        lineage: { ...lineage },
      }

      this.saveSnapshot(snapshot)
      return { ...snapshot }
    }
  }

  private saveSnapshot(snapshot: ObservationSnapshot): void {
    this.snapshots.set(snapshot.id, snapshot)
    const key = `${snapshot.workspaceId}:${snapshot.channel}:${snapshot.providerPostId}`
    const list = this.postHistory.get(key) || []
    list.push(snapshot.id)
    this.postHistory.set(key, list)
  }

  /**
   * 관찰 히스토리 조회 (테넌트 격리)
   */
  getObservationHistory(workspaceId: string, providerPostId: string): ObservationSnapshot[] {
    const owner = this.postWorkspaceOwners.get(providerPostId)
    if (owner && owner !== workspaceId) {
      throw new OutcomeSecurityError(
        `Post ${providerPostId} belongs to workspace ${owner}`,
        'CROSS_TENANT_ACCESS_DENIED'
      )
    }

    const results: ObservationSnapshot[] = []
    for (const snap of this.snapshots.values()) {
      if (snap.workspaceId === workspaceId && snap.providerPostId === providerPostId) {
        results.push({ ...snap })
      }
    }
    return results
  }

  /**
   * 스냅샷의 전체 계보(Lineage) 역추적
   */
  getPostLineage(workspaceId: string, snapshotId: string): PostLineageContext {
    const snap = this.snapshots.get(snapshotId)
    if (!snap) {
      throw new OutcomeSecurityError(`Snapshot ${snapshotId} not found`, 'SNAPSHOT_NOT_FOUND')
    }
    if (snap.workspaceId !== workspaceId) {
      throw new OutcomeSecurityError(
        `Snapshot ${snapshotId} does not belong to workspace ${workspaceId}`,
        'CROSS_TENANT_ACCESS_DENIED'
      )
    }
    return { ...snap.lineage }
  }

  /**
   * 성과 기반 하네스 개선 후보 제안 (정본 원칙: user confirm 전 active 변경 절대 금지)
   */
  proposeHarnessImprovementCandidate(params: {
    workspaceId: string
    harnessType: 'text_harness' | 'image_harness'
    currentVersionId: string
    suggestedRule: string
    basedOnObservationId: string
  }): HarnessImprovementCandidate {
    const { workspaceId, harnessType, currentVersionId, suggestedRule, basedOnObservationId } = params
    const candidateId = randomUUID()

    const candidate: HarnessImprovementCandidate = {
      id: candidateId,
      workspaceId,
      harnessType,
      currentVersionId,
      suggestedRule,
      basedOnObservationId,
      status: 'PROPOSED',
      createdAt: new Date().toISOString(),
    }

    this.candidates.set(candidateId, candidate)
    return { ...candidate }
  }

  /**
   * 후보가 active인지 확인 (사용자 confirm 전에는 절대 active가 될 수 없음)
   */
  isCandidateActive(_workspaceId: string, _candidateId: string): boolean {
    return false
  }
}
