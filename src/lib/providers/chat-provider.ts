import type { ChatAction, ChatContext } from '@/features/chat/types'
import type { MessageArtifact, MessageEvidenceView } from '@/features/chat/stream-events'
import type { SoheeContextBundle } from '@/features/chat/context-builder'
import type { UsageEventInput } from '@/features/credits/usage-event'

export const CHAT_MOCK_NOTICE = '모의 답변 · 실행 전 최종 확인 필요' as const

export type ChatProviderMode = 'openai' | 'mock'
export type ChatSimulation = 'success' | 'temporary_failure' | 'cancelled'
export type ChatProviderErrorCode = 'INVALID_INPUT' | 'MOCK_TEMPORARY_FAILURE'

export type MockChatProviderInput = Readonly<{
  message: string
  context: ChatContext
  simulation: ChatSimulation
}>

export type ChatProviderInput = Readonly<{
  message: string
  context: SoheeContextBundle
  signal?: AbortSignal
}>

export type ChatProviderEvent =
  | Readonly<{ type: 'text.delta'; delta: string }>
  | Readonly<{ type: 'evidence'; evidence: MessageEvidenceView }>
  | Readonly<{ type: 'artifact'; artifact: MessageArtifact }>
  | Readonly<{ type: 'usage'; usage: UsageEventInput }>
  | Readonly<{ type: 'completed' }>

export type ChatProviderResult = Readonly<{
  status: 'success' | 'failed' | 'cancelled'
  mode: ChatProviderMode
  notice: typeof CHAT_MOCK_NOTICE
  message: string
  errorCode: ChatProviderErrorCode | null
  actions: readonly ChatAction[]
}>

export interface MockChatProvider {
  readonly mode: 'mock'
  reply(input: unknown): Promise<ChatProviderResult>
}

export interface ChatProvider {
  readonly mode: ChatProviderMode
  stream(input: ChatProviderInput): AsyncIterable<ChatProviderEvent>
}
