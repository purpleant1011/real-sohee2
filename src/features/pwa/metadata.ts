import type { Metadata, Viewport } from 'next'
import { PWA_DARK_THEME_COLOR, PWA_LIGHT_THEME_COLOR } from './constants'

/** 홈 화면 설치 메타. 설치 ID는 manifest.id('/')로 고정되어 있어 여기서 바꾸지 않는다. */
export const pwaMetadata: Pick<Metadata, 'manifest' | 'applicationName' | 'appleWebApp' | 'formatDetection' | 'icons' | 'other'> = {
  manifest: '/manifest.webmanifest',
  applicationName: '소희',
  appleWebApp: {
    capable: true,
    title: '소희',
    statusBarStyle: 'default',
    startupImage: [
      ...[
        [430, 932, 3], [428, 926, 3], [414, 896, 3], [414, 896, 2], [393, 852, 3], [390, 844, 3],
        [375, 812, 3], [375, 667, 2], [320, 568, 2],
      ].map(([w, h, d]) => ({
        url: `/splash/splash-${w * d}x${h * d}.png`,
        media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${d}) and (orientation: portrait)`,
      })),
      ...[[820, 1180, 2], [834, 1194, 2], [1024, 1366, 2]].map(([w, h, d]) => ({
        url: `/splash/splash-${w * d}x${h * d}.png`,
        media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${d}) and (orientation: portrait)`,
      })),
    ],
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [{ url: '/icons/sohee-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  other: {
    // Next 는 appleWebApp.capable 을 apple 전용 meta 로 직렬화하지 않는다. iOS 홈 화면 설치에 필요하므로 명시한다.
    // (mobile-web-app-capable 은 Next 가 appleWebApp.capable 로 이미 내보내므로 여기서 중복 선언하지 않는다.)
    'apple-mobile-web-app-capable': 'yes',
  },
}

/** viewport-fit=cover: 설치형 standalone 에서 safe-area(env(safe-area-inset-*)) 를 CSS 가 쓸 수 있게 한다. 확대는 막지 않는다(접근성). */
export const pwaViewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: PWA_LIGHT_THEME_COLOR },
    { media: '(prefers-color-scheme: dark)', color: PWA_DARK_THEME_COLOR },
  ],
}
