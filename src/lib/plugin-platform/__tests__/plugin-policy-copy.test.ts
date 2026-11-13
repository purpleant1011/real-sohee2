import { describe, it, expect } from 'vitest'
import { FIRST_PARTY_PLUGIN_CATALOG } from '../core/first-party-plugin-catalog'

describe('First Party Plugin Catalog Policy & Copy Audit', () => {
  it('does not contain prohibited claims for naver_blog plugin', () => {
    const naver = FIRST_PARTY_PLUGIN_CATALOG.find(p => p.pluginId === 'plg_naver_blog_marketing')!
    expect(naver).toBeDefined()
    expect(naver.displayName).not.toContain('상위 노출')
    expect(naver.summary).not.toContain('DOM 자동화')
    expect(naver.summary).not.toContain('초안 및 발행합니다')

    const draftCap = naver.capabilities.find(c => c.capabilityId === 'naver_blog.draft')!
    expect(draftCap.description).not.toContain('임시저장글을 작성합니다')

    const publishCap = naver.capabilities.find(c => c.capabilityId === 'naver_blog.publish')!
    expect(publishCap.name).not.toContain('최종 발행')
    expect(publishCap.description).not.toContain('실제 블로그에 발행합니다')
  })

  it('does not claim automatic story publishing for daangn business', () => {
    const daangn = FIRST_PARTY_PLUGIN_CATALOG.find(p => p.pluginId === 'plg_daangn_business')!
    expect(daangn).toBeDefined()
    const storyCap = daangn.capabilities.find(c => c.capabilityId === 'daangn.publish_story')!
    expect(storyCap.name).not.toBe('당근 동네소식 발행')
    expect(storyCap.description).not.toContain('정보를 발행합니다')
  })

  it('softens 100% guarantee claims in creative factory', () => {
    const creative = FIRST_PARTY_PLUGIN_CATALOG.find(p => p.pluginId === 'plg_creative_factory')!
    expect(creative.summary).not.toContain('100% 준수하는')
  })
})
