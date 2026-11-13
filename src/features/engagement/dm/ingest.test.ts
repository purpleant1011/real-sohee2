import { describe, expect, it } from 'vitest'
import {
  DM_NON_TEXT_PLACEHOLDER,
  dmProviderThreadId,
  ingestDmMessage,
  type IngestDmMessageInput,
} from './ingest'
import type { InstagramDmMessage, InstagramDmThread } from './types'

const WS = 'ws-1'
const CONN = 'conn-1'
const BIZ = 'biz-100'
const CUST = 'cust-200'
const HOUR = 3_600_000

function memoryRepo() {
  const threads = new Map<string, InstagramDmThread>()
  const messages: InstagramDmMessage[] = []
  let seq = 0
  return {
    threads,
    messages,
    async findThreadByProviderThreadId(_ws: string, pid: string) {
      return threads.get(pid) ?? null
    },
    async upsertThread(t: Omit<InstagramDmThread, 'id' | 'created_at' | 'updated_at'>) {
      const existing = threads.get(t.provider_thread_id)
      const row: InstagramDmThread = {
        ...(existing ?? { id: `th-${++seq}`, created_at: 'x', updated_at: 'x' }),
        ...t,
      } as InstagramDmThread
      threads.set(t.provider_thread_id, row)
      return row
    },
    async insertMessageIfAbsent(m: Omit<InstagramDmMessage, 'id' | 'created_at'>) {
      if (messages.some((x) => x.provider_message_id === m.provider_message_id)) return { inserted: false }
      messages.push({ ...m, id: `m-${++seq}`, created_at: 'x' })
      return { inserted: true }
    },
    async listMessages(_ws: string, threadId: string) {
      return messages.filter((m) => m.thread_id === threadId).sort((a, b) => a.sent_at.localeCompare(b.sent_at))
    },
  }
}

const NOW = new Date('2026-10-10T12:00:00.000Z')
const iso = (offsetHours: number) => new Date(NOW.getTime() + offsetHours * HOUR).toISOString()

function customerMsg(over: Partial<IngestDmMessageInput> = {}): IngestDmMessageInput {
  return {
    workspaceId: WS, channelConnectionId: CONN, businessIgId: BIZ,
    mid: 'mid-1', fromId: CUST, toId: BIZ, text: '토요일 예약 되나요?', createdAt: iso(-1),
    ...over,
  }
}

describe('ingestDmMessage', () => {
  it('creates a NEEDS_REPLY thread keyed by business:customer with a 24h window from the customer message', async () => {
    const repo = memoryRepo()
    const out = await ingestDmMessage(customerMsg(), repo, NOW)
    expect(out.status).toBe('ingested')
    const t = repo.threads.get(dmProviderThreadId(BIZ, CUST))!
    expect(t.status).toBe('NEEDS_REPLY')
    expect(t.customer_id).toBe(CUST)
    expect(t.customer_handle).toBe(CUST) // no username known yet
    expect(t.last_message_text).toBe('토요일 예약 되나요?')
    expect(t.expires_at).toBe(new Date(Date.parse(iso(-1)) + 24 * HOUR).toISOString())
    expect(repo.messages).toHaveLength(1)
    expect(repo.messages[0].sender_type).toBe('customer')
  })

  it('is idempotent for the same message id', async () => {
    const repo = memoryRepo()
    await ingestDmMessage(customerMsg(), repo, NOW)
    const again = await ingestDmMessage(customerMsg(), repo, NOW)
    expect(again.status).toBe('duplicate')
    expect(repo.messages).toHaveLength(1)
    expect(repo.threads.size).toBe(1)
  })

  it('treats an echo as a business message, resolves the customer from toId, and closes the thread as SENT', async () => {
    const repo = memoryRepo()
    await ingestDmMessage(customerMsg({ mid: 'in-1', createdAt: iso(-3) }), repo, NOW)
    const out = await ingestDmMessage(
      customerMsg({ mid: 'out-1', fromId: BIZ, toId: CUST, isEcho: true, text: '네 가능해요', createdAt: iso(-2) }),
      repo,
      NOW,
    )
    expect(out.status).toBe('ingested')
    const t = repo.threads.get(dmProviderThreadId(BIZ, CUST))!
    expect(t.status).toBe('SENT')
    expect(t.last_message_text).toBe('네 가능해요')
    // the window is still anchored to the last CUSTOMER message, not the business reply
    expect(t.expires_at).toBe(new Date(Date.parse(iso(-3)) + 24 * HOUR).toISOString())
    expect(repo.messages.find((m) => m.provider_message_id === 'out-1')!.sender_type).toBe('business')
  })

  it('treats fromId === businessIgId as business even without the echo flag (polling path)', async () => {
    const repo = memoryRepo()
    await ingestDmMessage(customerMsg({ mid: 'in-1', createdAt: iso(-3) }), repo, NOW)
    await ingestDmMessage(customerMsg({ mid: 'out-1', fromId: BIZ, toId: CUST, createdAt: iso(-2) }), repo, NOW)
    expect(repo.threads.get(dmProviderThreadId(BIZ, CUST))!.status).toBe('SENT')
  })

  it('reopens a SENT thread when a newer customer message arrives and extends the window', async () => {
    const repo = memoryRepo()
    await ingestDmMessage(customerMsg({ mid: 'in-1', createdAt: iso(-5) }), repo, NOW)
    await ingestDmMessage(customerMsg({ mid: 'out-1', fromId: BIZ, toId: CUST, isEcho: true, createdAt: iso(-4) }), repo, NOW)
    await ingestDmMessage(customerMsg({ mid: 'in-2', text: '그럼 3시로요', createdAt: iso(-1) }), repo, NOW)
    const t = repo.threads.get(dmProviderThreadId(BIZ, CUST))!
    expect(t.status).toBe('NEEDS_REPLY')
    expect(t.expires_at).toBe(new Date(Date.parse(iso(-1)) + 24 * HOUR).toISOString())
  })

  it('marks the thread EXPIRED when the last customer message is older than 24h', async () => {
    const repo = memoryRepo()
    await ingestDmMessage(customerMsg({ createdAt: iso(-30) }), repo, NOW)
    expect(repo.threads.get(dmProviderThreadId(BIZ, CUST))!.status).toBe('EXPIRED')
  })

  it('keeps DISMISSED until a newer customer message arrives', async () => {
    const repo = memoryRepo()
    await ingestDmMessage(customerMsg({ mid: 'in-1', createdAt: iso(-3) }), repo, NOW)
    const key = dmProviderThreadId(BIZ, CUST)
    repo.threads.set(key, { ...repo.threads.get(key)!, status: 'DISMISSED' })
    await ingestDmMessage(customerMsg({ mid: 'in-1', createdAt: iso(-3) }), repo, NOW) // duplicate redelivery
    expect(repo.threads.get(key)!.status).toBe('DISMISSED')
    await ingestDmMessage(customerMsg({ mid: 'in-2', text: '아직이에요?', createdAt: iso(-1) }), repo, NOW)
    expect(repo.threads.get(key)!.status).toBe('NEEDS_REPLY')
  })

  it('keeps NEEDS_CHECK while the customer message is still the latest, and does not let our echo clear it', async () => {
    const repo = memoryRepo()
    await ingestDmMessage(customerMsg({ mid: 'in-1', createdAt: iso(-3) }), repo, NOW)
    const key = dmProviderThreadId(BIZ, CUST)
    repo.threads.set(key, { ...repo.threads.get(key)!, status: 'NEEDS_CHECK' })
    await ingestDmMessage(customerMsg({ mid: 'in-1', createdAt: iso(-3) }), repo, NOW)
    expect(repo.threads.get(key)!.status).toBe('NEEDS_CHECK')

    // A provider echo is evidence of delivery, not that the failed ledger/audit/message writes
    // were repaired. Clearing the quarantine here would silently drop the reconciliation marker.
    await ingestDmMessage(customerMsg({ mid: 'out-1', fromId: BIZ, toId: CUST, isEcho: true, createdAt: iso(-2) }), repo, NOW)
    expect(repo.threads.get(key)!.status).toBe('NEEDS_CHECK')
    expect(repo.threads.get(key)!.last_message_text).toBeDefined()
  })

  it('does not let a later customer message or a closed window clear NEEDS_CHECK', async () => {
    const repo = memoryRepo()
    await ingestDmMessage(customerMsg({ mid: 'in-1', createdAt: iso(-3) }), repo, NOW)
    const key = dmProviderThreadId(BIZ, CUST)
    repo.threads.set(key, { ...repo.threads.get(key)!, status: 'NEEDS_CHECK' })

    await ingestDmMessage(customerMsg({ mid: 'in-2', text: '추가 문의', createdAt: iso(-1) }), repo, NOW)
    expect(repo.threads.get(key)!.status).toBe('NEEDS_CHECK')

    await ingestDmMessage(customerMsg({ mid: 'in-3', text: '아주 오래된 문의', createdAt: iso(-60 * 60) }), repo, NOW)
    expect(repo.threads.get(key)!.status).toBe('NEEDS_CHECK')
  })

  it('self-heals ordering: an older message arriving late never regresses last_message_at', async () => {
    const repo = memoryRepo()
    await ingestDmMessage(customerMsg({ mid: 'in-2', text: '두 번째', createdAt: iso(-1) }), repo, NOW)
    await ingestDmMessage(customerMsg({ mid: 'in-1', text: '첫 번째', createdAt: iso(-2) }), repo, NOW)
    const t = repo.threads.get(dmProviderThreadId(BIZ, CUST))!
    expect(t.last_message_text).toBe('두 번째')
    expect(t.last_message_at).toBe(iso(-1))
  })

  it('upgrades the handle once a username becomes known, without downgrading it later', async () => {
    const repo = memoryRepo()
    await ingestDmMessage(customerMsg({ mid: 'in-1', createdAt: iso(-3) }), repo, NOW)
    await ingestDmMessage(customerMsg({ mid: 'in-2', createdAt: iso(-2), fromUsername: 'minji.studio' }), repo, NOW)
    const key = dmProviderThreadId(BIZ, CUST)
    expect(repo.threads.get(key)!.customer_handle).toBe('minji.studio')
    await ingestDmMessage(customerMsg({ mid: 'in-3', createdAt: iso(-1) }), repo, NOW)
    expect(repo.threads.get(key)!.customer_handle).toBe('minji.studio')
  })

  it('ignores self-test and deleted messages', async () => {
    const repo = memoryRepo()
    expect((await ingestDmMessage(customerMsg({ isSelf: true }), repo, NOW)).status).toBe('ignored')
    expect((await ingestDmMessage(customerMsg({ mid: 'm2', isDeleted: true }), repo, NOW)).status).toBe('ignored')
    expect(repo.threads.size).toBe(0)
    expect(repo.messages).toHaveLength(0)
  })

  it('ignores messages whose parties do not include the business account', async () => {
    const repo = memoryRepo()
    const out = await ingestDmMessage(customerMsg({ fromId: 'x', toId: 'y' }), repo, NOW)
    expect(out.status).toBe('ignored')
    expect(repo.threads.size).toBe(0)
  })

  it('stores a placeholder for empty text, truncates to 4000 chars, and strips control characters', async () => {
    const repo = memoryRepo()
    await ingestDmMessage(customerMsg({ mid: 'a', text: '', createdAt: iso(-3) }), repo, NOW)
    await ingestDmMessage(customerMsg({ mid: 'b', text: `안녕\u0000\u0007하세요${'가'.repeat(5000)}`, createdAt: iso(-2) }), repo, NOW)
    const a = repo.messages.find((m) => m.provider_message_id === 'a')!
    const b = repo.messages.find((m) => m.provider_message_id === 'b')!
    expect(a.text).toBe(DM_NON_TEXT_PLACEHOLDER)
    expect(b.text.startsWith('안녕하세요')).toBe(true)
    expect(b.text.length).toBe(4000)
  })

  it('rejects invalid timestamps as ignored instead of throwing', async () => {
    const repo = memoryRepo()
    const out = await ingestDmMessage(customerMsg({ createdAt: 'not-a-date' }), repo, NOW)
    expect(out.status).toBe('ignored')
  })
})
