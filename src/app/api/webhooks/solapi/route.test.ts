import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { InMemoryLedger } from '@/features/kakao/notify/ledger-port'
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => {
    throw new Error('no supabase in test')
  },
}))

import { POST } from './route'
import { setLedger, getLedger } from '@/features/kakao/webhook/solapi-ledger-holder'
import {
  setOutboxRpcClient,
  getOutboxRpcClient,
} from '@/features/kakao/webhook/outbox-dlr'

describe('POST /api/webhooks/solapi', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    setLedger(null)
    setOutboxRpcClient(null)
  })

  afterEach(() => {
    process.env = originalEnv
    setLedger(null)
    setOutboxRpcClient(null)
  })

  it('returns 503 when SOLAPI_WEBHOOK_SECRET is not configured', async () => {
    delete process.env.SOLAPI_WEBHOOK_SECRET

    const req = new NextRequest('http://localhost:3000/api/webhooks/solapi', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-solapi-secret': 'some-secret',
      },
      body: JSON.stringify([{ messageId: 'm-1', statusCode: '4000' }]),
    })

    const res = await POST(req)
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.code).toBe('WEBHOOK_SECRET_NOT_CONFIGURED')
  })

  it('returns 401 when auth fails (missing or incorrect secret)', async () => {
    process.env.SOLAPI_WEBHOOK_SECRET = 'valid-secret-1234'

    const req = new NextRequest('http://localhost:3000/api/webhooks/solapi', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-solapi-secret': 'wrong-secret',
      },
      body: JSON.stringify([{ messageId: 'm-1', statusCode: '4000' }]),
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.code).toBe('UNAUTHORIZED')
  })

  it('returns 413 when content-length exceeds 1MB', async () => {
    process.env.SOLAPI_WEBHOOK_SECRET = 'valid-secret-1234'

    const req = new NextRequest('http://localhost:3000/api/webhooks/solapi', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-solapi-secret': 'valid-secret-1234',
        'content-length': String(1024 * 1024 + 10),
      },
      body: JSON.stringify([{ messageId: 'm-1' }]),
    })

    const res = await POST(req)
    expect(res.status).toBe(413)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('returns 200 when body is invalid JSON', async () => {
    process.env.SOLAPI_WEBHOOK_SECRET = 'valid-secret-1234'

    const req = new NextRequest('http://localhost:3000/api/webhooks/solapi', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-solapi-secret': 'valid-secret-1234',
      },
      body: '{ not-valid-json',
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.ignored).toBe(0)
    expect(json.applied).toBe(0)
  })

  it('returns 200 when body is empty string or whitespace', async () => {
    process.env.SOLAPI_WEBHOOK_SECRET = 'valid-secret-1234'

    const req = new NextRequest('http://localhost:3000/api/webhooks/solapi', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-solapi-secret': 'valid-secret-1234',
      },
      body: '   ',
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.applied).toBe(0)
    expect(json.ignored).toBe(0)
  })

  it('returns 200 when body is unknown format or unrecognized object', async () => {
    process.env.SOLAPI_WEBHOOK_SECRET = 'valid-secret-1234'

    const req = new NextRequest('http://localhost:3000/api/webhooks/solapi', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-solapi-secret': 'valid-secret-1234',
      },
      body: JSON.stringify({ unknownField: 'some-value', another: 123 }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.applied).toBe(0)
    expect(json.ignored).toBe(0)
  })

  it('returns 200 with notice when ledger is not configured (default state)', async () => {
    process.env.SOLAPI_WEBHOOK_SECRET = 'valid-secret-1234'
    expect(getLedger()).toBeNull()

    const req = new NextRequest('http://localhost:3000/api/webhooks/solapi', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-solapi-secret': 'valid-secret-1234',
      },
      body: JSON.stringify([
        {
          messageId: 'solapi-001',
          statusCode: '4000',
          customFields: { idempotencyKey: 'idem-1' },
        },
      ]),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.applied).toBe(0)
    expect(json.message).toContain('Ledger not configured')
  })

  it('returns 200 and applies status transition when ledger is injected', async () => {
    process.env.SOLAPI_WEBHOOK_SECRET = 'valid-secret-1234'
    const ledger = new InMemoryLedger()
    await ledger.claim(
      {
        idempotencyKey: 'key-abc',
        workspaceId: 'ws-1',
        bookingId: 'b-1',
        event: 'booking.created',
        templateCode: 'TMPL_1',
        phoneLast4: '9999',
      },
      '2026-11-06T00:00:00.000Z',
    )
    await ledger.transition('key-abc', 'SENT', {}, '2026-11-06T00:00:01.000Z')
    setLedger(ledger)

    const req = new NextRequest('http://localhost:3000/api/webhooks/solapi', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-solapi-secret': 'valid-secret-1234',
      },
      body: JSON.stringify([
        {
          messageId: 'msg-id-123',
          statusCode: '4000',
          customFields: { idempotencyKey: 'key-abc' },
        },
      ]),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.applied).toBe(1)

    const record = await ledger.get('key-abc')
    expect(record?.status).toBe('DELIVERED')
    expect(record?.providerMessageId).toBe('msg-id-123')
  })

  it('supports single object payload (not array)', async () => {
    process.env.SOLAPI_WEBHOOK_SECRET = 'valid-secret-1234'
    const ledger = new InMemoryLedger()
    await ledger.claim(
      {
        idempotencyKey: 'key-single',
        workspaceId: 'ws-1',
        bookingId: 'b-single',
        event: 'booking.created',
        templateCode: 'TMPL_1',
        phoneLast4: '1111',
      },
      '2026-11-06T00:00:00.000Z',
    )
    await ledger.transition('key-single', 'SENT', {}, '2026-11-06T00:00:01.000Z')
    setLedger(ledger)

    const req = new NextRequest('http://localhost:3000/api/webhooks/solapi', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-solapi-secret': 'valid-secret-1234',
      },
      body: JSON.stringify({
        messageId: 'msg-single-456',
        statusCode: '4000',
        customFields: { idempotencyKey: 'key-single' },
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.applied).toBe(1)

    const record = await ledger.get('key-single')
    expect(record?.status).toBe('DELIVERED')
  })

  it('returns 500 when actionable outbox reports are present but outbox client is not configured', async () => {
    process.env.SOLAPI_WEBHOOK_SECRET = 'valid-secret-1234'
    expect(getOutboxRpcClient()).toBeNull()

    const req = new NextRequest('http://localhost:3000/api/webhooks/solapi', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-solapi-secret': 'valid-secret-1234',
      },
      body: JSON.stringify([
        {
          messageId: 'outbox-msg-1',
          statusCode: '4000',
          customFields: {
            idempotencyKey: 'kakao-outbox:11111111-2222-3333-4444-555555555555',
          },
        },
      ]),
    })

    const res = await POST(req)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.code).toBe('OUTBOX_ERROR')
  })

  it('returns 200 with ignored count when outbox report has UNKNOWN status even if outbox client is null', async () => {
    process.env.SOLAPI_WEBHOOK_SECRET = 'valid-secret-1234'
    expect(getOutboxRpcClient()).toBeNull()

    const req = new NextRequest('http://localhost:3000/api/webhooks/solapi', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-solapi-secret': 'valid-secret-1234',
      },
      body: JSON.stringify([
        {
          messageId: 'outbox-msg-unk',
          statusCode: '2000',
          customFields: {
            idempotencyKey: 'kakao-outbox:11111111-2222-3333-4444-555555555555',
          },
        },
      ]),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.applied).toBe(0)
    expect(json.ignored).toBe(1)
  })

  it('returns 200 with ignored count when outbox RPC returns false (row not found / conflict)', async () => {
    process.env.SOLAPI_WEBHOOK_SECRET = 'valid-secret-1234'
    const rpcMock = vi.fn().mockResolvedValue({ data: false, error: null })
    setOutboxRpcClient({ rpc: rpcMock })

    const validUuid = '11111111-2222-3333-4444-555555555555'
    const req = new NextRequest('http://localhost:3000/api/webhooks/solapi', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-solapi-secret': 'valid-secret-1234',
      },
      body: JSON.stringify([
        {
          messageId: 'solapi-not-found-01',
          statusCode: '4000',
          customFields: {
            idempotencyKey: `kakao-outbox:${validUuid}`,
          },
        },
      ]),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.applied).toBe(0)
    expect(json.ignored).toBe(1)
    expect(rpcMock).toHaveBeenCalledWith('record_kakao_outbox_delivery', {
      p_job_id: validUuid,
      p_message_id: 'solapi-not-found-01',
      p_status: 'DELIVERED',
      p_status_code: '4000',
    })
  })

  it('returns 200 with ignored count when report is not ours (unrecognized key and no ledger match)', async () => {
    process.env.SOLAPI_WEBHOOK_SECRET = 'valid-secret-1234'
    const ledger = new InMemoryLedger()
    setLedger(ledger)

    const req = new NextRequest('http://localhost:3000/api/webhooks/solapi', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-solapi-secret': 'valid-secret-1234',
      },
      body: JSON.stringify([
        {
          messageId: 'foreign-msg-1',
          statusCode: '4000',
          customFields: { idempotencyKey: 'foreign-service-key-999' },
        },
      ]),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.applied).toBe(0)
    expect(json.ignored).toBe(1)
  })

  it('returns 500 when legacy ledger throws error', async () => {
    process.env.SOLAPI_WEBHOOK_SECRET = 'valid-secret-1234'
    const ledger = new InMemoryLedger()
    vi.spyOn(ledger, 'get').mockRejectedValue(new Error('DB connection lost'))
    setLedger(ledger)

    const req = new NextRequest('http://localhost:3000/api/webhooks/solapi', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-solapi-secret': 'valid-secret-1234',
      },
      body: JSON.stringify([
        {
          messageId: 'legacy-msg-err',
          statusCode: '4000',
          customFields: { idempotencyKey: 'legacy-key-throw' },
        },
      ]),
    })

    const res = await POST(req)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.code).toBe('LEDGER_ERROR')
    expect(json.message).not.toContain('DB connection lost')
  })

  it('returns 200 and applies outbox delivery when client is configured', async () => {
    process.env.SOLAPI_WEBHOOK_SECRET = 'valid-secret-1234'
    const rpcMock = vi.fn().mockResolvedValue({ data: true, error: null })
    setOutboxRpcClient({ rpc: rpcMock })

    const validUuid = '11111111-2222-3333-4444-555555555555'
    const req = new NextRequest('http://localhost:3000/api/webhooks/solapi', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-solapi-secret': 'valid-secret-1234',
      },
      body: JSON.stringify([
        {
          messageId: 'solapi-outbox-01',
          statusCode: '4000',
          customFields: {
            idempotencyKey: `kakao-outbox:${validUuid}`,
          },
        },
      ]),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.applied).toBe(1)
    expect(rpcMock).toHaveBeenCalledWith('record_kakao_outbox_delivery', {
      p_job_id: validUuid,
      p_message_id: 'solapi-outbox-01',
      p_status: 'DELIVERED',
      p_status_code: '4000',
    })
  })

  it('separates legacy and outbox reports in mixed payload', async () => {
    process.env.SOLAPI_WEBHOOK_SECRET = 'valid-secret-1234'

    // Configure outbox client
    const rpcMock = vi.fn().mockResolvedValue({ data: true, error: null })
    setOutboxRpcClient({ rpc: rpcMock })

    // Configure legacy ledger
    const ledger = new InMemoryLedger()
    await ledger.claim(
      {
        idempotencyKey: 'legacy-key-mixed',
        workspaceId: 'ws-1',
        bookingId: 'b-mixed',
        event: 'booking.created',
        templateCode: 'TMPL_1',
        phoneLast4: '9999',
      },
      '2026-11-06T00:00:00.000Z',
    )
    await ledger.transition('legacy-key-mixed', 'SENT', {}, '2026-11-06T00:00:01.000Z')
    setLedger(ledger)

    const validUuid = '22222222-3333-4444-5555-666666666666'
    const req = new NextRequest('http://localhost:3000/api/webhooks/solapi', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-solapi-secret': 'valid-secret-1234',
      },
      body: JSON.stringify([
        {
          messageId: 'legacy-msg-1',
          statusCode: '4000',
          customFields: { idempotencyKey: 'legacy-key-mixed' },
        },
        {
          messageId: 'outbox-msg-1',
          statusCode: '4000',
          customFields: { idempotencyKey: `kakao-outbox:${validUuid}` },
        },
      ]),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.applied).toBe(2)
    expect(json.received).toBe(2)

    // Verify outbox was called
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('record_kakao_outbox_delivery', expect.objectContaining({
      p_job_id: validUuid,
    }))

    // Verify legacy ledger was updated
    const legacyRec = await ledger.get('legacy-key-mixed')
    expect(legacyRec?.status).toBe('DELIVERED')
  })

  it('returns 500 when outbox RPC throws error to trigger Solapi retry', async () => {
    process.env.SOLAPI_WEBHOOK_SECRET = 'valid-secret-1234'
    const rpcMock = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Database timeout' },
    })
    setOutboxRpcClient({ rpc: rpcMock })

    const req = new NextRequest('http://localhost:3000/api/webhooks/solapi', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-solapi-secret': 'valid-secret-1234',
      },
      body: JSON.stringify([
        {
          messageId: 'outbox-msg-err',
          statusCode: '4000',
          customFields: {
            idempotencyKey: 'kakao-outbox:11111111-2222-3333-4444-555555555555',
          },
        },
      ]),
    })

    const res = await POST(req)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.code).toBe('OUTBOX_ERROR')
    // No internal raw error exposure
    expect(json.message).not.toContain('Database timeout')
  })
})
