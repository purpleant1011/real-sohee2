import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerSupabaseClient } from '@/features/operations/types'
import { customerDispatcher } from './customer-dispatcher'
import { soheeDispatcher } from './sohee-dispatcher'
import { resultsDispatcher } from './results-dispatcher'

const requestClient = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: requestClient }))

function database(rows: unknown, error: unknown = null) {
  const eq = vi.fn()
  const chain: Record<string, unknown> = {}
  for (const name of ['select', 'in', 'order', 'limit', 'abortSignal', 'gte', 'lte', 'is']) chain[name] = () => chain
  chain.maybeSingle = () => Promise.resolve({ data: Array.isArray(rows) ? rows[0] ?? null : rows, error })
  chain.eq = (...args: unknown[]) => { eq(...args); return chain }
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error }).then(resolve)
  const from = vi.fn((table: string) => {
    if (table !== 'knowledge_facts') return chain
    const facts: Record<string, unknown> = {}
    for (const method of ['select', 'order']) facts[method] = () => facts
    facts.eq = (...args: unknown[]) => { eq(...args); return facts }
    facts.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error }).then(resolve)
    return facts
  })
  return { client: { from } as unknown as ServerSupabaseClient, eq, from }
}
const scope = { workspaceId: '20000000-0000-4000-8000-000000000001', actorId: 'actor-current', correlationId: 'job-current', intentMode: 'DRAFT' as const }
beforeEach(() => { requestClient.mockReset(); requestClient.mockRejectedValue(new Error('NO_REQUEST_COOKIES')) })

describe('worker-safe existing domain reads', () => {
  it('passes the validated worker client to the canonical reservation service', async () => {
    const db = database([])
    const result = await customerDispatcher.execute({ _toolName: 'reservation.list' }, { ...scope, readClient: db.client })
    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({ reservations: [], count: 0, empty: true })
    expect(db.eq).toHaveBeenCalledWith('workspace_id', scope.workspaceId)
    expect(requestClient).not.toHaveBeenCalled()
  })

  it('reads stored outcome ledgers without using request cookies', async () => {
    const db = database([])
    const result = await resultsDispatcher.execute({ _toolName: 'performance.summary' }, { ...scope, readClient: db.client })
    expect(result.success).toBe(true)
    expect(db.eq).toHaveBeenCalledWith('workspace_id', scope.workspaceId)
    expect(requestClient).not.toHaveBeenCalled()
  })

  it('does not interpret malformed customer rows as a verified empty inbox', async () => {
    const db = database(null)
    const result = await customerDispatcher.execute({ _toolName: 'customer.search' }, { ...scope, readClient: db.client })
    expect(result.success).toBe(false)
  })

  it('does not interpret missing result rows as zero completed business outcomes', async () => {
    const db = database(null)
    const result = await resultsDispatcher.execute({ _toolName: 'performance.summary' }, { ...scope, readClient: db.client })
    expect(result.success).toBe(false)
    expect(result.data).toBeUndefined()
  })

  it('uses the validated injected client for actual business knowledge', async () => {
    const db = database([{ id: 'fact-1', workspace_id: scope.workspaceId, memory_class: 'BUSINESS_RULE',
      subject: '예약금 안내', fact_content: '예약금은 상담 후 확인합니다.', status: 'approved', confidence_score: 1,
      provenance_type: 'USER_CONFIRMED', provenance_id: 'source-1', created_at: '2026-10-29T10:00:00Z' }])
    const result = await soheeDispatcher.execute({ _toolName: 'knowledge.search', query: '예약금' }, { ...scope, readClient: db.client })
    expect(result.status).toBe('COMPLETED')
    expect(result.data?.memories).toEqual([expect.objectContaining({ id: 'fact-1', factContent: '예약금은 상담 후 확인합니다.' })])
    expect(db.eq).toHaveBeenCalledWith('workspace_id', scope.workspaceId)
    expect(requestClient).not.toHaveBeenCalled()
  })

  it('does not turn failed knowledge reads into a successful empty result', async () => {
    const db = database([], { code: 'NETWORK_ERROR' })
    const result = await soheeDispatcher.execute({ _toolName: 'knowledge.search', query: '예약금' }, { ...scope, readClient: db.client })
    expect(result.success).toBe(false)
    expect(result.status).toBe('FAILED')
    expect(result.data?.totalFound).toBeUndefined()
  })

  it('queries customer records through the same domain service without request cookies', async () => {
    const db = database([{ id: 'customer-1', display_label: '문의 고객', channel: 'instagram_dm', summary: '예약 가능 시간 문의', requires_human_review: true }])
    const result = await customerDispatcher.execute({ _toolName: 'customer.search' }, { ...scope, readClient: db.client })
    expect(result.success).toBe(true)
    expect(result.data?.customerList).toEqual([expect.objectContaining({ id: 'customer-1', lastMessage: '예약 가능 시간 문의' })])
    expect(db.eq).toHaveBeenCalledWith('workspace_id', scope.workspaceId)
    expect(requestClient).not.toHaveBeenCalled()
  })

  it('loads stored comments with workspace binding rather than a cookie-bound client', async () => {
    const db = database([{ id: 'comment-1', channel: 'instagram', author_handle: 'visitor', comment_text: '주말에 가능한가요?', status: 'unread', comment_created_at: '2026-10-29T10:00:00Z' }])
    const result = await customerDispatcher.execute({ _toolName: 'review.list' }, { ...scope, readClient: db.client })
    expect(result.data?.reviews).toEqual([expect.objectContaining({ id: 'comment-1', commentText: '주말에 가능한가요?' })])
    expect(db.eq).toHaveBeenCalledWith('workspace_id', scope.workspaceId)
    expect(requestClient).not.toHaveBeenCalled()
  })
})
