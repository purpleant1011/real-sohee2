import { buildChatContext } from '@/features/chat/chat-context'
import type { ChatAction, ChatContext, ChatResourceKind } from '@/features/chat/types'
import { sanitizeNotificationBody } from '@/features/notifications/safe-notification-body'
import {
  CHAT_MOCK_NOTICE,
  type ChatProviderErrorCode,
  type ChatProviderResult,
  type ChatSimulation,
  type MockChatProvider,
} from './chat-provider'

const GENERAL_REPLACEMENT = '관련 작업의 처리 상태를 확인해 주세요.'
const PUBLISH_REPLACEMENT = '게시 처리 상태를 확인해 주세요.'
const invalidInput = Symbol('invalidMockChatProviderInput')

type InputSnapshot = {
  message: unknown
  context: unknown
  simulation: unknown
}

type ContextSnapshot = {
  route: unknown
  selectedResource: unknown
}

function isSimulation(value: unknown): value is ChatSimulation {
  return value === 'success' || value === 'temporary_failure' || value === 'cancelled'
}

function snapshotInput(input: unknown): InputSnapshot | typeof invalidInput {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return invalidInput
    }

    const keys = Reflect.ownKeys(input)
    let hasMessage = false
    let hasContext = false
    let hasSimulation = false

    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]

      if (key === 'message') hasMessage = true
      else if (key === 'context') hasContext = true
      else if (key === 'simulation') hasSimulation = true
      else return invalidInput
    }

    if (!hasMessage || !hasContext || !hasSimulation) return invalidInput

    const snapshot = Object.create(null) as InputSnapshot
    snapshot.message = Reflect.get(input, 'message')
    snapshot.context = Reflect.get(input, 'context')
    snapshot.simulation = Reflect.get(input, 'simulation')
    return snapshot
  } catch {
    return invalidInput
  }
}

function snapshotContext(input: unknown): ContextSnapshot | typeof invalidInput {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return invalidInput
    }

    const keys = Reflect.ownKeys(input)
    let hasRoute = false
    let hasSelectedResource = false

    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]

      if (key === 'route') hasRoute = true
      else if (key === 'selectedResource') hasSelectedResource = true
      else return invalidInput
    }

    if (!hasRoute || !hasSelectedResource) return invalidInput

    const snapshot = Object.create(null) as ContextSnapshot
    snapshot.route = Reflect.get(input, 'route')
    snapshot.selectedResource = Reflect.get(input, 'selectedResource')
    return snapshot
  } catch {
    return invalidInput
  }
}

function safeMessage(input: unknown): boolean {
  if (typeof input !== 'string') return false

  const sanitized = sanitizeNotificationBody(input)
  return (
    sanitized.length > 0 &&
    sanitized.length <= 500 &&
    sanitized !== GENERAL_REPLACEMENT &&
    sanitized !== PUBLISH_REPLACEMENT
  )
}

function normalizedInput(input: unknown):
  | Readonly<{ context: ChatContext; simulation: ChatSimulation }>
  | typeof invalidInput {
  const inputSnapshot = snapshotInput(input)

  if (
    inputSnapshot === invalidInput ||
    !safeMessage(inputSnapshot.message) ||
    !isSimulation(inputSnapshot.simulation)
  ) {
    return invalidInput
  }

  const contextSnapshot = snapshotContext(inputSnapshot.context)
  if (contextSnapshot === invalidInput) return invalidInput

  return Object.freeze({
    context: buildChatContext(contextSnapshot.route, contextSnapshot.selectedResource),
    simulation: inputSnapshot.simulation,
  })
}

function frozenActions(actions: ChatAction[]): readonly ChatAction[] {
  const frozen = new Array<ChatAction>(actions.length)

  for (let index = 0; index < actions.length; index += 1) {
    frozen[index] = Object.freeze(actions[index])
  }

  return Object.freeze(frozen)
}

function result(
  status: ChatProviderResult['status'],
  message: string,
  errorCode: ChatProviderErrorCode | null,
  actions: ChatAction[],
): ChatProviderResult {
  return Object.freeze({
    status,
    mode: 'mock',
    notice: CHAT_MOCK_NOTICE,
    message,
    errorCode,
    actions: frozenActions(actions),
  })
}

function invalidResult(): ChatProviderResult {
  return result(
    'failed',
    '요청 내용을 안전하게 확인할 수 없습니다. 다시 입력해 주세요.',
    'INVALID_INPUT',
    [],
  )
}

function reviewAction(kind: ChatResourceKind, id: string): ChatAction {
  switch (kind) {
    case 'content':
      return {
        label: '콘텐츠 검토 화면 열기',
        href: `/app/work/${id}`,
        requiresConfirmation: true,
      }
    case 'schedule':
      return {
        label: '일정 확인 화면 열기',
        href: `/app/schedule?item=${id}`,
        requiresConfirmation: true,
      }
    case 'notification':
      return {
        label: '알림 확인 화면 열기',
        href: `/app/notifications?item=${id}`,
        requiresConfirmation: true,
      }
    case 'knowledge':
      return {
        label: '지식 확인 화면 열기',
        href: `/app/account/knowledge?item=${id}`,
        requiresConfirmation: true,
      }
    case 'automation':
      return {
        label: '자동화 확인 화면 열기',
        href: `/app/account/automation?item=${id}`,
        requiresConfirmation: true,
      }
  }
}

function resourceLabel(kind: ChatResourceKind): string {
  switch (kind) {
    case 'content':
      return '콘텐츠'
    case 'schedule':
      return '일정'
    case 'notification':
      return '알림'
    case 'knowledge':
      return '지식'
    case 'automation':
      return '자동화'
  }
}

function successResult(context: ChatContext): ChatProviderResult {
  const selectedResource = context.selectedResource

  if (selectedResource === null) {
    return result(
      'success',
      '현재 화면을 기준으로 확인할 항목을 정리했습니다. 실행 전 최종 확인해 주세요.',
      null,
      [
        {
          label: '현재 화면 확인하기',
          href: context.route,
          requiresConfirmation: true,
        },
      ],
    )
  }

  return result(
    'success',
    `선택한 ${resourceLabel(selectedResource.kind)}의 현재 상태를 검토했습니다. 관련 화면에서 최종 확인해 주세요.`,
    null,
    [reviewAction(selectedResource.kind, selectedResource.id)],
  )
}

export const mockChatProvider: MockChatProvider = {
  mode: 'mock',
  async reply(rawInput: unknown): Promise<ChatProviderResult> {
    const input = normalizedInput(rawInput)

    if (input === invalidInput) return invalidResult()

    switch (input.simulation) {
      case 'success':
        return successResult(input.context)
      case 'temporary_failure':
        return result(
          'failed',
          '모의 답변을 준비하지 못했습니다. 다시 시도해 주세요.',
          'MOCK_TEMPORARY_FAILURE',
          [],
        )
      case 'cancelled':
        return result(
          'cancelled',
          '요청을 취소했습니다. 실행된 작업은 없습니다.',
          null,
          [],
        )
    }
  },
}
