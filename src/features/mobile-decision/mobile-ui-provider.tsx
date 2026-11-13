'use client'

import { createContext, useContext, type ReactNode } from 'react'
const MobileUiContext = createContext({ enabled: false })
export function MobileUiProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <MobileUiContext.Provider value={{ enabled }}>{children}</MobileUiContext.Provider>
}
export const useMobileUi = () => useContext(MobileUiContext)
