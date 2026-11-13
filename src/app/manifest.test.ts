import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PWA_BACKGROUND_COLOR,
  PWA_DARK_THEME_COLOR,
  PWA_LIGHT_THEME_COLOR,
  PWA_SW_SCOPE,
} from '@/features/pwa/constants'
import { pwaMetadata, pwaViewport } from '@/features/pwa/metadata'

type ManifestIcon = {
  src: string
  sizes: string
  type: string
  purpose?: string
}

type ManifestShortcut = {
  name: string
  url: string
  icons?: ManifestIcon[]
}

type WebManifest = {
  name?: string
  short_name?: string
  description?: string
  id?: string
  scope?: string
  start_url?: string
  display?: string
  display_override?: string[]
  theme_color?: string
  background_color?: string
  lang?: string
  categories?: string[]
  launch_handler?: { client_mode?: string }
  prefer_related_applications?: boolean
  orientation?: string
  icons?: ManifestIcon[]
  shortcuts?: ManifestShortcut[]
}

function readPngHeader(path: string) {
  const bytes = readFileSync(path)

  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR')

  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    // 0·2·3 = 알파 채널 없음, 4·6 = 알파 채널 있음
    colorType: bytes[25],
  }
}

const manifestPath = resolve(process.cwd(), 'public/manifest.webmanifest')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as WebManifest

describe('install manifest', () => {
  it('keeps the install identity stable', () => {
    // id 가 바뀌면 이미 설치한 사용자에게 앱이 중복 설치된다.
    expect(manifest.id).toBe('/')
    expect(manifest.scope).toBe(PWA_SW_SCOPE)
    expect(manifest.start_url).toBe('/app?launch=pwa')
    expect(manifest.lang).toBe('ko')
    expect(manifest.display).toBe('standalone')
    expect(manifest.display_override).toEqual(['standalone', 'minimal-ui'])
    // 방향을 강제하면 접근성(가로 사용·회전)이 막힌다.
    expect(manifest.orientation).toBeUndefined()
  })

  it('keeps the home-screen label short and reuses the open window on launch', () => {
    expect(manifest.name).toBe('소희')
    expect(manifest.short_name).toBe('소희')
    // iOS 홈 화면은 이름을 대략 12자에서 자른다. 넘기면 설치 라벨이 말줄임으로 깨진다.
    expect((manifest.short_name ?? '').length).toBeLessThanOrEqual(12)
    expect((manifest.description ?? '').length).toBeGreaterThan(10)

    // 이미 열린 앱이 있으면 새 창을 만들지 않고 그 창을 이어 쓴다(중복 창·중복 설치 방지).
    expect(manifest.launch_handler).toEqual({ client_mode: 'navigate-existing' })

    // 관련 네이티브 앱을 밀면 브라우저 설치형 PWA 진입 자체가 숨겨진다.
    expect(manifest.prefer_related_applications).not.toBe(true)
    // 설치 목록 분류는 앱스토어/OS 노출에 쓰인다.
    expect(manifest.categories).toEqual(expect.arrayContaining(['business']))
  })

  it('declares locally derived PNG icons that are valid at their install sizes', () => {
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: '/icons/sohee-192.png', sizes: '192x192', type: 'image/png' }),
        expect.objectContaining({ src: '/icons/sohee-512.png', sizes: '512x512', type: 'image/png' }),
      ]),
    )

    for (const icon of manifest.icons ?? []) {
      expect(icon.purpose).toMatch(/\b(any|maskable)\b/)
      const [width, height] = icon.sizes.split('x').map(Number)
      expect(readPngHeader(resolve(process.cwd(), 'public', icon.src.slice(1)))).toMatchObject({ width, height })
    }
  })

  it('ships separate any and maskable icon files instead of mixing purposes', () => {
    const icons = manifest.icons ?? []
    const anyIcons = icons.filter((icon) => icon.purpose === 'any')
    const maskableIcons = icons.filter((icon) => icon.purpose === 'maskable')

    expect(icons.every((icon) => icon.purpose === 'any' || icon.purpose === 'maskable')).toBe(true)
    expect(anyIcons.map((icon) => icon.sizes).sort()).toEqual(['192x192', '512x512'])
    expect(maskableIcons.map((icon) => icon.sizes).sort()).toEqual(['192x192', '512x512'])

    // maskable 은 OS 가 잘라 내므로 불투명 배경이어야 하고, any 아이콘은 투명 여백을 쓸 수 있다.
    for (const icon of maskableIcons) {
      const { colorType } = readPngHeader(resolve(process.cwd(), 'public', icon.src.slice(1)))
      expect([0, 2, 3]).toContain(colorType)
    }
  })

  it('keeps theme colors aligned with the app constants', () => {
    expect(manifest.theme_color).toBe(PWA_LIGHT_THEME_COLOR)
    expect(manifest.background_color).toBe(PWA_BACKGROUND_COLOR)
    expect(PWA_LIGHT_THEME_COLOR).toBe('#6656e8')
    expect(PWA_DARK_THEME_COLOR).toBe('#0c0d10')
  })

  it('points every shortcut at an internal app route', () => {
    expect(manifest.shortcuts?.length).toBeGreaterThan(0)
    for (const shortcut of manifest.shortcuts ?? []) {
      expect(shortcut.url.startsWith('/app')).toBe(true)
      expect(shortcut.url.includes('%')).toBe(false)
      expect(shortcut.name.length).toBeGreaterThan(0)
    }
  })
})

describe('apple install metadata', () => {
  it('declares an opaque apple touch icon at 180x180', () => {
    // Next.js Metadata 의 icons/appleWebApp 은 union 타입이라 테스트에서 좁혀 쓴다.
    const apple = (pwaMetadata.icons as { apple?: Array<{ url: string; sizes?: string }> } | undefined)?.apple
    const icons = Array.isArray(apple) ? apple : apple ? [apple] : []
    expect(icons).toEqual(
      expect.arrayContaining([expect.objectContaining({ url: '/icons/apple-touch-icon.png', sizes: '180x180' })]),
    )

    // iOS 는 투명 픽셀을 검정으로 채우므로 알파 채널이 없는 불투명 PNG 여야 한다.
    const header = readPngHeader(resolve(process.cwd(), 'public/icons/apple-touch-icon.png'))
    expect(header).toMatchObject({ width: 180, height: 180 })
    expect([0, 2, 3]).toContain(header.colorType)
  })

  it('keeps the installed viewport covered by safe-area insets and still zoomable', () => {
    // viewport-fit=cover 가 없으면 standalone 에서 env(safe-area-inset-*) 가 0 이라 홈 인디케이터가 CTA 를 가린다.
    expect(pwaViewport.viewportFit).toBe('cover')
    expect(pwaViewport.width).toBe('device-width')
    expect(pwaViewport.initialScale).toBe(1)
    // 확대를 막으면 접근성 위반이므로 maximum-scale/user-scalable 을 고정하지 않는다.
    expect(pwaViewport.maximumScale).toBeUndefined()
    expect(pwaViewport.userScalable).toBeUndefined()
  })

  it('declares a status-bar theme color for both color schemes', () => {
    // manifest 의 theme_color 는 하나뿐이라 dark 는 viewport meta 로 내려야 한다.
    const themeColors = Array.isArray(pwaViewport.themeColor) ? pwaViewport.themeColor : [pwaViewport.themeColor]

    expect(themeColors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ media: '(prefers-color-scheme: light)', color: PWA_LIGHT_THEME_COLOR }),
        expect.objectContaining({ media: '(prefers-color-scheme: dark)', color: PWA_DARK_THEME_COLOR }),
      ]),
    )
  })

  it('links startup images that exist at the declared pixel sizes', () => {
    const startupImages = (
      pwaMetadata.appleWebApp as { startupImage?: string | Array<string | { url: string }> } | undefined
    )?.startupImage
    expect(Array.isArray(startupImages)).toBe(true)
    const images = Array.isArray(startupImages) ? startupImages : [startupImages]

    for (const image of images) {
      expect(image).toBeDefined()
      if (!image) continue
      const url = typeof image === 'string' ? image : image.url
      const match = /\/splash\/splash-(\d+)x(\d+)\.png$/.exec(url)
      expect(match, `unexpected startup image url: ${url}`).not.toBeNull()
      const [width, height] = [Number(match![1]), Number(match![2])]
      const header = readPngHeader(resolve(process.cwd(), 'public', url.slice(1)))
      expect(header).toMatchObject({ width, height })
    }
  })
})
