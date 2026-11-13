'use client'

import { useEffect, useState } from 'react'
import { chatComposer, chatScreenConfig, MobileChatView } from '@/features/mobile-chat/mobile-chat-view'
import { MobileAppShell, ShellScreen, useShellViewport } from '@/features/mobile-shell'

/**
 * M10 키보드·safe-area 로컬 증거용 화면 (ANI-1687).
 *
 * 실제 셸(`MobileAppShell` + CHAT 모드 컴포저 슬롯)을 그대로 올리고, 그 위에 측정값만 덧붙인다.
 * 서버 조회·전송은 하지 않는다(onSend 는 즉시 성공으로 돌려주고 아무 데도 쓰지 않는다).
 * 아이폰 실기기 없이도 레이아웃 뷰포트/시각 뷰포트/전송 버튼 위치를 같은 코드로 읽기 위한 화면이다.
 */

interface Metrics {
  innerWidth: number
  innerHeight: number
  visualHeight: number | null
  visualOffsetTop: number | null
  visualScale: number | null
  composerTop: number | null
  composerBottom: number | null
  sendVisible: boolean | null
}

function readMetrics(): Metrics {
  const vv = typeof window === 'undefined' ? undefined : window.visualViewport
  const send = document.querySelector<HTMLElement>('[data-shell-composer] button[aria-label="보내기"]')
  const rect = send?.getBoundingClientRect() ?? null
  // 시각 뷰포트 안에 전송 버튼의 아랫변이 들어와야 키보드가 떠도 누를 수 있다.
  const visibleBottom = vv ? vv.height + vv.offsetTop : window.innerHeight
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    visualHeight: vv ? Math.round(vv.height) : null,
    visualOffsetTop: vv ? Math.round(vv.offsetTop) : null,
    visualScale: vv ? Math.round(vv.scale * 100) / 100 : null,
    composerTop: rect ? Math.round(rect.top) : null,
    composerBottom: rect ? Math.round(rect.bottom) : null,
    sendVisible: rect ? rect.bottom <= visibleBottom + 1 && rect.top >= 0 : null,
  }
}

function SafeAreaProbe() {
  const viewport = useShellViewport()
  const [metrics, setMetrics] = useState<Metrics | null>(null)

  useEffect(() => {
    const update = () => setMetrics(readMetrics())
    update()
    const vv = window.visualViewport
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [viewport.height, viewport.keyboardOpen])

  const rows: Array<[string, string]> = [
    ['window.innerWidth', metrics ? String(metrics.innerWidth) : '측정 전'],
    ['window.innerHeight', metrics ? String(metrics.innerHeight) : '측정 전'],
    ['visualViewport.height', metrics?.visualHeight === null || metrics?.visualHeight === undefined ? '지원 안 함' : String(metrics.visualHeight)],
    ['visualViewport.offsetTop', metrics?.visualOffsetTop === null || metrics?.visualOffsetTop === undefined ? '지원 안 함' : String(metrics.visualOffsetTop)],
    ['visualViewport.scale', metrics?.visualScale === null || metrics?.visualScale === undefined ? '지원 안 함' : String(metrics.visualScale)],
    ['셸이 판정한 키보드', viewport.keyboardOpen ? `열림 (${viewport.keyboardHeight}px)` : '닫힘'],
    ['셸 높이(px)', String(viewport.height || '미측정')],
    ['data-keyboard', viewport.keyboardOpen ? 'open' : 'closed'],
    ['전송 버튼 top / bottom', metrics?.composerTop === null || metrics?.composerTop === undefined ? '없음' : `${metrics.composerTop} / ${metrics.composerBottom}`],
    ['전송 버튼이 시각 뷰포트 안', metrics?.sendVisible === null || metrics?.sendVisible === undefined ? '없음' : metrics.sendVisible ? '예' : '아니오'],
  ]

  return (
    <section aria-label="키보드·safe-area 측정값" data-safe-area-probe className="my-4 rounded-xl border border-border bg-muted/40 p-3">
      <h2 className="mb-2 text-sm font-semibold">키보드·safe-area 측정값</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd data-metric={label} className="font-mono">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

const EMPTY_SNAPSHOT = { loadState: 'ready' as const, bubbles: [], complete: true, checkedAt: null }

export function MobileChatSafeAreaPreview() {
  const { mode, title } = chatScreenConfig()
  // 개발 화면이므로 전송은 아무 데도 쓰지 않는다.
  const noSend = async () => ({ ok: true as const })

  return (
    <MobileAppShell>
      <ShellScreen mode={mode} title={title} composer={chatComposer(noSend)}>
        <SafeAreaProbe />
        <MobileChatView snapshot={EMPTY_SNAPSHOT} onSend={noSend} showComposer={false} />
      </ShellScreen>
    </MobileAppShell>
  )
}
