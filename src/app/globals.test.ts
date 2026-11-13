import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8')
const tokenPath = resolve(process.cwd(), 'src/styles/v07-tokens.css')
const tokenCss = existsSync(tokenPath) ? readFileSync(tokenPath, 'utf8') : ''

describe('global viewport tokens', () => {
  it('uses dynamic viewport and safe-area tokens for dialog layout', () => {
    expect(css).toContain('--viewport-block: 100dvh;')
    expect(css).toContain('--safe-area-top: env(safe-area-inset-top, 0px);')
    expect(css).toContain('--safe-area-right: env(safe-area-inset-right, 0px);')
    expect(css).toContain('--safe-area-bottom: env(safe-area-inset-bottom, 0px);')
    expect(css).toContain('--safe-area-left: env(safe-area-inset-left, 0px);')
    expect(css).toContain('var(--viewport-block)')
    expect(css).not.toContain('100vh')
  })

  it('loads the V0.8 semantic palette while preserving V0.7 aliases', () => {
    expect(css).toContain("@import '../styles/v07-tokens.css';")
    expect(tokenCss).toContain('--sohee-ink: #29242c;')
    expect(tokenCss).toContain('--sohee-canvas: #f5f2ee;')
    expect(tokenCss).toContain('--sohee-accent: #6941c6;')
    expect(tokenCss).toContain('--sohee-success: #218b68;')
    expect(tokenCss).toContain('--sohee-warning: #a76416;')
    expect(tokenCss).toContain('--sohee-danger: #c44e58;')
    expect(tokenCss).toContain('--v07-ink: var(--sohee-ink);')
    expect(tokenCss).toContain('--v07-canvas: var(--sohee-canvas);')
    expect(tokenCss).toContain('--v07-accent: var(--sohee-accent);')
    expect(tokenCss).toContain('--v07-coral: #ed826f;')
    expect(tokenCss).toContain('--v07-mint: var(--sohee-success);')
    expect(tokenCss).toContain('--v07-sidebar: #28182f;')
    expect(tokenCss).toContain('--color-bg: var(--v07-canvas);')
    expect(tokenCss).toContain('--color-text: var(--v07-ink);')
  })

  it('provides V0.8.6 Silicon Valley design tokens and utilities', () => {
    expect(tokenCss).toContain('--card-linear-glow')
    expect(tokenCss).toContain('--card-stripe-elevation')
    expect(tokenCss).toContain('--primary-oklch')
  })
})
