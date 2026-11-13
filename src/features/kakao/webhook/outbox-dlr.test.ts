import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  parseOutboxJobId,
  isOutboxReport,
  applyOutboxReports,
  getOutboxRpcClient,
  setOutboxRpcClient,
  type OutboxRpcClient,
} from './outbox-dlr'
import type { SolapiReport } from './solapi-dlr'

describe('parseOutboxJobId', () => {
  it('parses valid kakao-outbox:<uuid> format to normalized lowercase uuid', () => {
    const uuid = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d'
    expect(parseOutboxJobId(`kakao-outbox:${uuid}`)).toBe(uuid)
    expect(parseOutboxJobId(`kakao-outbox:${uuid.toUpperCase()}`)).toBe(uuid)
    expect(parseOutboxJobId(`  kakao-outbox:${uuid}  `)).toBe(uuid)
  })

  it('rejects malformed UUIDs and returns null', () => {
    expect(parseOutboxJobId('kakao-outbox:not-a-uuid')).toBeNull()
    expect(parseOutboxJobId('kakao-outbox:12345')).toBeNull()
    expect(parseOutboxJobId('kakao-outbox:a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6g')).toBeNull() // invalid hex 'g'
    expect(parseOutboxJobId('kakao-outbox:')).toBeNull()
  })

  it('rejects legacy idempotency keys and returns null', () => {
    expect(parseOutboxJobId('idem-1')).toBeNull()
    expect(parseOutboxJobId('key-abc-123')).toBeNull()
    expect(parseOutboxJobId('solapi:job-1')).toBeNull()
    expect(parseOutboxJobId(undefined)).toBeNull()
    expect(parseOutboxJobId(null)).toBeNull()
    expect(parseOutboxJobId('')).toBeNull()
  })
})

describe('isOutboxReport', () => {
  it('identifies reports with kakao-outbox correlation key', () => {
    const outboxReport: SolapiReport = {
      messageId: 'msg-1',
      status: 'DELIVERED',
      customFields: {
        idempotencyKey: 'kakao-outbox:a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
      },
    }
    expect(isOutboxReport(outboxReport)).toBe(true)

    const legacyReport: SolapiReport = {
      messageId: 'msg-2',
      status: 'DELIVERED',
      customFields: {
        idempotencyKey: 'legacy-key-1',
      },
    }
    expect(isOutboxReport(legacyReport)).toBe(false)

    const noKeyReport: SolapiReport = {
      messageId: 'msg-3',
      status: 'DELIVERED',
    }
    expect(isOutboxReport(noKeyReport)).toBe(false)
  })
})

describe('applyOutboxReports', () => {
  beforeEach(() => {
    setOutboxRpcClient(null)
  })

  it('manages active outbox client via get/set holder', () => {
    expect(getOutboxRpcClient()).toBeNull()
    const mockClient: OutboxRpcClient = { rpc: vi.fn() }
    setOutboxRpcClient(mockClient)
    expect(getOutboxRpcClient()).toBe(mockClient)
    setOutboxRpcClient(null)
    expect(getOutboxRpcClient()).toBeNull()
  })

  it('calls record_kakao_outbox_delivery for DELIVERED and FAILED reports', async () => {
    const calls: Array<{ fn: string; params: unknown }> = []
    const mockClient: OutboxRpcClient = {
      rpc: vi.fn().mockImplementation(async (fn, params) => {
        calls.push({ fn, params })
        return { data: true, error: null }
      }),
    }

    const validUuid = '11111111-2222-3333-4444-555555555555'
    const reports: SolapiReport[] = [
      {
        messageId: 'solapi-msg-1',
        statusCode: '4000',
        status: 'DELIVERED',
        customFields: {
          idempotencyKey: `kakao-outbox:${validUuid}`,
        },
      },
      {
        messageId: 'solapi-msg-2',
        statusCode: '5000',
        status: 'FAILED',
        customFields: {
          idempotencyKey: `kakao-outbox:${validUuid}`,
        },
      },
    ]

    const result = await applyOutboxReports(reports, mockClient)
    expect(result.total).toBe(2)
    expect(result.applied).toBe(2)
    expect(result.ignored).toBe(0)

    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual({
      fn: 'record_kakao_outbox_delivery',
      params: {
        p_job_id: validUuid,
        p_message_id: 'solapi-msg-1',
        p_status: 'DELIVERED',
        p_status_code: '4000',
      },
    })
    expect(calls[1]).toEqual({
      fn: 'record_kakao_outbox_delivery',
      params: {
        p_job_id: validUuid,
        p_message_id: 'solapi-msg-2',
        p_status: 'FAILED',
        p_status_code: '5000',
      },
    })
  })

  it('ignores UNKNOWN status reports without invoking RPC', async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: true, error: null })
    const mockClient: OutboxRpcClient = { rpc: rpcMock }

    const reports: SolapiReport[] = [
      {
        messageId: 'solapi-msg-unknown',
        statusCode: '3000',
        status: 'UNKNOWN',
        customFields: {
          idempotencyKey: 'kakao-outbox:11111111-2222-3333-4444-555555555555',
        },
      },
    ]

    const result = await applyOutboxReports(reports, mockClient)
    expect(result.total).toBe(1)
    expect(result.applied).toBe(0)
    expect(result.ignored).toBe(1)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('ignores legacy reports or malformed UUID reports', async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: true, error: null })
    const mockClient: OutboxRpcClient = { rpc: rpcMock }

    const reports: SolapiReport[] = [
      {
        messageId: 'msg-legacy',
        status: 'DELIVERED',
        customFields: { idempotencyKey: 'legacy-idem-1' },
      },
      {
        messageId: 'msg-malformed',
        status: 'DELIVERED',
        customFields: { idempotencyKey: 'kakao-outbox:not-uuid' },
      },
    ]

    const result = await applyOutboxReports(reports, mockClient)
    expect(result.total).toBe(2)
    expect(result.applied).toBe(0)
    expect(result.ignored).toBe(2)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('marks as ignored when RPC returns false (idempotent / noop / conflict)', async () => {
    const mockClient: OutboxRpcClient = {
      rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
    }

    const reports: SolapiReport[] = [
      {
        messageId: 'msg-duplicate',
        statusCode: '4000',
        status: 'DELIVERED',
        customFields: {
          idempotencyKey: 'kakao-outbox:11111111-2222-3333-4444-555555555555',
        },
      },
    ]

    const result = await applyOutboxReports(reports, mockClient)
    expect(result.total).toBe(1)
    expect(result.applied).toBe(0)
    expect(result.ignored).toBe(1)
  })

  it('throws static error when RPC returns an error so route can retry with 500', async () => {
    const mockClient: OutboxRpcClient = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Database connection failed' },
      }),
    }

    const reports: SolapiReport[] = [
      {
        messageId: 'msg-err',
        status: 'DELIVERED',
        customFields: {
          idempotencyKey: 'kakao-outbox:11111111-2222-3333-4444-555555555555',
        },
      },
    ]

    await expect(applyOutboxReports(reports, mockClient)).rejects.toThrow(
      'Failed to record kakao outbox delivery',
    )
  })
})

describe('Outbox DLR RPC Contract & In-Memory SQL Simulator (DB 0 tests)', () => {
  interface SimulatedOutboxRow {
    id: string
    status: 'READY' | 'CLAIMED' | 'SENDING' | 'SENT' | 'UNKNOWN' | 'BLOCKED' | 'SUPERSEDED' | 'FAILED'
    delivery_status: 'DELIVERED' | 'FAILED' | null
    provider_message_id: string | null
    delivery_status_code: string | null
    delivered_at: string | null
    updated_at: string
  }

  class SimulatedOutboxDb {
    rows: Map<string, SimulatedOutboxRow> = new Map()

    insert(row: SimulatedOutboxRow) {
      this.rows.set(row.id, { ...row })
    }

    /**
     * Exact simulation of record_kakao_outbox_delivery SQL function.
     */
    record_kakao_outbox_delivery(
      p_job_id: string,
      p_message_id: string | null,
      p_status: string,
      p_status_code: string | null,
      nowIso = '2026-11-06T12:00:00.000Z',
    ): boolean {
      if (!p_job_id || !p_status || (p_status !== 'DELIVERED' && p_status !== 'FAILED')) {
        return false
      }

      // Check provider_message_id unique conflict across different jobs
      if (p_message_id) {
        for (const [id, r] of this.rows.entries()) {
          if (id !== p_job_id && r.provider_message_id === p_message_id) {
            return false // Unique conflict with another job
          }
        }
      }

      const row = this.rows.get(p_job_id)
      if (!row) {
        return false
      }

      // Only match jobs in SENDING, SENT, UNKNOWN status
      if (!['SENDING', 'SENT', 'UNKNOWN'].includes(row.status)) {
        return false
      }

      // MessageId conflict check on same job
      if (row.provider_message_id && p_message_id && row.provider_message_id !== p_message_id) {
        return false
      }

      // Transition rules:
      // 1. delivery_status is null -> can update to any valid p_status
      // 2. delivery_status is FAILED and p_status is DELIVERED -> can upgrade
      // 3. delivery_status is DELIVERED -> terminal, late FAILED is ignored (false)
      // 4. Same delivery_status and same messageId -> idempotent false
      let canUpdate = false
      if (row.delivery_status === null) {
        canUpdate = true
      } else if (row.delivery_status === 'FAILED' && p_status === 'DELIVERED') {
        canUpdate = true
      } else {
        // Late failed or duplicate
        canUpdate = false
      }

      if (!canUpdate) {
        return false
      }

      // Apply update
      row.delivery_status = p_status as 'DELIVERED' | 'FAILED'
      row.provider_message_id = p_message_id ?? row.provider_message_id
      row.delivery_status_code = p_status_code
      if (p_status === 'DELIVERED') {
        row.delivered_at = row.delivered_at ?? nowIso
      }
      row.updated_at = nowIso
      return true
    }
  }

  let db: SimulatedOutboxDb

  beforeEach(() => {
    db = new SimulatedOutboxDb()
  })

  it('rejects delivery updates for jobs in READY or CLAIMED status', () => {
    db.insert({
      id: 'job-ready',
      status: 'READY',
      delivery_status: null,
      provider_message_id: null,
      delivery_status_code: null,
      delivered_at: null,
      updated_at: '2026-11-06T00:00:00.000Z',
    })

    const res = db.record_kakao_outbox_delivery('job-ready', 'msg-1', 'DELIVERED', '4000')
    expect(res).toBe(false)
    expect(db.rows.get('job-ready')?.delivery_status).toBeNull()
  })

  it('applies early DLR for jobs in SENDING status', () => {
    db.insert({
      id: 'job-sending',
      status: 'SENDING',
      delivery_status: null,
      provider_message_id: null,
      delivery_status_code: null,
      delivered_at: null,
      updated_at: '2026-11-06T00:00:00.000Z',
    })

    const res = db.record_kakao_outbox_delivery('job-sending', 'msg-early', 'DELIVERED', '4000')
    expect(res).toBe(true)
    const row = db.rows.get('job-sending')!
    expect(row.delivery_status).toBe('DELIVERED')
    expect(row.provider_message_id).toBe('msg-early')
    expect(row.delivered_at).toBe('2026-11-06T12:00:00.000Z')
    // outbox.status is NOT changed
    expect(row.status).toBe('SENDING')
  })

  it('applies DLR for jobs in SENT and UNKNOWN status', () => {
    db.insert({
      id: 'job-sent',
      status: 'SENT',
      delivery_status: null,
      provider_message_id: null,
      delivery_status_code: null,
      delivered_at: null,
      updated_at: '2026-11-06T00:00:00.000Z',
    })

    expect(db.record_kakao_outbox_delivery('job-sent', 'msg-sent', 'DELIVERED', '4000')).toBe(true)
    expect(db.rows.get('job-sent')?.delivery_status).toBe('DELIVERED')

    db.insert({
      id: 'job-unknown',
      status: 'UNKNOWN',
      delivery_status: null,
      provider_message_id: null,
      delivery_status_code: null,
      delivered_at: null,
      updated_at: '2026-11-06T00:00:00.000Z',
    })

    expect(db.record_kakao_outbox_delivery('job-unknown', 'msg-unk', 'FAILED', '5000')).toBe(true)
    expect(db.rows.get('job-unknown')?.delivery_status).toBe('FAILED')
  })

  it('terminal DELIVERED: rejects late FAILED (no regression) and returns false', () => {
    db.insert({
      id: 'job-delivered',
      status: 'SENT',
      delivery_status: 'DELIVERED',
      provider_message_id: 'msg-1',
      delivery_status_code: '4000',
      delivered_at: '2026-11-06T00:00:00.000Z',
      updated_at: '2026-11-06T00:00:00.000Z',
    })

    const res = db.record_kakao_outbox_delivery('job-delivered', 'msg-1', 'FAILED', '5000')
    expect(res).toBe(false)
    expect(db.rows.get('job-delivered')?.delivery_status).toBe('DELIVERED')
  })

  it('allows upgrade from FAILED to DELIVERED', () => {
    db.insert({
      id: 'job-failed',
      status: 'SENT',
      delivery_status: 'FAILED',
      provider_message_id: 'msg-1',
      delivery_status_code: '5000',
      delivered_at: null,
      updated_at: '2026-11-06T00:00:00.000Z',
    })

    const res = db.record_kakao_outbox_delivery('job-failed', 'msg-1', 'DELIVERED', '4000')
    expect(res).toBe(true)
    const row = db.rows.get('job-failed')!
    expect(row.delivery_status).toBe('DELIVERED')
    expect(row.delivered_at).toBe('2026-11-06T12:00:00.000Z')
  })

  it('returns idempotent false on duplicate delivery reports', () => {
    db.insert({
      id: 'job-dup',
      status: 'SENT',
      delivery_status: 'DELIVERED',
      provider_message_id: 'msg-1',
      delivery_status_code: '4000',
      delivered_at: '2026-11-06T00:00:00.000Z',
      updated_at: '2026-11-06T00:00:00.000Z',
    })

    const res = db.record_kakao_outbox_delivery('job-dup', 'msg-1', 'DELIVERED', '4000')
    expect(res).toBe(false)
  })

  it('rejects provider_message_id collision across different jobs', () => {
    db.insert({
      id: 'job-alpha',
      status: 'SENT',
      delivery_status: 'DELIVERED',
      provider_message_id: 'msg-claimed-by-alpha',
      delivery_status_code: '4000',
      delivered_at: '2026-11-06T00:00:00.000Z',
      updated_at: '2026-11-06T00:00:00.000Z',
    })

    db.insert({
      id: 'job-beta',
      status: 'SENT',
      delivery_status: null,
      provider_message_id: null,
      delivery_status_code: null,
      delivered_at: null,
      updated_at: '2026-11-06T00:00:00.000Z',
    })

    // job-beta tries to register msg-claimed-by-alpha
    const res = db.record_kakao_outbox_delivery('job-beta', 'msg-claimed-by-alpha', 'DELIVERED', '4000')
    expect(res).toBe(false)
    expect(db.rows.get('job-beta')?.delivery_status).toBeNull()
  })
})
