import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToolDispatcher } from '@/features/tool-runtime/tool-dispatcher'
import { systemDispatcher } from '@/features/tool-runtime/dispatchers/system-dispatcher'
import { contentDispatcher } from '@/features/tool-runtime/dispatchers/content-dispatcher'

// No provider or database operation is permitted in these boundary tests.
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

const context = { workspaceId: 'ws', correlationId: 'trace' }

describe('CAR-05 domain execution fences', () => {
  it('does not enter preflight for an already cancelled request', async () => {
    const controller = new AbortController()
    controller.abort()
    const preflight = vi.spyOn(ToolDispatcher, 'runPreflight').mockResolvedValue({ allowed: true })
    const execute = vi.spyOn(systemDispatcher, 'execute').mockResolvedValue({ success: true, toolId: 'app.navigate', status: 'COMPLETED' })
    const result = await ToolDispatcher.dispatch('app.navigate', {}, { ...context, signal: controller.signal })
    expect(result).toMatchObject({ status: 'BLOCKED', error: { code: 'ABORTED' } })
    expect(preflight).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it('rechecks cancellation after an asynchronous preflight', async () => {
    const controller = new AbortController()
    vi.spyOn(ToolDispatcher, 'runPreflight').mockImplementation(async () => { controller.abort(); return { allowed: true } })
    const execute = vi.spyOn(systemDispatcher, 'execute').mockResolvedValue({ success: true, toolId: 'app.navigate', status: 'COMPLETED' })
    const result = await ToolDispatcher.dispatch('app.navigate', {}, { ...context, signal: controller.signal })
    expect(result.status).toBe('BLOCKED')
    expect(execute).not.toHaveBeenCalled()
  })

  it('rechecks the deadline after the durable start hook', async () => {
    vi.useFakeTimers()
    vi.spyOn(ToolDispatcher, 'runPreflight').mockResolvedValue({ allowed: true })
    const execute = vi.spyOn(systemDispatcher, 'execute').mockResolvedValue({ success: true, toolId: 'app.navigate', status: 'COMPLETED' })
    const deadlineAt = Date.now() + 10
    const result = await ToolDispatcher.dispatch('app.navigate', {}, {
      ...context, deadlineAt, onExecutionStarting: async () => { vi.setSystemTime(deadlineAt) },
    })
    expect(result).toMatchObject({ status: 'BLOCKED', error: { code: 'TIMEOUT' } })
    expect(execute).not.toHaveBeenCalled()
  })

  it('rechecks durable permission after the start hook without a browser signal', async () => {
    let executable = true
    vi.spyOn(ToolDispatcher, 'runPreflight').mockResolvedValue({ allowed: true })
    const execute = vi.spyOn(systemDispatcher, 'execute').mockResolvedValue({ success: true, toolId: 'app.navigate', status: 'COMPLETED' })
    const result = await ToolDispatcher.dispatch('app.navigate', {}, {
      ...context, canContinue: async () => executable, onExecutionStarting: async () => { executable = false },
    })
    expect(result.status).toBe('BLOCKED')
    expect(execute).not.toHaveBeenCalled()
  })

  it('propagates the whole-run deadline into an in-flight handler and clears its timer', async () => {
    vi.useFakeTimers()
    vi.spyOn(ToolDispatcher, 'runPreflight').mockResolvedValue({ allowed: true })
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    vi.spyOn(systemDispatcher, 'execute').mockImplementation(async (_args, ctx) => {
      entered()
      return new Promise((_resolve, reject) => ctx.signal?.addEventListener('abort', () => reject(ctx.signal?.reason), { once: true }))
    })
    const pending = ToolDispatcher.dispatch('app.navigate', {}, { ...context, deadlineAt: Date.now() + 20 })
    await started
    await vi.advanceTimersByTimeAsync(20)
    // Avoid hanging on the broken implementation, which never creates an abort signal.
    const result = await Promise.race([pending, Promise.resolve(null)])
    expect(result).toMatchObject({ status: 'BLOCKED', error: { code: 'TIMEOUT' } })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('discards a read result returned after cancellation and removes the caller listener', async () => {
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    vi.spyOn(ToolDispatcher, 'runPreflight').mockResolvedValue({ allowed: true })
    vi.spyOn(systemDispatcher, 'execute').mockImplementation(async () => {
      controller.abort()
      return { success: true, toolId: 'app.navigate', status: 'COMPLETED' }
    })
    const result = await ToolDispatcher.dispatch('app.navigate', {}, { ...context, signal: controller.signal })
    expect(result).toMatchObject({ success: false, status: 'BLOCKED', error: { code: 'ABORTED' } })
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('does not report an interrupted in-flight write as a safe failure to retry', async () => {
    vi.spyOn(ToolDispatcher, 'runPreflight').mockResolvedValue({ allowed: true })
    vi.spyOn(contentDispatcher, 'execute').mockRejectedValue(new DOMException('response lost', 'AbortError'))
    const result = await ToolDispatcher.dispatch('publish.create', {}, context)
    expect(result).toMatchObject({ success: false, status: 'RESULT_UNKNOWN', error: { code: 'RESULT_UNKNOWN' } })
  })

  it('keeps an acknowledged write result even if cancellation arrives before return', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    vi.spyOn(ToolDispatcher, 'runPreflight').mockResolvedValue({ allowed: true })
    vi.spyOn(contentDispatcher, 'execute').mockImplementation(async () => {
      controller.abort()
      return { success: true, toolId: 'publish.create', status: 'COMPLETED', data: { providerReference: 'receipt' } }
    })
    const result = await ToolDispatcher.dispatch('publish.create', {}, { ...context, signal: controller.signal, deadlineAt: Date.now() + 100 })
    expect(result).toMatchObject({ success: true, status: 'COMPLETED', data: { providerReference: 'receipt' } })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('classifies a deadline-aborted in-flight write as unknown, not safely cancelled', async () => {
    vi.useFakeTimers()
    vi.spyOn(ToolDispatcher, 'runPreflight').mockResolvedValue({ allowed: true })
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    vi.spyOn(contentDispatcher, 'execute').mockImplementation(async (_args, ctx) => {
      entered()
      return new Promise((_resolve, reject) => ctx.signal?.addEventListener('abort', () => reject(ctx.signal?.reason), { once: true }))
    })
    const pending = ToolDispatcher.dispatch('publish.create', {}, { ...context, deadlineAt: Date.now() + 20 })
    await started
    await vi.advanceTimersByTimeAsync(20)
    expect(await pending).toMatchObject({ success: false, status: 'RESULT_UNKNOWN', error: { code: 'RESULT_UNKNOWN' } })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not mark a write as uncertain when its durable start hook failed before execution', async () => {
    vi.spyOn(ToolDispatcher, 'runPreflight').mockResolvedValue({ allowed: true })
    const execute = vi.spyOn(contentDispatcher, 'execute').mockResolvedValue({ success: true, toolId: 'publish.create', status: 'COMPLETED' })
    const result = await ToolDispatcher.dispatch('publish.create', {}, {
      ...context, onExecutionStarting: async () => { throw new Error('checkpoint unavailable') },
    })
    expect(result.status).toBe('FAILED')
    expect(execute).not.toHaveBeenCalled()
  })
})
