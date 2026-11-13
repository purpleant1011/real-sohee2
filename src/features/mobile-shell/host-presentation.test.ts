import { describe, expect, it } from 'vitest'
import { resolveHostPresentation } from './host-presentation'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15'

describe('resolveHostPresentation', () => {
  it('m.example.com 은 어떤 기기든 모바일 UI', () => {
    expect(resolveHostPresentation('m.example.com', MAC)).toMatchObject({ forceMobile: true, forcePc: false, initialMobile: true })
  })
  it('example.com 은 PC 브라우저에서 PC UI', () => {
    expect(resolveHostPresentation('example.com', MAC)).toMatchObject({ forceMobile: false, forcePc: true, initialMobile: false })
    expect(resolveHostPresentation('www.example.com:443', MAC).forcePc).toBe(true)
  })
  it('example.com 도 실제 휴대폰(iPhone·Android)에서는 모바일 UI (설치한 앱이 옛 주소여도 PC 화면을 쓰지 않는다)', () => {
    for (const ua of [IPHONE, ANDROID]) {
      expect(resolveHostPresentation('example.com', ua)).toMatchObject({ forceMobile: true, forcePc: false, initialMobile: true })
    }
  })
  it('그 밖의 호스트는 화면 폭에 맡긴다', () => {
    expect(resolveHostPresentation('localhost:3000', MAC)).toMatchObject({ forceMobile: false, forcePc: false, initialMobile: false })
    expect(resolveHostPresentation('localhost:3000', IPHONE)).toMatchObject({ forceMobile: false, forcePc: false, initialMobile: true })
  })
})
