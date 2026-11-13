'use client'

import { useEffect } from 'react'
import { isSlowConnection, readOnline } from '@/features/pwa/network'
import { SHELL_TABS } from './tabs'
import type { TabId } from './types'

type CodeLoaders = Readonly<Record<TabId, () => Promise<unknown>>>

/** Code only: no router/RSC prefetch, API response, workspace data or persistent state. */
export function createTabCodePrewarmer(loaders: CodeLoaders) {
  const tasks = new Map<TabId, Promise<boolean>>()
  return (tab: TabId): Promise<boolean> => {
    const existing = tasks.get(tab)
    if (existing) return existing
    const task = Promise.resolve().then(loaders[tab]).then(
      () => true,
      () => { tasks.delete(tab); return false },
    )
    tasks.set(tab, task)
    return task
  }
}

const warmCode = createTabCodePrewarmer({
  today: () => import('@/features/mobile-decision/mobile-home-view'),
  work: () => import('@/features/mobile-hub/hub-view'),
  customers: () => import('@/features/mobile-customers/customers-view'),
  results: () => import('@/features/mobile-results/results-view'),
  more: () => import('@/features/mobile-settings/more-view'),
})

export function warmR2TabCode(tab: TabId): Promise<boolean> {
  if (!readOnline() || isSlowConnection()) return Promise.resolve(false)
  return warmCode(tab)
}

/** Warm one static module at a time, only on an authorized, visible browsing surface. */
export function useR2TabCodeWarmup(
  scope: string | null,
  currentTab: TabId | null,
  warm: (tab: TabId) => Promise<boolean> = warmR2TabCode,
): void {
  useEffect(() => {
    if (!scope) return
    const queue = SHELL_TABS.map(tab => tab.id).filter(tab => tab !== currentTab)
    let cancelled = false
    let idle: number | undefined
    let timer: number | undefined
    const canRun = () => !cancelled && document.visibilityState === 'visible' && readOnline() && !isSlowConnection()
    const schedule = () => {
      if (!canRun() || !queue.length || idle !== undefined || timer !== undefined) return
      const run = () => {
        idle = undefined
        timer = undefined
        if (!canRun()) return
        const tab = queue.shift()
        if (tab) void Promise.resolve().then(() => warm(tab)).then(schedule, schedule)
      }
      if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(run, { timeout: 2_000 })
      else timer = window.setTimeout(run, 1_200)
    }
    document.addEventListener('visibilitychange', schedule)
    window.addEventListener('online', schedule)
    schedule()
    return () => {
      cancelled = true
      if (idle !== undefined) window.cancelIdleCallback?.(idle)
      if (timer !== undefined) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', schedule)
      window.removeEventListener('online', schedule)
    }
  }, [scope, currentTab, warm])
}
