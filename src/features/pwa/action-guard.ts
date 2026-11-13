'use client'

/**
 * 외부 쓰기 안전 장치 (ANI-1725).
 *
 * 두 가지만 책임진다.
 * 1) 오프라인에서 외부로 나가는 행위(발송·게시·예약·결제·환불)를 시작하지 않는다.
 *    큐에 쌓아 두었다가 나중에 자동 전송하지 않는다 — 연결이 없으면 그냥 거절한다.
 * 2) 같은 행위를 두 번 누르거나 두 번 도착시켜도 한 번만 실행한다.
 *
 * 서버 idempotency 를 대체하지 않는다. 이건 화면에서 새는 중복을 막는 앞단일 뿐이고,
 * 최종 판정은 서버가 한다.
 */

export type ExternalWriteKind = 'publish' | 'send' | 'reservation' | 'payment' | 'refund'

export const EXTERNAL_WRITE_KINDS: readonly ExternalWriteKind[] = [
  'publish',
  'send',
  'reservation',
  'payment',
  'refund',
]

export const OFFLINE_WRITE_COPY = '오프라인에서는 보낼 수 없어요. 연결된 뒤 다시 시도해 주세요.'
export const DUPLICATE_WRITE_COPY = '이미 처리 중이에요. 잠시만 기다려 주세요.'

export function isExternalWrite(kind: string): kind is ExternalWriteKind {
  return (EXTERNAL_WRITE_KINDS as readonly string[]).includes(kind)
}

export type WriteDecision =
  | { allowed: true }
  | { allowed: false; reason: 'offline' | 'duplicate'; message: string }

/**
 * 쓰기를 시작해도 되는지 판정한다. fail-closed: 연결 여부를 알 수 없으면(false) 거절한다.
 * 오프라인 판정이 중복 판정보다 먼저다 — 연결이 없으면 애초에 시작하지 않는다.
 */
export function decideExternalWrite(input: { online: boolean; inFlight: boolean }): WriteDecision {
  if (!input.online) {
    return { allowed: false, reason: 'offline', message: OFFLINE_WRITE_COPY }
  }
  if (input.inFlight) {
    return { allowed: false, reason: 'duplicate', message: DUPLICATE_WRITE_COPY }
  }
  return { allowed: true }
}

export type GuardResult<T> = { ran: true; value: T } | { ran: false; reason: 'duplicate' }

export type ActionGuard = {
  isRunning: (key: string) => boolean
  /** 시작 가능하면 표시하고 true. 이미 실행 중이면 false. */
  tryStart: (key: string) => boolean
  finish: (key: string) => void
  /** 실행 중이면 아무 것도 하지 않고 ran:false 를 돌려준다. */
  run: <T>(key: string, task: () => Promise<T>) => Promise<GuardResult<T>>
}

/**
 * 화면 단위 중복 실행 차단기. 메모리에만 존재하며 저장소에 남기지 않는다
 * (오프라인 재전송 큐를 만들지 않기 위한 의도적 선택).
 */
export function createActionGuard(): ActionGuard {
  const running = new Set<string>()

  const isRunning = (key: string) => running.has(key)

  const tryStart = (key: string) => {
    if (running.has(key)) return false
    running.add(key)
    return true
  }

  const finish = (key: string) => {
    running.delete(key)
  }

  const run = async <T>(key: string, task: () => Promise<T>): Promise<GuardResult<T>> => {
    if (!tryStart(key)) return { ran: false, reason: 'duplicate' }
    try {
      return { ran: true, value: await task() }
    } finally {
      finish(key)
    }
  }

  return { isRunning, tryStart, finish, run }
}
