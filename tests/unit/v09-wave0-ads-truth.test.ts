import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('ANI-916: Ads Provider Read Model & Hardcoded Fixture Elimination', () => {
  it('statically ensures ads-view has zero hardcoded false-truth fixtures and labels', () => {
    const adsViewPath = path.resolve(process.cwd(), 'src/app/app/ads/ads-view.tsx')
    const content = fs.readFileSync(adsViewPath, 'utf8')

    // 1. No Figma mockup labels
    expect(content).not.toContain('Figma 37:1782')

    // 2. No hardcoded KRW 185,000 spend
    expect(content).not.toContain('₩185,000')

    // 3. No hardcoded 1,240 views or fake ROAS numbers
    expect(content).not.toContain('1,240회')
    expect(content).not.toContain('320%')
    expect(content).not.toContain('340%')
    expect(content).not.toContain('280%')

    // 4. Must support CONNECT_REQUIRED and EMPTY_VERIFIED views
    expect(content).toContain('CONNECT_REQUIRED')
  })
})
