import { describe, expect, it, vi } from 'vitest'
import { createMetaWebhookEventStore } from './event-store'
import type { NormalizedMetaEvent } from './handler'

const WS = 'ws-1'
const CONN = 'conn-1'

function gateway(extra: Record<string, unknown> = {}) {
  return {
    findConnection: vi.fn().mockResolvedValue({ data: { id: CONN, workspace_id: WS }, error: null }),
    insertEvent: vi.fn().mockResolvedValue({ data: { id: 'evt-1' }, error: null }),
    updateHealth: vi.fn().mockResolvedValue({ data: {}, error: null }),
    insertResponseJob: vi.fn().mockResolvedValue({ data: {}, error: null }),
    recordCustomerConversation: vi.fn().mockResolvedValue({ data: {}, error: null }),
    recordDmMessage: vi.fn().mockResolvedValue(undefined),
    ...extra,
  }
}

const dmEvent = (payload: Record<string, unknown>, over: Partial<NormalizedMetaEvent> = {}): NormalizedMetaEvent => ({
  eventKey: 'instagram:dm:mid-1',
  provider: 'instagram',
  category: 'dm',
  providerEventId: 'mid-1',
  instagramAccountId: 'biz-1',
  externalAccountId: 'biz-1',
  externalSubjectId: 'cust-1',
  providerPostReference: null,
  occurredAt: '2026-10-10T01:00:00.000Z',
  payload: { id: 'mid-1', text: '안녕', targetId: null, recipientId: 'biz-1', isEcho: false, isSelf: false, isDeleted: false, ...payload },
  payloadSha256: 'a'.repeat(64),
  ...over,
})

describe('event store DM handling', () => {
  it('keeps the legacy flow for a customer DM and also forwards it to the engagement sink', async () => {
    const gw = gateway()
    const store = await createMetaWebhookEventStore(gw as any)
    await store.record([dmEvent({})])
    expect(gw.insertEvent).toHaveBeenCalledTimes(1)
    expect(gw.insertResponseJob).toHaveBeenCalledTimes(1)
    expect(gw.recordDmMessage).toHaveBeenCalledWith({
      workspaceId: WS, channelConnectionId: CONN, event: expect.objectContaining({ providerEventId: 'mid-1' }),
    })
  })

  it('does NOT create a legacy event or response job for an echo, but still forwards it to the sink', async () => {
    const gw = gateway()
    const store = await createMetaWebhookEventStore(gw as any)
    await store.record([dmEvent({ isEcho: true, recipientId: 'cust-1' })])
    expect(gw.insertEvent).not.toHaveBeenCalled()
    expect(gw.insertResponseJob).not.toHaveBeenCalled()
    expect(gw.recordCustomerConversation).not.toHaveBeenCalled()
    expect(gw.recordDmMessage).toHaveBeenCalledTimes(1)
  })

  it('drops self-test and deleted DMs entirely', async () => {
    const gw = gateway()
    const store = await createMetaWebhookEventStore(gw as any)
    await store.record([dmEvent({ isSelf: true }), dmEvent({ isDeleted: true }, { eventKey: 'instagram:dm:mid-2', providerEventId: 'mid-2' })])
    expect(gw.insertEvent).not.toHaveBeenCalled()
    expect(gw.recordDmMessage).not.toHaveBeenCalled()
  })

  it('does not fail the webhook when the sink throws', async () => {
    const gw = gateway({ recordDmMessage: vi.fn().mockRejectedValue(new Error('sink down')) })
    const store = await createMetaWebhookEventStore(gw as any)
    await expect(store.record([dmEvent({})])).resolves.toBeUndefined()
    expect(gw.insertEvent).toHaveBeenCalledTimes(1)
  })

  it('동일 DM 이벤트 동시 3회는 CRM·응대 job 각 1회', async () => {
    let inserted = false
    const gw = gateway({ insertEvent: vi.fn().mockImplementation(async () => {
      if (inserted) return { data: null, error: null }
      inserted = true
      return { data: { id: 'evt-1' }, error: null }
    }) })
    const store = await createMetaWebhookEventStore(gw as any)
    await Promise.all(Array.from({ length: 3 }, () => store.record([dmEvent({})])))
    expect(gw.recordCustomerConversation).toHaveBeenCalledTimes(1)
    expect(gw.insertResponseJob).toHaveBeenCalledTimes(1)
    // Idempotent message sink is still replayed to recover partial ingestion.
    expect(gw.recordDmMessage).toHaveBeenCalledTimes(3)
  })

  it('다른 사업장 recipient를 연결 계정으로 치환하지 않는다', async () => {
    const gw = gateway()
    const store = await createMetaWebhookEventStore(gw as any)
    await store.record([dmEvent({ recipientId: 'biz-other' })])
    expect(gw.insertEvent).not.toHaveBeenCalled()
    expect(gw.recordDmMessage).not.toHaveBeenCalled()
    expect(gw.recordCustomerConversation).not.toHaveBeenCalled()
  })

  it('does not call the sink for comments', async () => {
    const gw = gateway()
    const store = await createMetaWebhookEventStore(gw as any)
    await store.record([{ ...dmEvent({}), category: 'comment', eventKey: 'instagram:comment:c1', payload: { id: 'c1', text: 'hi', targetId: 'p1' } }])
    expect(gw.recordDmMessage).not.toHaveBeenCalled()
  })
})
