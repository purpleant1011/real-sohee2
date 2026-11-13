'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { useMediaQuery } from '@/hooks/use-media-query'

const MobileR2Context = createContext({ enabled: false, initialMobile: false, forceMobile: false, forcePc: false })

/** initialMobile은 첫 HTML의 표현 힌트일 뿐, 서버의 R2 허용 판정을 대체하지 않는다. */
export function MobileR2Provider({ enabled, initialMobile = false, forceMobile = false, forcePc = false, children }: { enabled: boolean; initialMobile?: boolean; forceMobile?: boolean; forcePc?: boolean; children: ReactNode }) {
  return <MobileR2Context.Provider value={{ enabled, initialMobile, forceMobile, forcePc }}>{children}</MobileR2Context.Provider>
}

/** 서버가 지정한 모바일 호스트(m.example.com)는 모바일로, PC 호스트(example.com)는 PC 버전으로 고정한다. */
export function useMobileR2Active(): boolean {
  const { enabled, initialMobile, forceMobile, forcePc } = useContext(MobileR2Context)
  if (!enabled) return false
  if (forceMobile) return true
  if (forcePc) return false
  const narrow = useMediaQuery('(max-width: 767px)', initialMobile)
  return narrow
}

/** 현재 호스트가 모바일 전용 호스트(m.example.com)인지 확인하는 훅 */
export function useIsForceMobile(): boolean {
  const { forceMobile } = useContext(MobileR2Context)
  return forceMobile
}

