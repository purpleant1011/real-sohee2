import { describe, expect, it, vi } from 'vitest'
import { listChannelInteractions } from './interaction-repository'

describe('channel interaction repository', () => {
  it('maps inbound, approved response, delivery, content version, and schedule without subject IDs', async () => {
    const workspaceId = '10000000-0000-4000-8000-000000000001'
    const rpc = vi.fn(async () => ({ data: [{
      event_id: '20000000-0000-4000-8000-000000000001',
      provider: 'instagram', category: 'dm', occurred_at: '2026-08-13T08:00:00.000Z',
      inbound_text: '예약 가능한가요?', response_job_id: '30000000-0000-4000-8000-000000000001',
      response_kind: 'instagram_dm', response_text: '네, 가능합니다.', response_status: 'approved',
      response_approved_at: '2026-08-13T08:01:00.000Z', response_provider_reference: null,
      delivery_status: null, delivery_error_code: null,
      content_id: null, content_version_id: null, content_title: null,
      schedule_id: '40000000-0000-4000-8000-000000000001',
      publish_at: '2026-08-14T06:00:00.000Z', schedule_status: 'scheduled',
    }], error: null }))

    const result = await listChannelInteractions(workspaceId, { rpc })

    expect(result.data?.[0]).toEqual(expect.objectContaining({
      channel: 'instagram', inboundText: '예약 가능한가요?', responseStatus: 'approved',
      schedule: expect.objectContaining({ status: 'scheduled' }),
    }))
    expect(JSON.stringify(result)).not.toContain('external_subject')
  })
})
