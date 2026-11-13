import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToolDispatcher } from '@/features/tool-runtime/tool-dispatcher'
import { adsDispatcher } from '@/features/tool-runtime/dispatchers/ads-dispatcher'
import { resultsDispatcher } from '@/features/tool-runtime/dispatchers/results-dispatcher'
import { LongTermMemoryService } from '@/lib/memory/long-term-memory-service'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers() })

const context = { workspaceId: 'workspace', correlationId: 'trace' }

function installQuery(controller: AbortController, lateResult = false) {
  const response = { data: null, error: null }
  let signal: AbortSignal | undefined
  const settle = () => {
    if (signal) {
      controller.abort(new Error('cancelled read'))
      if (!lateResult) return Promise.reject(signal.reason)
    }
    return Promise.resolve(response)
  }
  const query = {
    select: vi.fn(() => query), eq: vi.fn(() => query), in: vi.fn(() => query),
    order: vi.fn(() => query), limit: vi.fn(() => query), maybeSingle: vi.fn(settle),
    abortSignal: vi.fn((value: AbortSignal) => { signal = value; return query }),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => settle().then(resolve, reject),
  }
  const client = { from: vi.fn(() => query) }
  vi.mocked(createServerSupabaseClient).mockResolvedValue(client as any)
  vi.mocked(createAdminSupabaseClient).mockReturnValue(client as any)
  vi.spyOn(ToolDispatcher, 'runPreflight').mockResolvedValue({ allowed: true })
  return { query, client }
}

describe('CAR-05 sequential performance read cancellation', () => {
  it.each([1, 2, 3, 4, 5, 6])('stops after cancellation at query %s even when transport returns late', async cancelAt => {
    const controller = new AbortController()
    let reads = 0
    const response = { data: [], error: null }
    const settle = () => {
      if (++reads === cancelAt) controller.abort(new Error('cancelled performance read'))
      return Promise.resolve(response)
    }
    const query = {
      select: vi.fn(() => query), eq: vi.fn(() => query), in: vi.fn(() => query),
      gte: vi.fn(() => query), lte: vi.fn(() => query), is: vi.fn(() => query),
      maybeSingle: vi.fn(settle),
      abortSignal: vi.fn(() => query),
      then: (resolve: (value: unknown) => unknown) => settle().then(resolve),
    }
    const from = vi.fn(() => query)
    vi.mocked(createServerSupabaseClient).mockResolvedValue({ from } as any)
    await expect(resultsDispatcher.execute({}, { ...context, signal: controller.signal }))
      .rejects.toThrow('cancelled performance read')
    expect(from).toHaveBeenCalledTimes(cancelAt)
    expect(query.abortSignal).toHaveBeenCalledTimes(cancelAt)
  })
})

describe('CAR-05 knowledge and credit read cancellation', () => {
  it('propagates cancellation during the ads domain account lookup', async () => {
    const controller = new AbortController()
    const { query } = installQuery(controller)
    await expect(adsDispatcher.execute({ _toolName: 'ads.probe' }, { ...context, signal: controller.signal }))
      .rejects.toThrow('cancelled read')
    expect(query.abortSignal).toHaveBeenCalledTimes(1)
  })

  it.each(['knowledge.search', 'credit.status'])('propagates caller cancellation to %s transport', async tool => {
    const controller = new AbortController()
    const { query } = installQuery(controller)
    const result = await ToolDispatcher.dispatch(tool, { query: '매장 주소' }, { ...context, signal: controller.signal })
    expect(query.abortSignal).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ success: false, status: 'BLOCKED', error: { code: 'ABORTED' } })
  })

  it.each([false, true])('never substitutes DEMO seed memories after cancellation (late result: %s)', async lateResult => {
    vi.stubEnv('NEXT_PUBLIC_DATASET_MODE', 'DEMO')
    const controller = new AbortController()
    installQuery(controller, lateResult)
    await expect(LongTermMemoryService.retrieveRelevantMemories(
      context.workspaceId, ['매장 주소'], 5, controller.signal,
    )).rejects.toThrow('cancelled read')
  })

  it('does not initialize a client for a pre-cancelled memory read', async () => {
    const controller = new AbortController()
    const { client } = installQuery(controller)
    controller.abort(new Error('already cancelled'))
    await expect(LongTermMemoryService.retrieveRelevantMemories(
      context.workspaceId, ['매장 주소'], 5, controller.signal,
    )).rejects.toThrow('already cancelled')
    expect(client.from).not.toHaveBeenCalled()
  })
})
