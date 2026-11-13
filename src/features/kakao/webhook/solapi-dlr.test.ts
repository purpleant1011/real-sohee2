import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { InMemoryLedger } from '../notify/ledger-port'
import {
  parseSolapiReport,
  applySolapiReports,
  verifySolapiWebhookAuth,
  type SolapiReport,
} from './solapi-dlr'

describe('Solapi DLR Parser (parseSolapiReport)', () => {
  it('parses single report object with statusCode 4000 as DELIVERED', () => {
    const payload = {
      messageId: 'M4V202212291118233WFNUDAXMX1A001',
      statusCode: '4000',
      statusMessage: '수신 완료',
      customFields: {
        idempotencyKey: 'idemp-001',
        workspaceId: 'ws-1',
      },
    }

    const reports = parseSolapiReport(payload)
    expect(reports).toHaveLength(1)
    expect(reports[0]).toEqual({
      messageId: 'M4V202212291118233WFNUDAXMX1A001',
      statusCode: '4000',
      status: 'DELIVERED',
      customFields: {
        idempotencyKey: 'idemp-001',
        workspaceId: 'ws-1',
      },
    })
  })

  it('parses array of reports with various status codes (4000, 5000, 3000)', () => {
    const payload = [
      {
        messageId: 'msg-success',
        statusCode: '4000',
        customFields: { idempotencyKey: 'k-1' },
      },
      {
        messageId: 'msg-fail',
        statusCode: '5000',
        customFields: { idempotencyKey: 'k-2' },
      },
      {
        messageId: 'msg-pending',
        statusCode: '3000',
        customFields: { idempotencyKey: 'k-3' },
      },
    ]

    const reports = parseSolapiReport(payload)
    expect(reports).toHaveLength(3)
    expect(reports[0]?.status).toBe('DELIVERED')
    expect(reports[1]?.status).toBe('FAILED')
    expect(reports[2]?.status).toBe('UNKNOWN')
  })

  it('recognizes explicit status string (COMPLETE/FAILED) even if statusCode differs', () => {
    const payload = [
      { messageId: 'm-1', status: 'COMPLETE' },
      { messageId: 'm-2', status: 'FAILED' },
    ]

    const reports = parseSolapiReport(payload)
    expect(reports).toHaveLength(2)
    expect(reports[0]?.status).toBe('DELIVERED')
    expect(reports[1]?.status).toBe('FAILED')
  })

  it('ignores invalid forms (null, numbers, strings, empty objects without identifiers)', () => {
    expect(parseSolapiReport(null)).toEqual([])
    expect(parseSolapiReport(undefined)).toEqual([])
    expect(parseSolapiReport('invalid string')).toEqual([])
    expect(parseSolapiReport(123)).toEqual([])
    expect(parseSolapiReport([null, {}, { unrelated: 'foo' }])).toEqual([])
  })
})

describe('Solapi Webhook Auth Verification (verifySolapiWebhookAuth)', () => {
  const secret = 'my-solapi-webhook-secret-12345'
  const sha1Secret = createHash('sha1').update(secret, 'utf8').digest('hex')

  it('accepts X-Solapi-Secret with plaintext secret', () => {
    const headers = new Headers({ 'x-solapi-secret': secret })
    expect(verifySolapiWebhookAuth({ headers, secret })).toBe(true)
  })

  it('accepts X-Solapi-Secret with SHA1 hash (official Solapi specification)', () => {
    const headers = new Headers({ 'x-solapi-secret': sha1Secret })
    expect(verifySolapiWebhookAuth({ headers, secret })).toBe(true)
  })

  it('accepts Authorization Bearer header matching secret', () => {
    const headers = new Headers({ authorization: `Bearer ${secret}` })
    expect(verifySolapiWebhookAuth({ headers, secret })).toBe(true)
  })

  it('accepts query parameter matching secret', () => {
    const headers = new Headers()
    const searchParams = new URLSearchParams({ secret })
    expect(verifySolapiWebhookAuth({ headers, searchParams, secret })).toBe(true)
  })

  it('rejects invalid secret', () => {
    const headers = new Headers({ 'x-solapi-secret': 'wrong-secret' })
    expect(verifySolapiWebhookAuth({ headers, secret })).toBe(false)
  })

  it('rejects when secret is not configured or empty', () => {
    const headers = new Headers({ 'x-solapi-secret': secret })
    expect(verifySolapiWebhookAuth({ headers, secret: '' })).toBe(false)
    expect(verifySolapiWebhookAuth({ headers, secret: null })).toBe(false)
  })
})

describe('Solapi DLR Ledger Application (applySolapiReports)', () => {
  let ledger: InMemoryLedger

  beforeEach(async () => {
    ledger = new InMemoryLedger()
    // Seed records
    await ledger.claim(
      {
        idempotencyKey: 'idem-1',
        workspaceId: 'ws-1',
        bookingId: 'book-1',
        event: 'booking.created',
        templateCode: 'SOL_TMPL_01',
        phoneLast4: '1234',
      },
      '2026-11-06T00:00:00.000Z',
    )
    // Transition to SENT
    await ledger.transition('idem-1', 'SENT', { providerMessageId: 'prov-msg-1' }, '2026-11-06T00:00:01.000Z')

    // Second record: claimed but providerMessageId not set yet (Workers memory loss case)
    await ledger.claim(
      {
        idempotencyKey: 'idem-2',
        workspaceId: 'ws-1',
        bookingId: 'book-2',
        event: 'booking.created',
        templateCode: 'SOL_TMPL_01',
        phoneLast4: '5678',
      },
      '2026-11-06T00:00:00.000Z',
    )
    await ledger.transition('idem-2', 'SENT', {}, '2026-11-06T00:00:01.000Z')
  })

  it('prioritizes customFields.idempotencyKey to transition to DELIVERED and populates providerMessageId', async () => {
    const reports: SolapiReport[] = [
      {
        messageId: 'solapi-msg-new-id',
        statusCode: '4000',
        status: 'DELIVERED',
        customFields: {
          idempotencyKey: 'idem-2',
        },
      },
    ]

    const result = await applySolapiReports(reports, ledger, '2026-11-06T00:01:00.000Z')
    expect(result.applied).toBe(1)
    expect(result.ignored).toBe(0)

    const updated = await ledger.get('idem-2')
    expect(updated?.status).toBe('DELIVERED')
    expect(updated?.providerMessageId).toBe('solapi-msg-new-id')
  })

  it('falls back to providerMessageId when customFields.idempotencyKey is missing', async () => {
    const reports: SolapiReport[] = [
      {
        messageId: 'prov-msg-1',
        statusCode: '4000',
        status: 'DELIVERED',
      },
    ]

    const result = await applySolapiReports(reports, ledger, '2026-11-06T00:01:00.000Z')
    expect(result.applied).toBe(1)
    expect(result.ignored).toBe(0)

    const updated = await ledger.get('idem-1')
    expect(updated?.status).toBe('DELIVERED')
  })

  it('ignores reports that match neither idempotencyKey nor providerMessageId', async () => {
    const reports: SolapiReport[] = [
      {
        messageId: 'unknown-msg-id',
        statusCode: '4000',
        status: 'DELIVERED',
        customFields: {
          idempotencyKey: 'unknown-key',
        },
      },
    ]

    const result = await applySolapiReports(reports, ledger, '2026-11-06T00:01:00.000Z')
    expect(result.applied).toBe(0)
    expect(result.ignored).toBe(1)
  })

  it('is idempotent: transitions DELIVERED -> DELIVERED are safely ignored', async () => {
    // First delivery
    const reports: SolapiReport[] = [
      {
        messageId: 'prov-msg-1',
        statusCode: '4000',
        status: 'DELIVERED',
      },
    ]
    const res1 = await applySolapiReports(reports, ledger, '2026-11-06T00:01:00.000Z')
    expect(res1.applied).toBe(1)

    // Duplicate delivery webhook
    const res2 = await applySolapiReports(reports, ledger, '2026-11-06T00:02:00.000Z')
    expect(res2.applied).toBe(0)
    expect(res2.ignored).toBe(1)

    const record = await ledger.get('idem-1')
    expect(record?.status).toBe('DELIVERED')
  })

  it('transitions to FAILED when status is FAILED and preserves error info', async () => {
    const reports: SolapiReport[] = [
      {
        messageId: 'prov-msg-1',
        statusCode: '5000',
        status: 'FAILED',
      },
    ]

    const result = await applySolapiReports(reports, ledger, '2026-11-06T00:01:00.000Z')
    expect(result.applied).toBe(1)

    const updated = await ledger.get('idem-1')
    expect(updated?.status).toBe('FAILED')
    expect(updated?.error).toContain('5000')
  })

  it('ignores reports with status UNKNOWN without modifying ledger', async () => {
    const reports: SolapiReport[] = [
      {
        messageId: 'prov-msg-1',
        statusCode: '3000',
        status: 'UNKNOWN',
      },
    ]

    const result = await applySolapiReports(reports, ledger, '2026-11-06T00:01:00.000Z')
    expect(result.applied).toBe(0)
    expect(result.ignored).toBe(1)

    const record = await ledger.get('idem-1')
    expect(record?.status).toBe('SENT')
  })
})
