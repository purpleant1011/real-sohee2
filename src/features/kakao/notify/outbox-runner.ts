/**
 * 카카오 알림톡 Outbox 배치 실행기 (Notification Outbox Batch Runner)
 *
 * 주기적 트리거(Cron, 워커 또는 수동 호출)를 통해 대기 중인(due) Outbox 작업을
 * 안전하게 폴링하여 순차 처리하는 배치 오케스트레이터입니다.
 *
 * [현실적 한계 및 운영 고지]
 * 1. 본 모듈은 배치 실행 엔진이며, 실제 주기적 Cron 스케줄러나 HTTP 라우트 엔드포인트의 등록은
 *    본 작업의 범위에 포함되지 않습니다. 따라서 이 모듈의 존재만으로 단독 운영 준비가 완료되었다고
 *    주장할 수 없습니다.
 * 2. 안전성 및 보안 철칙:
 *    - disabled 상태에서는 source(조회/만료), store(점유/상태기록), send(외부 발송)를 일체 호출하지 않습니다.
 *    - 반환 결과 및 에러는 오직 통계 카운트({ enabled, processed, counts, errors, expired })만을 포함하며,
 *      고객 전화번호, 이름, 토큰, 리스 키, 오류 원문 등 민감 정보(PII 및 내부 상태)의 외부 유출을 철저히 차단합니다.
 *    - 외부 발송 후 UNKNOWN 상태로 전이된 작업에 대해서는 무차별 자동 재시도를 절대 수행하지 않습니다.
 */

import {
  processNotificationJob,
  type Job,
  type OutboxProcessorDeps,
  type ProcessOutcomeStatus,
} from './outbox-processor'

export const DEFAULT_OUTBOX_BATCH_LIMIT = 20
export const MIN_OUTBOX_BATCH_LIMIT = 1
export const MAX_OUTBOX_BATCH_LIMIT = 50

export interface OutboxSourcePort {
  listDueJobs(limit: number, now: Date): Promise<Job[]>
  expireSending(): Promise<number>
}

export interface RunNotificationOutboxBatchParams {
  processorDeps: OutboxProcessorDeps
  source: OutboxSourcePort
  limit?: number
}

export type OutboxOutcomeCounts = Record<ProcessOutcomeStatus, number>

export interface NotificationOutboxBatchResult {
  enabled: boolean
  processed: number
  counts: OutboxOutcomeCounts
  errors: number
  expired: number
}

/**
 * 초기 outcome 상태별 카운트 객체 생성
 */
export function createInitialCounts(): OutboxOutcomeCounts {
  return {
    DISABLED: 0,
    NOT_DUE: 0,
    CLAIM_FAILED: 0,
    BLOCKED: 0,
    SUPERSEDED: 0,
    CAS_LOST: 0,
    UNKNOWN: 0,
    SENT: 0,
  }
}

/**
 * Outbox 배치 실행
 *
 * @param params 배치 실행 파라미터 (processorDeps, source, limit)
 * @returns 배치 실행 결과 통계 (민감 정보 및 오류 원문 제외)
 */
export async function runNotificationOutboxBatch(
  params: RunNotificationOutboxBatchParams,
): Promise<NotificationOutboxBatchResult> {
  const { processorDeps, source, limit } = params

  const effectiveLimit = limit === undefined ? DEFAULT_OUTBOX_BATCH_LIMIT : limit

  // 1. limit 유효성 엄격 검증 (1~50 사이의 정수만 허용, 공급자 내부 텍스트 없는 정적 에러)
  if (
    typeof effectiveLimit !== 'number' ||
    !Number.isInteger(effectiveLimit) ||
    effectiveLimit < MIN_OUTBOX_BATCH_LIMIT ||
    effectiveLimit > MAX_OUTBOX_BATCH_LIMIT
  ) {
    throw new Error('Invalid limit: limit must be an integer between 1 and 50')
  }

  // 2. disabled 상태 검사: source(expireSending, listDueJobs), store, send, now 모두 호출 0
  if (!processorDeps || !processorDeps.enabled) {
    return {
      enabled: false,
      processed: 0,
      counts: createInitialCounts(),
      errors: 0,
      expired: 0,
    }
  }

  const counts = createInitialCounts()
  let processed = 0
  let errors = 0

  // 3. enabled 상태: now 평가 및 엄격한 유효성 검사 (실패 시 source/store/send 0회 호출, errors: 1 정적 반환)
  let now: Date
  try {
    const nowRaw =
      typeof processorDeps.now === 'function' ? processorDeps.now() : processorDeps.now
    const parsedDate = nowRaw instanceof Date ? nowRaw : new Date(nowRaw)
    if (Number.isNaN(parsedDate.getTime())) {
      return {
        enabled: true,
        processed: 0,
        counts,
        errors: 1,
        expired: 0,
      }
    }
    now = parsedDate
  } catch {
    return {
      enabled: true,
      processed: 0,
      counts,
      errors: 1,
      expired: 0,
    }
  }

  // 4. expireSending 1회 호출 (Number.isInteger && isFinite && >= 0 엄격 체크, 실패 시 errors: 1 및 listDueJobs 미호출)
  let expired = 0
  try {
    const expireCount = await source.expireSending()
    if (
      typeof expireCount !== 'number' ||
      !Number.isInteger(expireCount) ||
      !Number.isFinite(expireCount) ||
      expireCount < 0
    ) {
      return {
        enabled: true,
        processed: 0,
        counts,
        errors: 1,
        expired: 0,
      }
    }
    expired = expireCount
  } catch {
    return {
      enabled: true,
      processed: 0,
      counts,
      errors: 1,
      expired: 0,
    }
  }

  // 5. listDueJobs 1회 호출 (배열이 아니면 errors: 1 및 중단)
  let dueJobs: Job[]
  try {
    const rawJobs = await source.listDueJobs(effectiveLimit, now)
    if (!Array.isArray(rawJobs)) {
      return {
        enabled: true,
        processed: 0,
        counts,
        errors: 1,
        expired,
      }
    }
    dueJobs = rawJobs
  } catch {
    return {
      enabled: true,
      processed: 0,
      counts,
      errors: 1,
      expired,
    }
  }

  // 6. 최대 limit 슬라이스 및 중복 job id 필터링 (동일 job id는 1회만 처리)
  const targetJobs = dueJobs.slice(0, effectiveLimit)
  const seenJobIds = new Set<string>()

  // 7. 순차 처리 (각 job별 예외 격리, 자동 재시도 금지)
  for (const job of targetJobs) {
    if (!job || typeof job !== 'object' || typeof job.id !== 'string' || !job.id.trim()) {
      errors++
      continue
    }

    if (seenJobIds.has(job.id)) {
      continue
    }
    seenJobIds.add(job.id)

    try {
      const outcome = await processNotificationJob(job, processorDeps)
      processed++
      if (outcome && outcome.status && typeof counts[outcome.status] === 'number') {
        counts[outcome.status]++
      }
    } catch {
      // per-job 예외 격리: errors++ 후 다음 job 진행 (해당 job에 대한 자동 재시도 금지)
      errors++
    }
  }

  return {
    enabled: true,
    processed,
    counts,
    errors,
    expired,
  }
}
