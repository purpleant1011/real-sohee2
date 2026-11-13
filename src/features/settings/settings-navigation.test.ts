import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(`${process.cwd()}/src/features/settings/settings.module.css`, 'utf8')

describe('settings navigation on narrow screens', () => {
  it('wraps tabs so every settings destination stays visible', () => {
    const tabs = css.match(/\.tabs\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(tabs).toMatch(/flex-wrap:\s*wrap/)
    expect(tabs).not.toMatch(/overflow-x:\s*auto/)
  })
})
