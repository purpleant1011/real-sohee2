import { describe, expect, it } from 'vitest'
import { dmInputFromWebhookEvent } from './webhook-adapter'

const base = {
  eventKey: 'instagram:dm:mid-1',
  provider: 'instagram' as const,
  category: 'dm' as const,
  providerEventId: 'mid-1',
  instagramAccountId: 'biz-1',
  externalAccountId: 'biz-1',
  providerPostReference: null,
  occurredAt: '2026-10-10T01:00:00.000Z',
  payloadSha256: 'a'.repeat(64),
}

describe('dmInputFromWebhookEvent', () => {
  it('maps a customer message', () => {
    const out = dmInputFromWebhookEvent(
      { ...base, externalSubjectId: 'cust-1', payload: { id: 'mid-1', text: '안녕', targetId: null, recipientId: 'biz-1', isEcho: false, isSelf: false, isDeleted: false } },
      { workspaceId: 'ws', channelConnectionId: 'conn' },
    )
    expect(out).toEqual({
      workspaceId: 'ws', channelConnectionId: 'conn', businessIgId: 'biz-1',
      mid: 'mid-1', fromId: 'cust-1', toId: 'biz-1', text: '안녕',
      createdAt: '2026-10-10T01:00:00.000Z', isEcho: false, isSelf: false, isDeleted: false,
    })
  })

  it('maps an echo so the customer is the recipient', () => {
    const out = dmInputFromWebhookEvent(
      { ...base, externalSubjectId: 'cust-1', payload: { id: 'mid-2', text: '답장', targetId: null, recipientId: 'cust-1', isEcho: true } },
      { workspaceId: 'ws', channelConnectionId: 'conn' },
    )
    expect(out).toMatchObject({ mid: 'mid-1', fromId: 'biz-1', toId: 'cust-1', isEcho: true })
  })

  it.each(['other-business', null, 'cust-1'])('실제 수신자가 연결 계정과 다르면 거부: %s', (recipientId) => {
    expect(dmInputFromWebhookEvent({ ...base, externalSubjectId: 'cust-1',
      payload: { id: 'mid-1', recipientId, isEcho: false } },
    { workspaceId: 'ws', channelConnectionId: 'conn' })).toBeNull()
  })

  it('echo의 대상 고객이 다르면 거부', () => {
    expect(dmInputFromWebhookEvent({ ...base, externalSubjectId: 'cust-1',
      payload: { id: 'mid-1', recipientId: 'cust-2', isEcho: true } },
    { workspaceId: 'ws', channelConnectionId: 'conn' })).toBeNull()
  })

  it('returns null for non-dm events and for dm events without a customer or message id', () => {
    const ctx = { workspaceId: 'ws', channelConnectionId: 'conn' }
    expect(dmInputFromWebhookEvent({ ...base, category: 'comment', externalSubjectId: 'c', payload: {} }, ctx)).toBeNull()
    expect(dmInputFromWebhookEvent({ ...base, externalSubjectId: null, payload: {} }, ctx)).toBeNull()
    expect(dmInputFromWebhookEvent({ ...base, providerEventId: null, externalSubjectId: 'c', payload: {} }, ctx)).toBeNull()
  })
})
