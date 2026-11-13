'use client'

import { useEffect, type MouseEvent } from 'react'
import { safeReturnPath } from './selectors'

export const DECISION_RETURN_TTL_MS = 5 * 60 * 1000

export type ReturnPoint = {
  workspaceId: string
  itemId: string
  href: string
  scrollY: number
  expiresAt?: number
}

let remembered: ReturnPoint | null = null
let restoring: ReturnPoint | null = null

function isExpired(point: ReturnPoint, now = Date.now()): boolean {
  return typeof point.expiresAt === 'number' && Number.isFinite(point.expiresAt) && now > point.expiresAt
}

function getCurrentHref(): string {
  if (typeof window !== 'undefined' && window.location) {
    return window.location.pathname + window.location.search
  }
  if (typeof location !== 'undefined') {
    return location.pathname + location.search
  }
  return ''
}

// Presentation-only memory: never used for authorization or workflow state.
export function rememberDecisionReturn(workspaceId: string, itemId: string, href: string, scrollY: number, now = Date.now()) {
  restoring = null
  remembered = safeReturnPath(href) === href
    ? {
        workspaceId,
        itemId,
        href,
        scrollY: Number.isFinite(scrollY) ? Math.max(0, scrollY) : 0,
        expiresAt: now + DECISION_RETURN_TTL_MS,
      }
    : null
}

export function consumeDecisionReturn(workspaceId: string, itemId: string, now = Date.now()): string | null {
  const point = remembered
  remembered = null
  if (!point || isExpired(point, now)) return null
  if (point.workspaceId !== workspaceId || point.itemId !== itemId) return null
  restoring = point
  return point.href
}

export function takeDecisionRestore(workspaceId: string, href: string, now = Date.now()): ReturnPoint | null {
  if (restoring) {
    if (isExpired(restoring, now)) {
      restoring = null
      return null
    }
    if (restoring.workspaceId === workspaceId && restoring.href === href) {
      const point = restoring
      restoring = null
      return point
    }
    return null
  }

  if (remembered) {
    if (isExpired(remembered, now)) {
      remembered = null
      return null
    }
    if (remembered.workspaceId === workspaceId && remembered.href === href) {
      const point = remembered
      remembered = null
      return point
    }
    return null
  }

  return null
}

export function putBackDecisionRestore(point: ReturnPoint | null, now = Date.now()) {
  if (point && !restoring && !isExpired(point, now) && safeReturnPath(point.href) === point.href) {
    restoring = point
  }
}

export function rememberDecisionClick(event: MouseEvent<HTMLAnchorElement>, workspaceId: string, itemId: string) {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
  const el = event.currentTarget
  const scroller = el?.closest?.('main') ?? (typeof document !== 'undefined' ? (document.querySelector('[data-mobile-shell] main') ?? document.querySelector('main')) : null)
  const scrollY = scroller && Number.isFinite(scroller.scrollTop) && scroller.scrollTop > 0
    ? scroller.scrollTop
    : (typeof window !== 'undefined' ? window.scrollY : 0)
  const currentHref = getCurrentHref()
  if (!currentHref) return
  rememberDecisionReturn(workspaceId, itemId, currentHref, scrollY)
}

export function useRestoreDecisionPosition(workspaceId: string, ready: boolean) {
  useEffect(() => {
    if (!ready) return
    const currentHref = getCurrentHref()
    if (!currentHref) return
    const point = takeDecisionRestore(workspaceId, currentHref)
    if (!point) return

    let applied = false
    let frame = 0
    let attempts = 0
    const maxAttempts = 3

    const apply = () => {
      const target = document.getElementById(`mobile-decision-${point.itemId}`)
      const scroller = document.querySelector('[data-mobile-shell] main') ?? document.querySelector('main')

      if (target) {
        applied = true
        if (scroller && Number.isFinite(point.scrollY)) scroller.scrollTop = point.scrollY
        if (typeof window.scrollTo === 'function') {
          try { window.scrollTo({ top: point.scrollY }) } catch { /* ignore jsdom/env */ }
        }
        target.focus({ preventScroll: true })
        return
      }

      attempts++
      if (attempts < maxAttempts) {
        frame = requestAnimationFrame(apply)
      } else {
        applied = true
        if (scroller && Number.isFinite(point.scrollY)) scroller.scrollTop = point.scrollY
        if (typeof window.scrollTo === 'function') {
          try { window.scrollTo({ top: point.scrollY }) } catch { /* ignore jsdom/env */ }
        }
      }
    }

    frame = requestAnimationFrame(apply)
    return () => {
      cancelAnimationFrame(frame)
      if (!applied) putBackDecisionRestore(point)
    }
  }, [workspaceId, ready])
}
