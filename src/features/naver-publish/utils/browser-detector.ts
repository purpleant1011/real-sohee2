export type BrowserType = 'whale' | 'chrome' | 'edge' | 'safari' | 'other'
export type OperatingSystem = 'macos' | 'windows' | 'mobile' | 'other'

export type BrowserEnvironmentInfo = Readonly<{
  browser: BrowserType
  browserName: string
  extensionUrl: string | null
  supportsExtension: boolean
  os: OperatingSystem
  pasteShortcut: string
  tipMessage: string
}>

export function detectBrowserEnvironment(userAgentString?: string): BrowserEnvironmentInfo {
  const ua = userAgentString ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '')

  // 1. Detect OS
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua)
  const isMac = !isMobile && /Macintosh|Mac OS X/i.test(ua)
  const isWindows = !isMobile && /Windows NT/i.test(ua)

  const os: OperatingSystem = isMobile ? 'mobile' : isMac ? 'macos' : isWindows ? 'windows' : 'other'
  const pasteShortcut = isMac ? 'Cmd+V' : 'Ctrl+V'

  // 2. Detect Browser
  let browser: BrowserType = 'other'
  let browserName = '기타 브라우저'
  const extensionUrl: string | null = null
  const supportsExtension = false
  let tipMessage = '원고를 복사한 뒤 네이버 글쓰기 화면에 붙여넣어 직접 게시할 수 있어요.'

  if (isMobile) {
    tipMessage = '모바일 환경에서는 원고 복사와 사진 저장을 완료한 후 네이버 블로그 앱이나 모바일 브라우저에서 직접 게시할 수 있어요.'
  } else if (/Whale\//i.test(ua)) {
    browser = 'whale'
    browserName = '네이버 웨일'
    tipMessage = '네이버 웨일 브라우저를 사용 중이시네요! 원고를 복사한 뒤 네이버 글쓰기 화면에 바로 붙여넣어 게시할 수 있어요.'
  } else if (/Edg\//i.test(ua)) {
    browser = 'edge'
    browserName = '마이크로소프트 엣지'
    tipMessage = '마이크로소프트 엣지 브라우저를 감지했어요. 원고를 복사한 뒤 네이버 글쓰기 화면에 바로 붙여넣어 게시할 수 있어요.'
  } else if (/Chrome\/|CriOS\//i.test(ua)) {
    browser = 'chrome'
    browserName = '구글 크롬'
    tipMessage = '구글 크롬 브라우저를 감지했어요. 원고를 복사한 뒤 네이버 글쓰기 화면에 바로 붙여넣어 게시할 수 있어요.'
  } else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) {
    browser = 'safari'
    browserName = '사파리'
    tipMessage = `사파리 브라우저를 감지했어요. 본문을 복사한 뒤 네이버 글쓰기에서 바로 붙여넣어 주세요. (${pasteShortcut})`
  }

  return {
    browser,
    browserName,
    extensionUrl,
    supportsExtension,
    os,
    pasteShortcut,
    tipMessage,
  }
}
