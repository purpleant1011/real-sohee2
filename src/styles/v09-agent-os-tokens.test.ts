import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('Agent OS Semantic Theme Tokens Contract', () => {
  const cssPath = path.resolve(process.cwd(), 'src/styles/v088-tokens.css')
  const cssContent = fs.readFileSync(cssPath, 'utf-8')

  const REQUIRED_SEMANTIC_TOKENS = [
    '--background',
    '--foreground',
    '--card',
    '--card-foreground',
    '--popover',
    '--popover-foreground',
    '--primary',
    '--primary-foreground',
    '--muted',
    '--muted-foreground',
    '--accent',
    '--accent-foreground',
    '--destructive',
    '--border',
    '--input',
    '--ring',
  ]

  const COMPATIBILITY_V088_TOKENS = [
    '--v088-bg',
    '--v088-surface',
    '--v088-ink',
    '--v088-border',
  ]

  it('defines all required shadcn-v4 semantic tokens in :root / light mode', () => {
    REQUIRED_SEMANTIC_TOKENS.forEach((token) => {
      expect(cssContent).toContain(token)
    })
  })

  it('preserves backward compatibility aliases for v088 tokens', () => {
    COMPATIBILITY_V088_TOKENS.forEach((token) => {
      expect(cssContent).toContain(token)
    })
  })

  it('defines both light and dark blocks', () => {
    expect(cssContent).toMatch(/:root|html:not\(\.dark\)/)
    expect(cssContent).toMatch(/html\.dark|:root\.dark/)
  })

  it('defines layout token --command-bar-height for floating overlay clearance', () => {
    expect(cssContent).toContain('--command-bar-height')
  })
})
