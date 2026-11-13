'use client'

import { useEffect, useState } from 'react'

export interface ViewportMetrics {
  /** 레이아웃 뷰포트 높이 (window.innerHeight) */
  layoutHeight: number
  /** 시각 뷰포트 높이 (키보드·주소창 반영). 미지원이면 layoutHeight */
  visualHeight: number
  visualOffsetTop: number
  /** 핀치 줌 배율 */
  scale: number
}

export interface ViewportState {
  height: number
  keyboardOpen: boolean
  /** 키보드가 가리는 높이(px). 닫혀 있으면 0 */
  keyboardHeight: number
}

/** 이 값 이상 줄어들어야 키보드로 본다(주소창 접힘 ≈ 50~100px 와 구분). */
export const KEYBOARD_THRESHOLD_PX = 120

export function computeViewport(m: ViewportMetrics, threshold = KEYBOARD_THRESHOLD_PX): ViewportState {
  // 핀치 줌 중에는 visualViewport 가 줄어들어도 키보드가 아니다.
  const zoomed = m.scale > 1.01
  const covered = Math.max(0, m.layoutHeight - m.visualHeight - m.visualOffsetTop)
  const keyboardOpen = !zoomed && covered >= threshold
  return {
    height: Math.round(zoomed ? m.layoutHeight : m.visualHeight),
    keyboardOpen,
    keyboardHeight: keyboardOpen ? Math.round(covered) : 0,
  }
}

function readMetrics(): ViewportMetrics {
  const vv = window.visualViewport
  return {
    layoutHeight: window.innerHeight,
    visualHeight: vv ? vv.height : window.innerHeight,
    visualOffsetTop: vv ? vv.offsetTop : 0,
    scale: vv ? vv.scale : 1,
  }
}

const SSR_STATE: ViewportState = { height: 0, keyboardOpen: false, keyboardHeight: 0 }

/**
 * visualViewport 기반 단일 엔진. 셸 루트에서 한 번만 호출하고 하위는 useKeyboard() 로 읽는다.
 * height 가 0 이면 아직 측정 전(SSR/첫 페인트) → CSS 의 100dvh 를 사용.
 */
export function useViewport(): ViewportState {
  const [state, setState] = useState<ViewportState>(SSR_STATE)
  useEffect(() => {
    const update = () => setState(prev => {
      const next = computeViewport(readMetrics())
      return prev.height === next.height && prev.keyboardOpen === next.keyboardOpen && prev.keyboardHeight === next.keyboardHeight ? prev : next
    })
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
  }, [])
  return state
}
