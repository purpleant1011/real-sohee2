// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureOverlayFonts } from './overlay-renderer'

const load = vi.fn(async () => [])
beforeEach(() => {
  vi.useFakeTimers()
  document.getElementById('sohee-overlay-fonts')?.remove()
  Object.defineProperty(document, 'fonts', { configurable: true, value: { load } })
  load.mockClear()
})
afterEach(() => { vi.useRealTimers() })

describe('overlay font readiness', () => {
  it('waits for the font stylesheet before requesting faces and drawing text', async () => {
    const pending = ensureOverlayFonts()
    expect(load).not.toHaveBeenCalled()
    document.getElementById('sohee-overlay-fonts')!.dispatchEvent(new Event('load'))
    await pending
    expect(load).toHaveBeenCalledWith('500 40px "Cormorant Garamond"')
    expect(load).toHaveBeenCalledWith('400 40px "Noto Serif KR"')
  })

  it('continues with fallback fonts when the stylesheet fails', async () => {
    const pending = ensureOverlayFonts()
    document.getElementById('sohee-overlay-fonts')!.dispatchEvent(new Event('error'))
    await pending
    expect(load).not.toHaveBeenCalled()
  })

  it('does not hang when the stylesheet never responds', async () => {
    const pending = ensureOverlayFonts()
    await vi.advanceTimersByTimeAsync(3000)
    await expect(pending).resolves.toBeUndefined()
    expect(load).not.toHaveBeenCalled()
  })
})
