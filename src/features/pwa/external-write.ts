/**
 * 외부 쓰기 진입점 공통 배선 (ANI-1778).
 *
 * ANI-1725 의 판정(`decideExternalWrite`)과 중복 차단(`createActionGuard`)을
 * 실제 액션 버튼에서 그대로 쓸 수 있게 묶는다.
 *
 * - 연결이 없으면 작업을 시작하지 않는다(fail-closed). 나중에 자동 재전송할 큐도 만들지 않는다.
 * - `navigator.onLine` 은 힌트일 뿐이므로, 힌트가 온라인일 때는 실제 연결 확인(probe)을 거친 뒤에만
 *   시작한다. 캡티브 포털·끊긴 업링크처럼 힌트가 틀린 경우에도 요청을 내보내지 않는다.
 * - 같은 행위가 이미 진행 중이면 두 번째 호출은 아무 것도 하지 않는다.
 * - 서버 idempotency 를 대체하지 않는다. 여기서 막는 것은 화면에서 새는 중복과
 *   오프라인 실행뿐이고, 최종 판정은 서버가 한다.
 */

import {
  DUPLICATE_WRITE_COPY,
  OFFLINE_WRITE_COPY,
  createActionGuard,
  decideExternalWrite,
  type ActionGuard,
  type ExternalWriteKind,
  type WriteDecision,
} from './action-guard'

export type BlockedWriteDecision = Extract<WriteDecision, { allowed: false }>

export type GuardedWriteOutcome<T> =
  | { ran: true; value: T }
  | { ran: false; decision: BlockedWriteDecision }

/** 같은 종류라도 대상이 다르면 동시에 진행할 수 있다. 예: 서로 다른 대화 두 건 전송. */
export function externalWriteKey(kind: ExternalWriteKind, actionKey: string): string {
  return `${kind}:${actionKey}`
}

/**
 * 예약 확정의 정본 식별자. 고객 장부와 에이전트 독이 **같은 예약**을 서로 다른 키로 잡으면
 * 두 화면에서 각각 요청이 나가 중복 예약이 생긴다. 두 진입점이 모두 이 함수를 쓴다.
 */
export function reservationWriteKey(
  workspaceId: string,
  customerName: string,
  bookingStartsAt: string,
): string {
  return `${workspaceId}:${customerName.trim()}:${bookingStartsAt.trim()}`
}

/**
 * 채널 게시/예약의 정본 식별자 (D4).
 * 채널별 고유 prefix를 사용하여 채널 간 동시 게시가 오차단되지 않게 하고,
 * 동일 채널·콘텐츠·모드의 중복 요청은 정확히 차단한다.
 */
export function publishWriteKey(
  channel: string,
  contentId: string,
  mode: string,
): string {
  return `${channel}-post:${contentId}:${mode}`
}

const offline = (): BlockedWriteDecision => ({
  allowed: false,
  reason: 'offline',
  message: OFFLINE_WRITE_COPY,
})

const duplicate = (): BlockedWriteDecision => ({
  allowed: false,
  reason: 'duplicate',
  message: DUPLICATE_WRITE_COPY,
})

export type ExternalWriteRunner = <T>(
  kind: ExternalWriteKind,
  actionKey: string,
  task: () => Promise<T>,
) => Promise<GuardedWriteOutcome<T>>

export type ConnectivityProbe = () => Promise<boolean>

export function createExternalWriteRunner(options: {
  guard: ActionGuard
  /** 브라우저가 알려 주는 연결 힌트. 틀릴 수 있으므로 이것만으로 시작하지 않는다. */
  isOnlineHint: () => boolean
  /** 실제 연결 확인. 없으면 힌트만으로 판정한다(테스트·비브라우저 환경). */
  probe?: ConnectivityProbe
}): ExternalWriteRunner {
  return async function runExternalWrite(kind, actionKey, task) {
    const key = externalWriteKey(kind, actionKey)

    // 1) 힌트가 오프라인이면 확인 없이 거절한다 — 오프라인 판정이 중복 판정보다 먼저다.
    const decision = decideExternalWrite({
      online: options.isOnlineHint(),
      inFlight: options.guard.isRunning(key),
    })
    if (!decision.allowed) return { ran: false, decision }

    // 2) 슬롯을 먼저 선점한다. probe 를 기다리는 동안 들어온 두 번째 탭도 중복으로 막힌다.
    if (!options.guard.tryStart(key)) return { ran: false, decision: duplicate() }

    try {
      // 3) 힌트가 온라인이라고 주장해도 실제 연결을 확인한 뒤에만 시작한다.
      if (options.probe) {
        const reachable = await options.probe().catch(() => false)
        if (!reachable) return { ran: false, decision: offline() }
      }
      return { ran: true, value: await task() }
    } finally {
      options.guard.finish(key)
    }
  }
}

/**
 * 페이지 로드 동안 화면끼리 공유하는 차단기. 메모리에만 있고 저장소에 남기지 않는다
 * (오프라인 재전송 큐를 만들지 않기 위한 의도적 선택 — ANI-1725).
 */
let pageGuard: ActionGuard = createActionGuard()

export function getPageActionGuard(): ActionGuard {
  return pageGuard
}

/** 테스트 전용: 페이지 차단기를 비운다. 제품 코드에서는 호출하지 않는다. */
export function resetPageActionGuardForTests(): void {
  pageGuard = createActionGuard()
}
