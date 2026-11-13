import { describe, expect, it } from 'vitest'
import {
  calculateSpecificity,
  evaluateCascade,
  matchesMedia,
  parseLengthToPx,
} from './cascade-evaluator'

describe('cascade-evaluator', () => {
  it('calculates standard CSS specificity correctly', () => {
    expect(calculateSpecificity('button')).toBe(1)
    expect(calculateSpecificity('.workflowPrimary')).toBe(100)
    expect(calculateSpecificity('.reviewDock > button')).toBe(101)
    expect(calculateSpecificity('.reviewDock > .workflowPrimary')).toBe(200)
    expect(calculateSpecificity('.resultCard .reviewDock .workflowPrimary')).toBe(300)
    expect(calculateSpecificity('#main .reviewDock .workflowPrimary')).toBe(10200)
    expect(calculateSpecificity('a:not(.detailTextLink)')).toBe(101)
  })

  it('matches media queries according to viewport width', () => {
    expect(matchesMedia('(max-width: 760px)', 390)).toBe(true)
    expect(matchesMedia('(max-width: 760px)', 760)).toBe(true)
    expect(matchesMedia('(max-width: 760px)', 761)).toBe(false)
    expect(matchesMedia('(max-width: 759px)', 390)).toBe(true)
    expect(matchesMedia('(max-width: 759px)', 760)).toBe(false)
    expect(matchesMedia('(min-width: 1100px)', 390)).toBe(false)
    expect(matchesMedia(null, 390)).toBe(true)
  })

  it('parses lengths to px correctly', () => {
    expect(parseLengthToPx('16px')).toBe(16)
    expect(parseLengthToPx('1rem', 16)).toBe(16)
    expect(parseLengthToPx('0.8rem', 16)).toBe(12.8)
    expect(parseLengthToPx('0.75rem', 16)).toBe(12)
    expect(parseLengthToPx('inherit')).toBeNull()
  })

  it('correctly determines winning declaration by specificity and source order', () => {
    const css = `
      .base { font-size: 12px; }
      .override { font-size: 14px; }
      @media (max-width: 759px) {
        .card .base { font-size: 16px; }
      }
    `
    const html = '<div class="card"><button class="base override">Click</button></div>'

    // At 390px, .card .base has specificity 200, beats .override (100) and .base (100)
    const mobileRes = evaluateCascade(css, html, 'button', 'font-size', { viewportWidth: 390 })
    expect(mobileRes?.valueInPx).toBe(16)
    expect(mobileRes?.selector).toBe('.card .base')

    // At 1024px desktop, media query does not match, .override (order 2) beats .base (order 1) with equal specificity 100
    const desktopRes = evaluateCascade(css, html, 'button', 'font-size', { viewportWidth: 1024 })
    expect(desktopRes?.valueInPx).toBe(14)
    expect(desktopRes?.selector).toBe('.override')
  })
})
