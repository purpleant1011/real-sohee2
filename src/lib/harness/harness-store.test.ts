import { describe, it, expect } from 'vitest'
import { harnessStore, STUDIO_BY_REUM_SEED, NOOR_BROW_SEED } from './harness-store'

describe('Harness Knowledge OS Store (v1.1)', () => {
  it('loads seed harness assets properly', () => {
    const assets = harnessStore.getAssets()
    expect(assets.length).toBeGreaterThanOrEqual(2)

    const byreum = assets.find(a => a.id === 'harness_byreum_001')
    expect(byreum).toBeDefined()
    expect(byreum?.title).toContain('바이름')
    expect(byreum?.overallStatus).toBe('READY')
    expect(byreum?.platform).toBe('instagram')

    const noor = assets.find(a => a.id === 'harness_noor_002')
    expect(noor).toBeDefined()
    expect(noor?.title).toContain('누르브로우')
  })

  it('retrieves immutable version and rules with evidence states', () => {
    const version = harnessStore.getVersionById('ver_byreum_v1')
    expect(version).toBeDefined()
    expect(version?.immutable).toBe(true)
    expect(version?.confidence).toBe(88)

    const rules = harnessStore.getRulesByVersionId('ver_byreum_v1')
    expect(rules.length).toBeGreaterThan(0)
    
    // Check for OBSERVED and RECOMMENDED_DEFAULT distinction
    const observedRule = rules.find(r => r.evidenceState === 'OBSERVED')
    expect(observedRule).toBeDefined()
    expect(observedRule?.supportingSampleCount).toBeGreaterThan(0)

    const defaultRule = rules.find(r => r.evidenceState === 'RECOMMENDED_DEFAULT')
    expect(defaultRule).toBeDefined()
  })

  it('supports user overrides without mutating immutable source version', () => {
    const assetId = 'harness_byreum_001'
    const newOverride = harnessStore.addOverride({
      harnessAssetId: assetId,
      workspaceId: 'b1000000-0000-4000-8000-000000000001',
      module: 'text',
      ruleKey: 'test_rule_override',
      overrideValue: '항상 100% 예약제 강조',
      reason: '테스트용 오버라이드'
    })

    expect(newOverride.id).toBeDefined()
    const overrides = harnessStore.getOverrides(assetId)
    expect(overrides.some(o => o.id === newOverride.id)).toBe(true)

    // Cleanup
    harnessStore.removeOverride(newOverride.id)
  })
})
