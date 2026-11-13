import { evaluateReadiness } from '@/features/readiness'
import { computeTutorialStagesStatus } from '@/features/tutorial-journey/tutorial-journey-read-model'
import type { SoheeReadinessSnapshot } from '@/features/sohee-ready/types'
import { COHORT_CONFIG } from './config'

/** 퍼널 순서. 사용자 진행률(readiness / tutorial-journey)과 같은 판정 함수를 재사용한다. */
export const FUNNEL_STAGES = ['SIGNUP', 'BUSINESS_VERIFIED', 'CHANNEL_CONNECTED', 'FIRST_VAULT', 'FIRST_PUBLISH', 'FIRST_REACTION'] as const
export type FunnelStage = (typeof FUNNEL_STAGES)[number]
export const STAGE_LABEL: Record<FunnelStage, string> = {
  SIGNUP: '가입',
  BUSINESS_VERIFIED: '사업자 확인',
  CHANNEL_CONNECTED: '채널 연결',
  FIRST_VAULT: '첫 보관',
  FIRST_PUBLISH: '첫 게시',
  FIRST_REACTION: '첫 반응',
}

/** undefined = 소스를 읽지 못함(알 수 없음), null = 읽었고 아직 없음, string = 최초 시각. */
export type EventAt = string | null | undefined
export type SourceCount = number | undefined

export interface CohortWorkspaceInput {
  workspaceId: string
  name: string
  createdAt: string
  /** null = 진행률 판정 불가(읽기 실패) */
  snapshot: SoheeReadinessSnapshot | null
  firstVaultAt: EventAt
  firstPublishAt: EventAt
  firstReactionAt: EventAt
  /** 보관 글 재확인 필요 건수 */
  vaultRecheckCount: SourceCount
  /** 연결 끊김/오류 채널 수 */
  channelProblemCount: SourceCount
  /** 처리 전 사용자 불만 수(의견 허브). 조회 실패는 undefined. */
  complaintCount?: SourceCount
}

export type StageReach = { state: 'REACHED'; at: string | null } | { state: 'NOT_REACHED' } | { state: 'UNKNOWN' }

export interface FunnelResult {
  workspaceId: string
  name: string
  reach: Record<FunnelStage, StageReach>
  /** 막힌 단계. 판정 불가거나 전부 도달이면 null */
  blockedStage: FunnelStage | null
  status: 'BLOCKED' | 'COMPLETED' | 'UNKNOWN'
  /** 막힌 단계에 머문 시간(시간 단위). 기준 시각을 모르면 null — 숫자를 지어내지 않는다. */
  elapsedHours: number | null
}

function earliest(...values: (string | null | undefined)[]): string | null {
  const times = values.filter((v): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))).sort()
  return times[0] ?? null
}

function eventReach(at: EventAt): StageReach {
  if (at === undefined) return { state: 'UNKNOWN' }
  return at === null ? { state: 'NOT_REACHED' } : { state: 'REACHED', at }
}

export function computeFunnel(input: CohortWorkspaceInput, now: Date): FunnelResult {
  const reach = {} as Record<FunnelStage, StageReach>
  reach.SIGNUP = { state: 'REACHED', at: input.createdAt }
  if (input.snapshot === null) {
    reach.BUSINESS_VERIFIED = { state: 'UNKNOWN' }
    reach.CHANNEL_CONNECTED = { state: 'UNKNOWN' }
  } else {
    // 사용자 사이트와 동일한 판정: evaluateReadiness / computeTutorialStagesStatus
    const snap = input.snapshot
    const businessDone = evaluateReadiness(snap).businessVerified
    const channelDone = computeTutorialStagesStatus(snap).stage2Done
    reach.BUSINESS_VERIFIED = businessDone
      ? { state: 'REACHED', at: snap.facts.BUSINESS_VERIFIED.verifiedAt }
      : { state: 'NOT_REACHED' }
    reach.CHANNEL_CONNECTED = channelDone
      ? {
        state: 'REACHED',
        at: earliest(
          snap.facts.INSTAGRAM_VERIFIED.verified ? snap.facts.INSTAGRAM_VERIFIED.verifiedAt : null,
          snap.facts.THREADS_VERIFIED.verified ? snap.facts.THREADS_VERIFIED.verifiedAt : null,
        ),
      }
      : { state: 'NOT_REACHED' }
  }
  reach.FIRST_VAULT = eventReach(input.firstVaultAt)
  reach.FIRST_PUBLISH = eventReach(input.firstPublishAt)
  reach.FIRST_REACTION = eventReach(input.firstReactionAt)

  let previousAt: string | null = null
  for (const stage of FUNNEL_STAGES) {
    const r = reach[stage]
    if (r.state === 'REACHED') { previousAt = r.at ?? previousAt; continue }
    // 앞 단계가 불명이면 막힌 곳을 단정하지 않는다.
    if (r.state === 'UNKNOWN') {
      return { workspaceId: input.workspaceId, name: input.name, reach, blockedStage: null, status: 'UNKNOWN', elapsedHours: null }
    }
    const since = previousAt === null ? NaN : Date.parse(previousAt)
    const hours = (now.getTime() - since) / 3_600_000
    return {
      workspaceId: input.workspaceId, name: input.name, reach, blockedStage: stage, status: 'BLOCKED',
      elapsedHours: Number.isFinite(hours) && hours >= 0 ? Math.floor(hours) : null,
    }
  }
  return { workspaceId: input.workspaceId, name: input.name, reach, blockedStage: null, status: 'COMPLETED', elapsedHours: null }
}

export type QueueReason = 'STALLED' | 'VAULT_RECHECK' | 'CHANNEL_PROBLEM' | 'BILLING' | 'COMPLAINT'
export const REASON_LABEL: Record<QueueReason, string> = {
  STALLED: '같은 단계에서 오래 멈춰 있어요',
  VAULT_RECHECK: '보관한 글을 다시 확인해야 해요',
  CHANNEL_PROBLEM: '채널 연결이 끊겼어요',
  BILLING: '결제/크레딧에 문제가 있어요',
  COMPLAINT: '불만이 접수됐어요',
}
/** 'NOT_CONNECTED' = 데이터 소스가 아직 없음(정직하게 "연결 전" 표시). 'ERROR' = 읽기 실패. */
export type SourceStatus = 'OK' | 'ERROR' | 'NOT_CONNECTED'

export interface QueueItem { workspaceId: string; name: string; reasons: QueueReason[] }
export interface QueueResult {
  items: QueueItem[]
  sources: Record<QueueReason, SourceStatus>
  /** 연결된 소스를 하나라도 읽지 못했으면 false — 이때 빈 목록을 "비었음"으로 보여선 안 된다. */
  complete: boolean
}

export function buildQueue(inputs: readonly CohortWorkspaceInput[], funnels: readonly FunnelResult[]): QueueResult {
  const sources: Record<QueueReason, SourceStatus> = {
    STALLED: funnels.some((f) => f.status === 'UNKNOWN') ? 'ERROR' : 'OK',
    VAULT_RECHECK: inputs.some((i) => i.vaultRecheckCount === undefined) ? 'ERROR' : 'OK',
    CHANNEL_PROBLEM: inputs.some((i) => i.channelProblemCount === undefined) ? 'ERROR' : 'OK',
    BILLING: 'NOT_CONNECTED',
    COMPLAINT: inputs.some((i) => i.complaintCount === undefined) ? 'ERROR' : 'OK',
  }
  const items: QueueItem[] = []
  inputs.forEach((input, idx) => {
    const f = funnels[idx]
    const reasons: QueueReason[] = []
    if (f.status === 'BLOCKED' && f.elapsedHours !== null && f.elapsedHours >= COHORT_CONFIG.STALL_HOURS) reasons.push('STALLED')
    if ((input.vaultRecheckCount ?? 0) > 0) reasons.push('VAULT_RECHECK')
    if ((input.channelProblemCount ?? 0) > 0) reasons.push('CHANNEL_PROBLEM')
    if ((input.complaintCount ?? 0) > 0) reasons.push('COMPLAINT')
    if (reasons.length) items.push({ workspaceId: input.workspaceId, name: input.name, reasons })
  })
  const complete = (['STALLED', 'VAULT_RECHECK', 'CHANNEL_PROBLEM', 'COMPLAINT'] as const).every((k) => sources[k] === 'OK')
  return { items, sources, complete }
}

export interface DropoffRow { stage: FunnelStage; label: string; reached: number | null; blockedHere: number | null }

/** 단계별 이탈 요약. 판정 불가(UNKNOWN) 워크스페이스가 있으면 숫자를 확정하지 않는다(null). */
export function summarizeDropoff(funnels: readonly FunnelResult[]): DropoffRow[] {
  const anyUnknown = funnels.some((f) => f.status === 'UNKNOWN')
  return FUNNEL_STAGES.map((stage) => ({
    stage,
    label: STAGE_LABEL[stage],
    reached: anyUnknown ? null : funnels.filter((f) => f.reach[stage].state === 'REACHED').length,
    blockedHere: anyUnknown ? null : funnels.filter((f) => f.blockedStage === stage).length,
  }))
}

export interface RegistryRow { workspace_id: string; display_name: string; dataset_mode: string; actor_kind: string; created_at: string }

/** ACTUAL + CUSTOMER만 집계. 분류 누락(UNCLASSIFIED)이 하나라도 있으면 합계 확정 금지. */
export function partitionCohort(rows: readonly RegistryRow[]): { included: RegistryRow[]; unclassified: number; totalConfirmed: boolean } {
  const actual = rows.filter((r) => r.dataset_mode === 'ACTUAL')
  const unclassified = actual.filter((r) => r.actor_kind === 'UNCLASSIFIED').length
  const included = actual.filter((r) => r.actor_kind === 'CUSTOMER')
  return { included, unclassified, totalConfirmed: unclassified === 0 && rows.length <= COHORT_CONFIG.MAX_COHORT }
}
