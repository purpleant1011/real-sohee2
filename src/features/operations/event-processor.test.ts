import { describe, expect, it, vi } from 'vitest'
import type { OperationEvent } from './event-schema'
import { processOperationEvent, type OperationEventGateway } from './event-processor'

const event: OperationEvent = {
  id: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  eventKey: 'publish:attempt-1:failed',
  subjectType: 'publish_attempt',
  subjectId: '33333333-3333-4333-8333-333333333333',
  occurredAt: '2026-08-10T01:00:00.000Z',
  type: 'publish.failed',
  payload: {
    attemptId: '33333333-3333-4333-8333-333333333333',
    contentVersionId: '44444444-4444-4444-8444-444444444444',
    errorCode: 'provider_rejected',
  },
}

describe('processOperationEvent', () => {
  it('creates one report, recovery work, notification set, and unread count idempotently', async () => {
    const result = {
      eventKey: event.eventKey,
      threadId: '55555555-5555-4555-8555-555555555555',
      messageId: '66666666-6666-4666-8666-666666666666',
      workItemId: '77777777-7777-4777-8777-777777777777',
      notificationIds: ['88888888-8888-4888-8888-888888888888'],
      unreadCount: 1,
    } as const
    let stored: typeof result | null = null
    const gateway: OperationEventGateway = {
      getProcessedResult: vi.fn(async () => stored),
      ensureConversationThread: vi.fn(async () => result.threadId),
      ensureSystemReport: vi.fn(async () => result.messageId),
      ensureRecoveryWork: vi.fn(async () => result.workItemId),
      ensureNotifications: vi.fn(async () => result.notificationIds),
      countUnreadNotifications: vi.fn(async () => result.unreadCount),
      saveProcessedResult: vi.fn(async (_event, value) => { stored = value as typeof result }),
    }

    await expect(processOperationEvent(event, gateway)).resolves.toEqual(result)
    await expect(processOperationEvent(event, gateway)).resolves.toEqual(result)

    expect(gateway.ensureSystemReport).toHaveBeenCalledTimes(1)
    expect(gateway.ensureRecoveryWork).toHaveBeenCalledTimes(1)
    expect(gateway.ensureNotifications).toHaveBeenCalledTimes(1)
    expect(gateway.countUnreadNotifications).toHaveBeenCalledTimes(1)
    expect(gateway.saveProcessedResult).toHaveBeenCalledTimes(1)
    expect(gateway.ensureNotifications).toHaveBeenCalledWith(expect.objectContaining({
      href: `/app/conversations/${result.threadId}?message=${result.messageId}`,
    }))
  })

  it('rejects unsupported events without creating side effects', async () => {
    const gateway = {
      getProcessedResult: vi.fn(),
      ensureConversationThread: vi.fn(),
      ensureSystemReport: vi.fn(),
      ensureRecoveryWork: vi.fn(),
      ensureNotifications: vi.fn(),
      countUnreadNotifications: vi.fn(),
      saveProcessedResult: vi.fn(),
    } as unknown as OperationEventGateway

    await expect(processOperationEvent({ ...event, type: 'content.plan.created', payload: { workItemId: event.subjectId } }, gateway)).rejects.toThrow('operation_event_not_supported')
    expect(gateway.ensureSystemReport).not.toHaveBeenCalled()
  })
})
