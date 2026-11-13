import { describe, expect, it } from 'vitest'
import { drawOverlay } from './overlay-renderer'
import { computeOverlayLayout } from './overlay-template'

function recorder() {
  const calls: string[] = []
  const state: Record<string, unknown> = {}
  const ctx = new Proxy({}, {
    get(_t, prop: string) {
      if (prop in state) return state[prop]
      return (...args: unknown[]) => { calls.push(`${prop}(${args.map((a) => (typeof a === 'object' ? 'obj' : String(a))).join(',')})`) }
    },
    set(_t, prop: string, value) { state[prop] = value; calls.push(`set ${prop}=${String(value)}`); return true },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

const texts = { brandLine: 'BY.REUM BROW', designLine: "Design. Women's Combo Brow", quote: '자연스럽게\n또렷함', insetLabel: 'BEFORE' }
const img = (w: number, h: number) => ({ width: w, height: h }) as unknown as CanvasImageSource & { width: number; height: number }

describe('drawOverlay', () => {
  it('keeps the source crop inside the photo when shrinking an inset', () => {
    const { ctx, calls } = recorder()
    const layout = computeOverlayLayout({ width: 1000, height: 1250 }, 'portrait-left', texts, { beforeAspect: 3 })
    drawOverlay(ctx, layout, { base: null, before: img(900, 300) })
    const draw = calls.find((call) => call.startsWith('drawImage'))!
    const [sx, sy, sw, sh] = draw.slice('drawImage(obj,'.length, -1).split(',').map(Number)
    expect(sx).toBeGreaterThanOrEqual(0)
    expect(sy).toBeGreaterThanOrEqual(0)
    expect(sx! + sw!).toBeLessThanOrEqual(900.001)
    expect(sy! + sh!).toBeLessThanOrEqual(300.001)
    expect(sw! / sh!).toBeCloseTo(3)
  })
  it('draws the base photo cover-fit, then the clipped before strip, then the texts in order', () => {
    const { ctx, calls } = recorder()
    const layout = computeOverlayLayout({ width: 1000, height: 1250 }, 'portrait-left', texts, { beforeAspect: 3 })
    drawOverlay(ctx, layout, { base: img(1000, 1250), before: img(900, 300) })
    const draws = calls.filter((c) => c.startsWith('drawImage'))
    expect(draws).toHaveLength(2)
    expect(calls.findIndex((c) => c.startsWith('clip'))).toBeGreaterThan(calls.findIndex((c) => c.startsWith('drawImage')))
    const textCalls = calls.filter((c) => c.startsWith('fillText'))
    expect(textCalls.map((c) => c.split(',')[0])).toEqual(['fillText(BEFORE', 'fillText(BY.REUM BROW', "fillText(Design. Women's Combo Brow", 'fillText(자연스럽게', 'fillText(또렷함'])
  })

  it('uses a circular clip for the lash preset and does not draw an inset without a before photo', () => {
    const lash = recorder()
    drawOverlay(lash.ctx, computeOverlayLayout({ width: 1000, height: 1250 }, 'lash-circle', texts, { beforeAspect: 1 }), { base: img(1000, 1250), before: img(300, 300) })
    expect(lash.calls.some((c) => c.startsWith('arc('))).toBe(true)
    const none = recorder()
    drawOverlay(none.ctx, computeOverlayLayout({ width: 1000, height: 1250 }, 'portrait-left', texts, { beforeAspect: null }), { base: img(1000, 1250), before: null })
    expect(none.calls.filter((c) => c.startsWith('drawImage'))).toHaveLength(1)
    expect(none.calls.some((c) => c.startsWith('clip'))).toBe(false)
  })

  it('fills the background and panel for a review card without a photo', () => {
    const { ctx, calls } = recorder()
    drawOverlay(ctx, computeOverlayLayout({ width: 1000, height: 1250 }, 'review-card', { ...texts, brandLine: 'CUSTOMER REVIEW' }, { beforeAspect: null }), { base: null, before: null })
    expect(calls.filter((c) => c.startsWith('drawImage'))).toHaveLength(0)
    expect(calls.some((c) => c.startsWith('fillRect'))).toBe(true)
    expect(calls.some((c) => c.startsWith('roundRect') || c.startsWith('arcTo'))).toBe(true)
    expect(calls.some((c) => c === 'fillText(CUSTOMER REVIEW,500,' + calls.find((x) => x.startsWith('fillText(CUSTOMER'))!.split(',')[2])).toBe(true)
  })
})
