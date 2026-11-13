import type { ExecutePorts, ProviderOutcome } from './execute'

/**
 * 서버 포트 계층 — ANI-1704
 *
 * 코어(`execute.ts`)의 `ExecutePorts`를 **중복 정의하지 않고 그대로 재사용**한다.
 * 이 파일은 (1) Provider 포트 계약, (2) 인증된 workspace/actor 바인딩 타입,
 * (3) 기본 fail-closed Provider 만 정의한다.
 *
 * 실제 Meta 전송 어댑터는 이번 범위에 포함하지 않는다(설계 §7.2).
 * 실발송 연결은 사용자 승인 후 별도 이슈에서 진행한다.
 */
export type { ExecutePorts, ExecuteRequest, ApprovalSnapshot, ProviderOutcome } from './execute'

/**
 * 포트는 원시 HTTP body가 아니라 서버가 인증한 주체에 바인딩된다.
 * 클라이언트가 workspaceId/actorId/role을 지정할 수 없다.
 */
export interface ApprovalPortBinding {
  readonly workspaceId: string
  readonly actorId: string
  readonly role: 'owner' | 'manager' | 'staff'
}

export type ProviderAvailability = 'READY' | 'UNAVAILABLE'
export type ProviderReadback = 'verified' | 'not_found' | 'unknown'

export interface ProviderReadbackInput {
  readonly workspaceId: string
  readonly itemKey: string
  readonly idempotencyKey: string
}

/**
 * `approved`는 claim 시점에 고정된 불변 승인 스냅샷이다.
 * claim 이후 key로 문안을 다시 읽어 전송하면 승인 후 수정이 새지 않는다(README 계약).
 * 페이로드 스키마는 승인 종류별 어댑터가 정하며, 여기서 새로 정의하지 않는다.
 */
export interface ProviderSendInput<TPayload = unknown> {
  readonly workspaceId: string
  readonly itemKey: string
  readonly idempotencyKey: string
  readonly approved: TPayload
}

export interface ApprovalProviderPort<TPayload = unknown> {
  /** 게이트의 `providerReady` 판단 근거. 런타임에 재평가한다. */
  readonly availability: ProviderAvailability
  send: (input: ProviderSendInput<TPayload>) => Promise<ProviderOutcome>
  /** 해당 실행의 provider 식별자/수신자/내용에 바인딩된 독립 조회. */
  readback: (input: ProviderReadbackInput) => Promise<ProviderReadback>
}

/**
 * 기본 Provider — 연결 전 fail-closed.
 *
 * `send`는 전송을 시도하지 않고 실패한다. `{ kind: 'accepted' }`를 절대 만들어 내지 않으며,
 * 게이트가 먼저 `PROVIDER_NOT_READY`로 막는다. `readback`도 근거 없이 `verified`를
 * 반환하지 않는다.
 */
export const UNAVAILABLE_APPROVAL_PROVIDER: ApprovalProviderPort = {
  availability: 'UNAVAILABLE',
  send: async () => {
    throw new Error('PROVIDER_UNAVAILABLE')
  },
  readback: async () => 'unknown',
}

/** 게이트 팩트의 `providerReady`는 Provider 가용성에서만 파생된다. */
export function providerReadyForGate(provider: ApprovalProviderPort): boolean {
  return provider.availability === 'READY'
}

/** 바인딩을 잃지 않았는지 확인하기 위한 좁은 타입. 실행 포트는 이 바인딩의 클로저여야 한다. */
export type BoundExecutePorts = {
  readonly binding: ApprovalPortBinding
  readonly ports: ExecutePorts
}
