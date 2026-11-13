import { describe, expect, it } from 'vitest'
import { operationEventSchema, operationEventTypeSchema } from './event-schema'

const baseEvent = {
  id: '10000000-0000-4000-8000-000000000001',
  workspaceId: '20000000-0000-4000-8000-000000000001',
  eventKey: 'content-version:30000000-0000-4000-8000-000000000001:1',
  subjectType: 'content_version',
  subjectId: '30000000-0000-4000-8000-000000000001',
  occurredAt: '2026-08-10T01:00:00.000Z',
} as const

describe('operationEventSchema', () => {
  it('rejects an unknown event type', () => {
    expect(
      operationEventSchema.safeParse({
        ...baseEvent,
        type: 'unknown.event',
        payload: {},
      }).success,
    ).toBe(false)
  })

  it('accepts every approved event name and no extras', () => {
    expect(operationEventTypeSchema.options).toEqual([
      'content.plan.created',
      'content.version.created',
      'content.review.requested',
      'content.approved',
      'content.approval.invalidated',
      'schedule.suggested',
      'schedule.confirmed',
      'publish.succeeded',
      'publish.failed',
      'publish.unknown',
      'report.snapshot.ready',
      'customer.conversation.needs_attention',
      'knowledge.conflict.detected',
      'harness.rule.candidate_created',
    ])
  })

  it('accepts a version event with its minimum typed payload', () => {
    expect(
      operationEventSchema.parse({
        ...baseEvent,
        type: 'content.version.created',
        payload: {
          contentItemId: '40000000-0000-4000-8000-000000000001',
          versionNumber: 1,
        },
      }),
    ).toEqual({
      ...baseEvent,
      type: 'content.version.created',
      payload: {
        contentItemId: '40000000-0000-4000-8000-000000000001',
        versionNumber: 1,
      },
    })
  })

  it('rejects free-form workflow state in an approval invalidation payload', () => {
    expect(
      operationEventSchema.safeParse({
        ...baseEvent,
        type: 'content.approval.invalidated',
        payload: {
          contentItemId: '40000000-0000-4000-8000-000000000001',
          contentVersionId: '30000000-0000-4000-8000-000000000001',
          reasonCode: 'whatever-the-model-said',
        },
      }).success,
    ).toBe(false)
  })

  it('rejects a provider error that is unsafe to persist', () => {
    expect(
      operationEventSchema.safeParse({
        ...baseEvent,
        type: 'publish.failed',
        payload: {
          attemptId: '50000000-0000-4000-8000-000000000001',
          contentVersionId: '30000000-0000-4000-8000-000000000001',
          errorCode: 'Authorization: Bearer private-token',
        },
      }).success,
    ).toBe(false)
  })

  it('accepts an unknown publish result only when reconciliation is required', () => {
    expect(
      operationEventSchema.parse({
        ...baseEvent,
        type: 'publish.unknown',
        payload: {
          attemptId: '50000000-0000-4000-8000-000000000001',
          contentVersionId: '30000000-0000-4000-8000-000000000001',
          errorCode: 'result_unknown',
          recoveryStatus: 'reconcile_required',
        },
      }).type,
    ).toBe('publish.unknown')

    expect(
      operationEventSchema.safeParse({
        ...baseEvent,
        type: 'publish.unknown',
        payload: {
          attemptId: '50000000-0000-4000-8000-000000000001',
          contentVersionId: '30000000-0000-4000-8000-000000000001',
          errorCode: 'result_unknown',
          recoveryStatus: 'retryable',
        },
      }).success,
    ).toBe(false)
  })

  it('rejects unknown payload keys instead of silently storing them', () => {
    expect(
      operationEventSchema.safeParse({
        ...baseEvent,
        type: 'content.version.created',
        payload: {
          contentItemId: '40000000-0000-4000-8000-000000000001',
          versionNumber: 1,
          rawPrompt: 'do not persist this',
        },
      }).success,
    ).toBe(false)
  })

  it('rejects malformed event keys and timestamps', () => {
    expect(
      operationEventSchema.safeParse({
        ...baseEvent,
        eventKey: 'contains spaces',
        occurredAt: 'not-a-date',
        type: 'content.plan.created',
        payload: { workItemId: '60000000-0000-4000-8000-000000000001' },
      }).success,
    ).toBe(false)
  })
})
