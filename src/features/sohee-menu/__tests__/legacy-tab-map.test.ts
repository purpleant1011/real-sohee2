import { describe, expect, it } from 'vitest'
import { resolveSoheeTab } from '../legacy-tab-map'

describe('resolveSoheeTab', () => {
  it.each([
    ['studio', { tab: 'studio' }],
    ['teach', { tab: 'teach' }],
    ['profile', { tab: 'teach' }],
    ['settings', { tab: 'teach' }],
    ['lineage', { tab: 'teach' }],
    ['knowledge', { tab: 'teach' }],
    ['work', { tab: 'work' }],
    ['rules', { tab: 'work', section: 'rules' }],
    ['command', { tab: 'work', section: 'autonomy' }],
    ['campaigns', { tab: 'work', section: 'campaigns' }],
    ['routines', { tab: 'work', section: 'routines' }],
    ['briefing', { tab: 'work', section: 'briefing' }],
    ['learning', { tab: 'work', section: 'recipes' }],
    ['training', { tab: 'work', section: 'recipes' }],
    ['evaluation', { tab: 'work', section: 'evaluation' }],
    ['reports', { tab: 'work', section: 'reports' }],
    ['tools', { tab: 'tools' }],
    ['capabilities', { tab: 'tools' }],
    ['channels', { tab: 'tools' }],
    ['plugins', { tab: 'tools' }],
  ])('%s → %o', (raw, expected) => {
    expect(resolveSoheeTab(raw)).toEqual(expected)
  })

  it('없거나 모르는 값은 스튜디오', () => {
    expect(resolveSoheeTab(null)).toEqual({ tab: 'studio' })
    expect(resolveSoheeTab(undefined)).toEqual({ tab: 'studio' })
    expect(resolveSoheeTab('whatever')).toEqual({ tab: 'studio' })
  })

  it('섹션 쿼리가 따로 오면 일하는 방식 탭에서만 인정한다', () => {
    expect(resolveSoheeTab('work', 'recipes')).toEqual({ tab: 'work', section: 'recipes' })
    expect(resolveSoheeTab('teach', 'recipes')).toEqual({ tab: 'teach' })
    expect(resolveSoheeTab('work', 'nope')).toEqual({ tab: 'work' })
  })
})
