import { describe, expect, it } from 'vitest'
import { detectBrowserEnvironment } from './browser-detector'

describe('detectBrowserEnvironment', () => {
  it('detects Naver Whale browser on Windows', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Whale/3.24.223.18 Safari/537.36'
    const result = detectBrowserEnvironment(ua)

    expect(result.browser).toBe('whale')
    expect(result.browserName).toBe('네이버 웨일')
    expect(result.extensionUrl).toBeNull()
    expect(result.supportsExtension).toBe(false)
    expect(result.os).toBe('windows')
    expect(result.pasteShortcut).toBe('Ctrl+V')
    expect(result.tipMessage).toContain('네이버 웨일')
    expect(result.tipMessage).toContain('붙여넣')
  })

  it('detects Google Chrome on macOS', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    const result = detectBrowserEnvironment(ua)

    expect(result.browser).toBe('chrome')
    expect(result.browserName).toBe('구글 크롬')
    expect(result.extensionUrl).toBeNull()
    expect(result.supportsExtension).toBe(false)
    expect(result.os).toBe('macos')
    expect(result.pasteShortcut).toBe('Cmd+V')
    expect(result.tipMessage).toContain('구글 크롬')
    expect(result.tipMessage).toContain('붙여넣')
  })

  it('detects Microsoft Edge on Windows', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0'
    const result = detectBrowserEnvironment(ua)

    expect(result.browser).toBe('edge')
    expect(result.browserName).toBe('마이크로소프트 엣지')
    expect(result.extensionUrl).toBeNull()
    expect(result.supportsExtension).toBe(false)
    expect(result.os).toBe('windows')
    expect(result.pasteShortcut).toBe('Ctrl+V')
    expect(result.tipMessage).toContain('마이크로소프트 엣지')
    expect(result.tipMessage).toContain('붙여넣')
  })

  it('detects Safari on macOS and recommends manual copy', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15'
    const result = detectBrowserEnvironment(ua)

    expect(result.browser).toBe('safari')
    expect(result.browserName).toBe('사파리')
    expect(result.extensionUrl).toBeNull()
    expect(result.supportsExtension).toBe(false)
    expect(result.os).toBe('macos')
    expect(result.pasteShortcut).toBe('Cmd+V')
    expect(result.tipMessage).toContain('사파리')
    expect(result.tipMessage).toContain('붙여넣')
  })

  it('detects mobile browsers and provides manual guidance', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1'
    const result = detectBrowserEnvironment(ua)

    expect(result.supportsExtension).toBe(false)
    expect(result.os).toBe('mobile')
    expect(result.tipMessage).toContain('모바일')
    expect(result.tipMessage).toContain('직접')
  })

  it('never contains banned phrases in any browser tip message', () => {
    const uas = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Whale/3.24.223.18 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/122.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/122.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.2.1 Safari/605.1.15',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) Mobile/15E148 Safari/604.1',
      '',
    ]
    const bannedPatterns = [
      /자동등록/,
      /자동\s*포스팅/,
      /자동\s*게시/,
      /확장\s*프로그램/,
      /연결기/,
      /전용\s*실행기/,
      /게시\s*가능/,
    ]
    for (const ua of uas) {
      const { tipMessage } = detectBrowserEnvironment(ua)
      for (const pattern of bannedPatterns) {
        expect(tipMessage).not.toMatch(pattern)
      }
    }
  })
})
