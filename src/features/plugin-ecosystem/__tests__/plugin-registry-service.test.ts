import { describe, it, expect } from 'vitest'
import { PluginRegistryService } from '../plugin-registry-service'

describe('PluginRegistryService Policy Copy Audit', () => {
  it('does not claim Instagram story auto publish or naver blog long post automation, and removes 상위노출', () => {
    const service = new PluginRegistryService()

    const ig = service.getPlugin('plg_meta_instagram')
    expect(ig?.description).not.toContain('스토리 자동 게시')
    expect(ig?.description).toContain('DM 문의 답변 초안')

    const naver = service.getPlugin('plg_naver_place_blog')
    expect(naver?.description).not.toContain('블로그 장문 포스팅')
    expect(naver?.description).toContain('블로그 원고 및 사진 준비')
    expect(naver?.packName).not.toContain('상위노출')
    expect(naver?.contract.outcomeTarget).not.toContain('상위 노출')

    const daangn = service.getPlugin('plg_daangn_local')
    expect(daangn?.description).not.toContain('타겟 할인 쿠폰 배포')
    expect(daangn?.description).toContain('소식 및 혜택 안내 원고 준비')
    expect(daangn?.contract.outcomeTarget).not.toContain('쿠폰 회수')
  })
})
