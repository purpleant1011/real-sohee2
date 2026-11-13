import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import Script from 'next/script'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { PwaRuntime } from '@/features/pwa/pwa-runtime'
import { pwaMetadata, pwaViewport } from '@/features/pwa/metadata'

const pretendard = localFont({
  src: '../../public/fonts/PretendardVariable.woff2',
  display: 'swap',
  variable: '--font-pretendard',
  weight: '45 920',
})

const themePrepaintScript = `(function(){try{var value=localStorage.getItem('sohee-theme');if(navigator.standalone===true){value=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(value==='dark'){document.documentElement.classList.add('dark');document.documentElement.dataset.theme='dark';document.documentElement.style.colorScheme='dark';}else{document.documentElement.classList.remove('dark');document.documentElement.dataset.theme='light';document.documentElement.style.colorScheme='light';}}catch(_error){}})()`

export const metadata: Metadata = {
  metadataBase: new URL('https://example.com'),
  title: '소희 | 여러 마케팅 채널을 한곳에서',
  description: '소희가 고객 문의, 예약, 콘텐츠, 게시 일정과 성과를 한곳에 모아 오늘 해야 할 일부터 정리합니다.',
  ...pwaMetadata,
  openGraph: {
    title: '소희 | 여러 마케팅 채널을 한곳에서',
    description: '고객 답변에서 예약, 다음 콘텐츠와 성장 행동까지 소희와 한 흐름으로 이어가세요.',
    url: 'https://example.com/',
    siteName: '소희',
    locale: 'ko_KR',
    type: 'website',
    images: [{
      url: '/images/marketing/v085/sohee-marketing-og-v1.png',
      width: 1731,
      height: 909,
      alt: '여러 마케팅 채널을 고객 대화, 예약과 성장으로 연결하는 소희',
    }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '소희 | 여러 마케팅 채널을 한곳에서',
    description: '고객 문의, 예약, 콘텐츠와 성과를 한곳에서 운영하세요.',
    images: ['/images/marketing/v085/sohee-marketing-og-v1.png'],
  },
}

export const viewport: Viewport = pwaViewport

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <Script id="theme-preference" strategy="beforeInteractive">
          {themePrepaintScript}
        </Script>
      </head>
      <body className={pretendard.variable}>
        <ThemeProvider defaultTheme="light" storageKey="sohee-theme">
          {children}
          <PwaRuntime />
          <Toaster position="top-center" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  )
}
