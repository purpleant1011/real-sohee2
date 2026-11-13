import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToolDispatcher } from '@/features/tool-runtime/tool-dispatcher'
import { createServerSupabaseClient } from '@/lib/supabase/server'

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }))

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

const context = { workspaceId: 'workspace', correlationId: 'trace' }

function customerQuery(abort: (signal: AbortSignal) => Promise<unknown>) {
  const query = {
    select: vi.fn(() => query), eq: vi.fn(() => query),
    order: vi.fn(() => query), limit: vi.fn(() => query),
    abortSignal: vi.fn(abort),
    // The broken implementation awaits without attaching an abort signal.
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
  }
  vi.mocked(createServerSupabaseClient).mockResolvedValue({ from: vi.fn(() => query) } as any)
  vi.spyOn(ToolDispatcher, 'runPreflight').mockResolvedValue({ allowed: true })
  return query
}

describe('CAR-05 customer read adapter cancellation', () => {
  it('passes caller cancellation through the real dispatcher to the PostgREST request', async () => {
    const controller = new AbortController()
    const query = customerQuery(signal => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      controller.abort()
    }))
    const result = await ToolDispatcher.dispatch('customer.search', {}, { ...context, signal: controller.signal })
    expect(query.eq).toHaveBeenCalledWith('workspace_id', context.workspaceId)
    expect(query.abortSignal).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ success: false, status: 'BLOCKED', error: { code: 'ABORTED' } })
  })

  it('aborts an in-flight PostgREST read at the whole-run deadline', async () => {
    vi.useFakeTimers()
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const query = customerQuery(signal => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      entered()
    }))
    const pending = ToolDispatcher.dispatch('customer.search', {}, { ...context, deadlineAt: Date.now() + 20 })
    // Also settle on a broken implementation that never enters abortSignal.
    await Promise.race([started, pending])
    await vi.advanceTimersByTimeAsync(20)
    const result = await pending
    expect(query.abortSignal).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ success: false, status: 'BLOCKED', error: { code: 'TIMEOUT' } })
    expect(vi.getTimerCount()).toBe(0)
  })
})
