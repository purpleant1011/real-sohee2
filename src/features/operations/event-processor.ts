import { operationEventSchema, type OperationEvent } from './event-schema'

export type ProcessedOperationEvent = Readonly<{
  eventKey: string
  threadId: string
  messageId: string
  workItemId: string
  notificationIds: readonly string[]
  unreadCount: number
}>

export type OperationEventGateway = Readonly<{
  getProcessedResult: (event: OperationEvent) => Promise<ProcessedOperationEvent | null>
  ensureConversationThread: (input: {
    workspaceId: string
    eventKey: string
  }) => Promise<string>
  ensureSystemReport: (input: {
    event: Extract<OperationEvent, { type: 'publish.failed' }>
    threadId: string
    content: string
  }) => Promise<string>
  ensureRecoveryWork: (input: {
    event: Extract<OperationEvent, { type: 'publish.failed' }>
    threadId: string
    messageId: string
  }) => Promise<string>
  ensureNotifications: (input: {
    event: Extract<OperationEvent, { type: 'publish.failed' }>
    messageId: string
    workItemId: string
    href: string
    body: string
  }) => Promise<readonly string[]>
  countUnreadNotifications: (workspaceId: string) => Promise<number>
  saveProcessedResult: (event: OperationEvent, result: ProcessedOperationEvent) => Promise<void>
}>

export async function processOperationEvent(
  rawEvent: unknown,
  gateway: OperationEventGateway,
): Promise<ProcessedOperationEvent> {
  const event = operationEventSchema.parse(rawEvent)
  if (event.type !== 'publish.failed') throw new Error('operation_event_not_supported')

  const existing = await gateway.getProcessedResult(event)
  if (existing) return existing

  const threadId = await gateway.ensureConversationThread({
    workspaceId: event.workspaceId,
    eventKey: event.eventKey,
  })
  const reportContent = [
    '게시 시도가 완료되지 않았어요.',
    `안전 오류 코드: ${event.payload.errorCode}`,
    '외부 채널에 성공했다고 표시하지 않았고, 복구 업무를 준비했습니다.',
    '채널 연결과 승인 버전을 확인한 뒤 다시 시도할지 결정해 주세요.',
  ].join('\n')
  const messageId = await gateway.ensureSystemReport({
    event,
    threadId,
    content: reportContent,
  })
  const workItemId = await gateway.ensureRecoveryWork({
    event,
    threadId,
    messageId,
  })
  const href = `/app/conversations/${threadId}?message=${messageId}`
  const notificationIds = await gateway.ensureNotifications({
    event,
    messageId,
    workItemId,
    href,
    body: '게시 실패를 확인하고 복구 업무를 준비했어요.',
  })
  const unreadCount = await gateway.countUnreadNotifications(event.workspaceId)
  const result = Object.freeze({
    eventKey: event.eventKey,
    threadId,
    messageId,
    workItemId,
    notificationIds: Object.freeze([...notificationIds]),
    unreadCount,
  })
  await gateway.saveProcessedResult(event, result)
  return result
}
