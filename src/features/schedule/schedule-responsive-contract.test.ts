import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/features/schedule/schedule-board.module.css'), 'utf8')

describe('schedule responsive contract', () => {
  it('uses the shared touch target and desktop 68/32 detail layout', () => {
    expect(css).toMatch(/\.detailButton\s*\{[\s\S]*?min-block-size:\s*var\(--tap-size\)/)
    expect(css).toContain('@media (min-width: 1200px)')
    expect(css).toContain('grid-template-columns: minmax(0, 68fr) minmax(18rem, 32fr)')
  })

  it('keeps mobile horizontal movement inside the date strip', () => {
    expect(css).toMatch(/\.dateStrip\s*\{[\s\S]*?overflow-x:\s*auto/)
    expect(css).not.toContain('.dateStrip a:nth-of-type(7)')
  })
})
