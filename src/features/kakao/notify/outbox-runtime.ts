/**
 * 카카오 알림톡 Outbox 런타임 팩토리 (Notification Outbox Runtime Factory)
 *
 * Outbox 처리 파이프라인의 핵심 구성 요소들을 런타임에 안전하게 조립하여 반환합니다:
 * 1. SupabaseOutboxPorts (RPC 클라이언트, 예약 조회 어댑터, 작업 대기열 소스)
 * 2. SupabaseNotificationOutboxStore (원자적 CAS 점유 및 상태 전이 저장소)
 * 3. OutboxRepository (최신 예약 및 정보성 수신 근거, 템플릿 심사 승인 리포지토리)
 * 4. runNotificationOutboxBatch (배치 오케스트레이터 실행 함수)
 *
 * [보안 및 안정성 철칙]
 * - 클로저 격리 (Closure Only): 반환 객체는 오직 `run` 실행 메서드만 노출하며,
 *   내부 SupabaseClient, 환경변수, API Secret, 토큰 등의 민감 정보를 은닉합니다.
 * - Fail-Closed 킬스위치 & 활성화 조건:
 *   KAKAO_OUTBOX_ENABLED === 'true' &&
 *   SOLAPI_ENABLED === 'true' &&
 *   evaluateAlimtalkReadiness(env).configurationReady &&
 *   evidenceReader 존재 &&
 *   templateApprovalReader 존재 &&
 *   send 존재
 *   위 조건 중 단 하나라도 충족되지 않으면 disabled로 격리되어 DB 쿼리, RPC 호출, 외부 발송 부작용이 0건으로 보장됩니다.
 * - Fallback Send 네트워크 차단: send 미주입 시 네트워크 통신 없이 안전하게 거부하는 정적 fallback을 사용합니다.
 * - 무차별 재시도 금지: UNKNOWN 상태로 귀결된 작업에 대한 자체 자동 재시도를 수행하지 않습니다.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { SolapiEnv } from './solapi-factory'
import { evaluateAlimtalkReadiness } from './readiness'
import {
  type SendFn,
  type OutboxProcessorDeps,
} from './outbox-processor'
import {
  OutboxRepository,
  type InformationalEvidenceReader,
  type TemplateApprovalReader,
} from './outbox-repository'
import { SupabaseNotificationOutboxStore } from './outbox-store'
import {
  createSupabaseOutboxPorts,
  type SupabaseOutboxClient,
} from './supabase-outbox-ports'
import {
  runNotificationOutboxBatch,
  type NotificationOutboxBatchResult,
} from './outbox-runner'
import {
  createOutboxAllowlist,
  type OutboxAllowlist,
} from './allowlist'

export interface CreateNotificationOutboxRuntimeParams {
  client: SupabaseClient | SupabaseOutboxClient
  env: SolapiEnv
  evidenceReader?: InformationalEvidenceReader
  templateApprovalReader?: TemplateApprovalReader
  send?: SendFn
  now?: Date | (() => Date)
  limit?: number
  allowlist?: OutboxAllowlist
}

export interface NotificationOutboxRuntimeRunOptions {
  limit?: number
  now?: Date | (() => Date)
}

export interface NotificationOutboxRuntime {
  run(options?: NotificationOutboxRuntimeRunOptions): Promise<NotificationOutboxBatchResult>
}

/**
 * 절대 외부 네트워크를 타지 않고 고정 거부를 반환하는 안전한 Fallback Send 함수
 */
const safeFallbackSend: SendFn = async () => {
  return { accepted: false }
}

/**
 * 카카오 알림톡 Outbox 런타임 인스턴스 조립 및 생성
 */
export function createNotificationOutboxRuntime(
  params: CreateNotificationOutboxRuntimeParams,
): NotificationOutboxRuntime {
  const {
    client,
    env,
    evidenceReader,
    templateApprovalReader,
    send: injectedSend,
    now: defaultNow,
    limit: defaultLimit,
  } = params

  // 1. 운영 준비 상태 및 활성화 조건 엄격 검증 (Fail-Closed)
  const readiness = evaluateAlimtalkReadiness(env)
  const hasEvidenceReader = evidenceReader !== undefined && evidenceReader !== null
  const hasTemplateApprovalReader =
    templateApprovalReader !== undefined && templateApprovalReader !== null
  const hasInjectedSend = typeof injectedSend === 'function'

  const isEnabled =
    env.KAKAO_OUTBOX_ENABLED === 'true' &&
    env.SOLAPI_ENABLED === 'true' &&
    readiness.configurationReady &&
    hasEvidenceReader &&
    hasTemplateApprovalReader &&
    hasInjectedSend

  // 2. 어댑터 및 포트 조립
  // send 미주입 시 네트워크 호출이 없는 고정 거부 fallback 적용
  const sendFn = hasInjectedSend ? injectedSend : safeFallbackSend

  const ports = createSupabaseOutboxPorts(client)
  const store = new SupabaseNotificationOutboxStore(ports.rpcClient)
  const repository = new OutboxRepository({
    reservationReader: ports.reservationReader,
    evidenceReader,
    templateApprovalReader,
  })
  const allowlist = params.allowlist ?? createOutboxAllowlist(env.KAKAO_OUTBOX_TEST_ALLOWLIST)

  const baseProcessorDeps: OutboxProcessorDeps = {
    enabled: isEnabled,
    now: defaultNow ?? (() => new Date()),
    repository,
    store,
    send: sendFn,
    allowlist,
  }

  // 3. 클로저 기반 런타임 인터페이스 반환 (client, env, secrets 외부 직렬화/노출 영구 차단)
  return {
    async run(options?: NotificationOutboxRuntimeRunOptions): Promise<NotificationOutboxBatchResult> {
      const effectiveNow = options?.now ?? baseProcessorDeps.now
      const effectiveLimit = options?.limit ?? defaultLimit

      const processorDeps: OutboxProcessorDeps = {
        ...baseProcessorDeps,
        now: effectiveNow,
      }

      return runNotificationOutboxBatch({
        processorDeps,
        source: ports.source,
        limit: effectiveLimit,
      })
    },
  }
}
