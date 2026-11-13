import type { ApprovalSnapshot, ExecutePorts, ExecuteRequest, ExecuteStatus, ProviderOutcome } from '../execute'
import type { ApprovalPortBinding, ApprovalProviderPort, ProviderAvailability, ProviderReadback, ProviderReadbackInput, ProviderSendInput } from '../ports'

/**
 * 테스트 전용 모의 Provider — ANI-1704
 *
 * **`testing/` 밖에서 import 금지.** 이 디렉터리는 vitest 전용이며, 운영 번들에 섞이면
 * 모의 상태가 실제 Provider Accepted/Verified처럼 보이는 사고가 난다.
 * `eslint.config.mjs`의 `sohee/no-testing-mocks-in-prod` 규칙이 비테스트 파일의 import를 막는다.
 *
 * 실제 전송/조회를 하지 않으며 DB 원자성·테넌트 격리·영속 원장을 모델링하지 않는다.
 * 따라서 이 모의로 통과한 테스트는 실제 중복 발송 방지나 DB 경합을 검증한 것이 아니다.
 */

export interface MockProviderOptions {
  availability?: ProviderAvailability
  outcome?: ProviderOutcome
  readback?: ProviderReadback
  /** send가 타임아웃처럼 throw하는 상황. execute는 이를 unknown으로 흡수한다. */
  throwsOnSend?: boolean
}

export interface MockProviderCalls {
  send: number
  readback: number
}

export interface MockApprovalProvider {
  provider: ApprovalProviderPort
  calls: MockProviderCalls
  sends: ProviderSendInput[]
  readbacks: ProviderReadbackInput[]
}

export function createMockApprovalProvider(options: MockProviderOptions = {}): MockApprovalProvider {
  const calls: MockProviderCalls = { send: 0, readback: 0 }
  const sends: ProviderSendInput[] = []
  const readbacks: ProviderReadbackInput[] = []
  const provider: ApprovalProviderPort = {
    availability: options.availability ?? 'READY',
    send: async input => {
      calls.send++
      sends.push(input)
      if (options.throwsOnSend) throw new Error('mock provider timeout')
      return options.outcome ?? { kind: 'accepted' }
    },
    readback: async input => {
      calls.readback++
      readbacks.push(input)
      return options.readback ?? 'verified'
    },
  }
  return { provider, calls, sends, readbacks }
}

export interface MockExecutePortsOptions {
  binding: ApprovalPortBinding
  snapshot: ApprovalSnapshot
  provider: ApprovalProviderPort
  now?: () => string
  /** 테스트가 직접 들여다볼 모의 원장. 영속 정본이 아니다. */
  ledger?: Map<string, ExecuteStatus>
}

export interface MockExecutePorts {
  ports: ExecutePorts
  calls: MockProviderCalls
  ledger: Map<string, ExecuteStatus>
}

/**
 * `execute.test.ts` 하네스와 같은 형태(`calls`, `ledger`)의 실행 포트.
 *
 * claim은 **멱등키 단위**로만 원자성을 흉내 낸다. 서로 다른 멱등키가 같은 항목을
 * 동시에 예약하는 경합은 DB 어댑터 책임이며 이 모의로 검증할 수 없다.
 */
export function createMockExecutePorts(options: MockExecutePortsOptions): MockExecutePorts {
  const { binding, snapshot, provider } = options
  const ledger = options.ledger ?? new Map<string, ExecuteStatus>()
  const calls: MockProviderCalls = { send: 0, readback: 0 }
  const ports: ExecutePorts = {
    now: options.now ?? (() => '2026-10-22T00:00:00.000Z'),
    loadSnapshot: async () => snapshot,
    findByKey: async (request: ExecuteRequest) => ledger.get(request.idempotencyKey) ?? null,
    claim: async (request: ExecuteRequest) => {
      const existing = ledger.get(request.idempotencyKey)
      if (existing) return { fresh: false, status: existing }
      ledger.set(request.idempotencyKey, 'REQUESTED')
      return { fresh: true }
    },
    send: async (itemKey, idempotencyKey) => {
      calls.send++
      return provider.send({ workspaceId: binding.workspaceId, itemKey, idempotencyKey, approved: snapshot })
    },
    readback: async itemKey => {
      calls.readback++
      return provider.readback({ workspaceId: binding.workspaceId, itemKey, idempotencyKey: '' })
    },
    record: async (_itemKey, idempotencyKey, status) => {
      ledger.set(idempotencyKey, status)
    },
  }
  return { ports, calls, ledger }
}
