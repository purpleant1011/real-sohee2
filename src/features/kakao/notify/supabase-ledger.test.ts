import { describe, expect, it } from 'vitest'
import { SupabaseAlimtalkLedger } from './supabase-ledger'
import type { LedgerStatus } from './ledger-port'

interface FakeRow {
  idempotency_key: string
  workspace_id: string
  booking_id: string
  event: string
  template_code: string
  phone_last4: string
  status: LedgerStatus
  provider_message_id: string | null
  error: string | null
  created_at: string
  updated_at: string
}

function createFakeSupabaseClient(initialRows: FakeRow[] = []) {
  const rows = new Map<string, FakeRow>()
  for (const r of initialRows) {
    rows.set(r.idempotency_key, { ...r })
  }

  return {
    rows,
    from(tableName: string) {
      if (tableName !== 'kakao_alimtalk_ledger') {
        throw new Error(`Unexpected table: ${tableName}`)
      }

      return {
        upsert(payload: any, options?: { onConflict?: string; ignoreDuplicates?: boolean }) {
          return {
            select() {
              const key = payload.idempotency_key
              if (options?.ignoreDuplicates && rows.has(key)) {
                return Promise.resolve({ data: [], error: null })
              }
              const row: FakeRow = {
                idempotency_key: payload.idempotency_key,
                workspace_id: payload.workspace_id,
                booking_id: payload.booking_id,
                event: payload.event,
                template_code: payload.template_code,
                phone_last4: payload.phone_last4,
                status: payload.status,
                provider_message_id: payload.provider_message_id ?? null,
                error: payload.error ?? null,
                created_at: payload.created_at,
                updated_at: payload.updated_at,
              }
              rows.set(key, row)
              return Promise.resolve({ data: [{ idempotency_key: key }], error: null })
            },
          }
        },

        update(payload: any) {
          let targetKey: string | null = null
          let allowedStatuses: LedgerStatus[] | null = null

          const chain = {
            eq(field: string, value: any) {
              if (field === 'idempotency_key') {
                targetKey = value
              }
              return chain
            },
            in(field: string, values: any[]) {
              if (field === 'status') {
                allowedStatuses = values
              }
              return chain
            },
            select() {
              if (!targetKey) {
                return Promise.resolve({ data: [], error: null })
              }
              const existing = rows.get(targetKey)
              if (!existing) {
                return Promise.resolve({ data: [], error: null })
              }
              if (allowedStatuses && !allowedStatuses.includes(existing.status)) {
                return Promise.resolve({ data: [], error: null })
              }

              const updated: FakeRow = {
                ...existing,
                ...payload,
              }
              rows.set(targetKey, updated)
              return Promise.resolve({ data: [{ idempotency_key: targetKey }], error: null })
            },
          }
          return chain
        },

        select() {
          let filterField: string | null = null
          let filterValue: any = null

          const chain = {
            eq(field: string, value: any) {
              filterField = field
              filterValue = value
              return chain
            },
            maybeSingle() {
              if (!filterField) {
                return Promise.resolve({ data: null, error: null })
              }
              for (const row of rows.values()) {
                if ((row as any)[filterField] === filterValue) {
                  return Promise.resolve({ data: { ...row }, error: null })
                }
              }
              return Promise.resolve({ data: null, error: null })
            },
          }
          return chain
        },
      }
    },
  }
}

describe('SupabaseAlimtalkLedger', () => {
  const baseRecord = {
    idempotencyKey: 'idem-1',
    workspaceId: 'ws-1',
    bookingId: 'book-1',
    event: 'CONFIRMED',
    templateCode: 'TMPL_01',
    phoneLast4: '1234',
  }
  const now = '2026-11-06T00:00:00.000Z'

  describe('claim', () => {
    it('creates a new record with status PENDING and returns true when key does not exist', async () => {
      const client = createFakeSupabaseClient()
      const ledger = new SupabaseAlimtalkLedger(client as any)

      const claimed = await ledger.claim(baseRecord, now)
      expect(claimed).toBe(true)

      const saved = await ledger.get('idem-1')
      expect(saved).toEqual({
        idempotencyKey: 'idem-1',
        workspaceId: 'ws-1',
        bookingId: 'book-1',
        event: 'CONFIRMED',
        templateCode: 'TMPL_01',
        phoneLast4: '1234',
        status: 'PENDING',
        createdAt: now,
        updatedAt: now,
      })
    })

    it('returns false when key already exists (idempotency guard)', async () => {
      const client = createFakeSupabaseClient([
        {
          idempotency_key: 'idem-1',
          workspace_id: 'ws-1',
          booking_id: 'book-1',
          event: 'CONFIRMED',
          template_code: 'TMPL_01',
          phone_last4: '1234',
          status: 'PENDING',
          provider_message_id: null,
          error: null,
          created_at: now,
          updated_at: now,
        },
      ])
      const ledger = new SupabaseAlimtalkLedger(client as any)

      const claimed = await ledger.claim(baseRecord, now)
      expect(claimed).toBe(false)
    })
  })

  describe('transition', () => {
    it('updates status and patch when transition is valid (PENDING -> SENT)', async () => {
      const client = createFakeSupabaseClient([
        {
          idempotency_key: 'idem-1',
          workspace_id: 'ws-1',
          booking_id: 'book-1',
          event: 'CONFIRMED',
          template_code: 'TMPL_01',
          phone_last4: '1234',
          status: 'PENDING',
          provider_message_id: null,
          error: null,
          created_at: now,
          updated_at: now,
        },
      ])
      const ledger = new SupabaseAlimtalkLedger(client as any)
      const later = '2026-11-06T00:01:00.000Z'

      const ok = await ledger.transition(
        'idem-1',
        'SENT',
        { providerMessageId: 'msg-999' },
        later,
      )
      expect(ok).toBe(true)

      const record = await ledger.get('idem-1')
      expect(record?.status).toBe('SENT')
      expect(record?.providerMessageId).toBe('msg-999')
      expect(record?.updatedAt).toBe(later)
    })

    it('advances from SENT to DELIVERED', async () => {
      const client = createFakeSupabaseClient([
        {
          idempotency_key: 'idem-1',
          workspace_id: 'ws-1',
          booking_id: 'book-1',
          event: 'CONFIRMED',
          template_code: 'TMPL_01',
          phone_last4: '1234',
          status: 'SENT',
          provider_message_id: 'msg-999',
          error: null,
          created_at: now,
          updated_at: now,
        },
      ])
      const ledger = new SupabaseAlimtalkLedger(client as any)
      const later = '2026-11-06T00:02:00.000Z'

      const ok = await ledger.transition('idem-1', 'DELIVERED', {}, later)
      expect(ok).toBe(true)

      const record = await ledger.get('idem-1')
      expect(record?.status).toBe('DELIVERED')
      expect(record?.providerMessageId).toBe('msg-999')
    })

    it('rejects backwards transition (DELIVERED -> SENT) and returns false', async () => {
      const client = createFakeSupabaseClient([
        {
          idempotency_key: 'idem-1',
          workspace_id: 'ws-1',
          booking_id: 'book-1',
          event: 'CONFIRMED',
          template_code: 'TMPL_01',
          phone_last4: '1234',
          status: 'DELIVERED',
          provider_message_id: 'msg-999',
          error: null,
          created_at: now,
          updated_at: now,
        },
      ])
      const ledger = new SupabaseAlimtalkLedger(client as any)

      const ok = await ledger.transition('idem-1', 'SENT', {}, now)
      expect(ok).toBe(false)

      const record = await ledger.get('idem-1')
      expect(record?.status).toBe('DELIVERED')
    })

    it('returns false for nonexistent key', async () => {
      const client = createFakeSupabaseClient()
      const ledger = new SupabaseAlimtalkLedger(client as any)

      const ok = await ledger.transition('non-existent', 'SENT', {}, now)
      expect(ok).toBe(false)
    })
  })

  describe('findByProviderMessageId', () => {
    it('finds record by providerMessageId', async () => {
      const client = createFakeSupabaseClient([
        {
          idempotency_key: 'idem-1',
          workspace_id: 'ws-1',
          booking_id: 'book-1',
          event: 'CONFIRMED',
          template_code: 'TMPL_01',
          phone_last4: '1234',
          status: 'SENT',
          provider_message_id: 'msg-12345',
          error: null,
          created_at: now,
          updated_at: now,
        },
      ])
      const ledger = new SupabaseAlimtalkLedger(client as any)

      const record = await ledger.findByProviderMessageId('msg-12345')
      expect(record).not.toBeNull()
      expect(record?.idempotencyKey).toBe('idem-1')
      expect(record?.providerMessageId).toBe('msg-12345')
    })

    it('returns null if not found', async () => {
      const client = createFakeSupabaseClient()
      const ledger = new SupabaseAlimtalkLedger(client as any)

      const record = await ledger.findByProviderMessageId('msg-none')
      expect(record).toBeNull()
    })
  })
})
