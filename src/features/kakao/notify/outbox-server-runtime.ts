/**
 * 카카오 알림톡 Outbox 서버 런타임 (Notification Outbox Server Runtime)
 *
 * 관리자 권한 Supabase 클라이언트(createAdminSupabaseClient)와 알림톡 Outbox 런타임
 * (createNotificationOutboxRuntime)을 통합하여 서버 환경에서 배치를 안전하게 구동합니다.
 *
 * [보안 및 격리 원칙]
 * 1. Fail-Closed 킬스위치 사전 차단:
 *    KAKAO_OUTBOX_ENABLED와 SOLAPI_ENABLED 둘 다 'true'가 아니면
 *    어떠한 Admin Client 생성, 런타임 조립, DB 쿼리, RPC 호출, 외부 발송도 수행하지 않고
 *    즉시 disabled 통계(포트 source/send 호출 0건)를 반환합니다.
 * 2. 서버 고정 처리 상한 (Fixed Batch Limit):
 *    외부 주입이나 페이로드 조작을 원천 차단하기 위해 배치 크기는 서버 상수로 고정(limit: 20)됩니다.
 * 3. 클로저 격리 및 PII/시크릿 유출 차단:
 *    반환 객체는 통계 카운트만 포함하며 고객 전화번호, 이름, 토큰, 환경변수 등 민감 정보를 영구 은닉합니다.
 * 4. 결과불명(UNKNOWN) 격리:
 *    발송 시도 후 UNKNOWN 상태로 귀결된 작업에 대해서는 자체 자동 재시도를 일체 수행하지 않습니다.
 * 5. 정적 정책 리더 연결:
 *    createOutboxPolicyReaders 정적 바인딩을 통해 최신 예약 수신 근거 및 템플릿 심사 승인 상태를 검증합니다.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { SolapiEnv } from './solapi-factory'
import type { SendFn } from './outbox-processor'
import {
  createNotificationOutboxRuntime,
} from './outbox-runtime'
import {
  createInitialCounts,
  type NotificationOutboxBatchResult,
} from './outbox-runner'
import { createSolapiOutboxSender } from './outbox-sender'
import {
  createOutboxPolicyReaders,
  type OutboxPolicyReaders,
} from './outbox-policy-readers'
import type { SupabaseOutboxClient } from './supabase-outbox-ports'

export const SERVER_OUTBOX_LIMIT = 20

export type { OutboxPolicyReaders }

export type OutboxPolicyReadersFactory = (
  client: Pick<SupabaseClient, 'from'>,
  env: SolapiEnv,
  now?: () => Date,
) => OutboxPolicyReaders

export type SolapiOutboxSenderFactory = (
  env: SolapiEnv,
) => SendFn

export interface RunServerNotificationOutboxOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  createAdminClient?: () => SupabaseClient | SupabaseOutboxClient
  createPolicyReaders?: OutboxPolicyReadersFactory
  createSender?: SolapiOutboxSenderFactory
  createRuntime?: typeof createNotificationOutboxRuntime
  now?: Date | (() => Date)
}

/**
 * 솔라피 아웃박스 발송기 팩토리 획득 (주입값 우선, 기본값 createSolapiOutboxSender)
 */
function resolveSenderFactory(
  injected?: SolapiOutboxSenderFactory,
): SolapiOutboxSenderFactory {
  if (injected) {
    return injected
  }

  return (env) => createSolapiOutboxSender(env)
}

/**
 * 서버 환경에서 카카오 알림톡 Outbox 배치를 1회 실행합니다.
 *
 * @param options 주입 가능한 옵션 (테스트 및 환경 격리용)
 * @returns 배치 실행 결과 통계 (민감 정보 제외)
 */
export async function runServerNotificationOutbox(
  options?: RunServerNotificationOutboxOptions,
): Promise<NotificationOutboxBatchResult> {
  const env = (options?.env ?? process.env) as SolapiEnv

  // 1. 공용 플래그 킬스위치 사전 차단 (Fail-Closed)
  // KAKAO_OUTBOX_ENABLED/SOLAPI_ENABLED 둘 다 === 'true'가 아니면
  // runtime을 불러오거나 adminclient 생성 없이 즉시 disabled 통계 반환 (포트 source/send 호출 0)
  const isOutboxEnabled = env.KAKAO_OUTBOX_ENABLED === 'true'
  const isSolapiEnabled = env.SOLAPI_ENABLED === 'true'

  if (!isOutboxEnabled || !isSolapiEnabled) {
    return {
      enabled: false,
      processed: 0,
      counts: createInitialCounts(),
      errors: 0,
      expired: 0,
    }
  }

  // 2. enabled일 때만 Admin Client 생성
  const getAdminClient =
    options?.createAdminClient ??
    (await import('@/lib/supabase/admin')).createAdminSupabaseClient

  const client = getAdminClient()

  // 3. 동료 exports 포트 조립 (주입값 우선, 미주입 시 정적 import 함수 호출)
  const policyReadersFactory =
    options?.createPolicyReaders ?? createOutboxPolicyReaders
  const nowFn =
    typeof options?.now === 'function'
      ? options.now
      : options?.now instanceof Date
        ? () => options?.now as Date
        : undefined

  const readers = policyReadersFactory(client, env, nowFn)

  const senderFactory = resolveSenderFactory(options?.createSender)
  const send = senderFactory(env)

  // 4. Runtime 인스턴스 조립 (limit 서버 고정 20)
  const runtimeFactory = options?.createRuntime ?? createNotificationOutboxRuntime
  const runtime = runtimeFactory({
    client,
    env,
    evidenceReader: readers.evidenceReader,
    templateApprovalReader: readers.templateApprovalReader,
    send,
    now: options?.now,
    limit: SERVER_OUTBOX_LIMIT,
  })

  // 5. 실행 및 결과 반환 (서버 고정 limit 20 적용)
  return runtime.run({
    limit: SERVER_OUTBOX_LIMIT,
    now: options?.now,
  })
}
