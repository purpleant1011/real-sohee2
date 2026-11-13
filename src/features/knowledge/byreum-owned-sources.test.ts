import { describe, expect, it } from 'vitest'

import { byreumOwnedSources } from './byreum-owned-sources'

describe('Byreum owned knowledge sources', () => {
  it('keeps all three contract-approved sources owned and excludes the publishing test account', () => {
    expect(byreumOwnedSources).toEqual([
      expect.objectContaining({ channel: 'naver_blog', url: 'https://blog.naver.com/larlds', ownership: 'owned' }),
      expect.objectContaining({ channel: 'naver_place', url: 'https://naver.me/5xgJJEBa', ownership: 'owned' }),
      expect.objectContaining({ channel: 'daangn_business', ownership: 'owned' }),
    ])
    expect(JSON.stringify(byreumOwnedSources)).not.toContain('findk3')
  })
})
