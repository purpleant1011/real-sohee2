'use client'

import { useEffect, useRef, type RefObject } from 'react'

export interface ComposerScrollClearanceOptions {
  messageListRef?: RefObject<HTMLElement | null>
  messagesLength?: number
  latestMessageRole?: string
}

let cachedSafeAreaBottom: number | null = null

export function resetSafeAreaBottomCacheForTesting() {
  cachedSafeAreaBottom = null
}

export function getSafeAreaBottom(): number {
  if (typeof document === 'undefined' || !document.body) return 0
  if (cachedSafeAreaBottom !== null) return cachedSafeAreaBottom
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;bottom:0;left:0;width:0;height:0;padding-bottom:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none;'
  document.body.appendChild(probe)
  const val = parseFloat(window.getComputedStyle(probe).paddingBottom) || 0
  probe.remove()
  cachedSafeAreaBottom = val
  return val
}

function findScrollContainer(node: HTMLElement | null): HTMLElement | null {
  if (typeof window === 'undefined') return null
  let parent = node?.parentElement
  while (parent && parent !== document.body && parent !== document.documentElement) {
    const style = window.getComputedStyle(parent)
    if (style.overflowY === 'auto' || style.overflowY === 'scroll') return parent
    parent = parent.parentElement
  }
  return null
}

function resolveMessageList(
  element: HTMLElement | null,
  messageListRef?: RefObject<HTMLElement | null>
): HTMLElement | null {
  if (messageListRef?.current) return messageListRef.current
  if (!element || typeof document === 'undefined') return null
  return element.closest('section')?.querySelector('ol')
    ?? element.parentElement?.querySelector('ol')
    ?? null
}

function isNearBottom(container: HTMLElement | null): boolean {
  if (typeof window === 'undefined') return true
  if (container) {
    const distance = container.scrollHeight - (container.scrollTop + container.clientHeight)
    return distance <= 160
  }
  const scroller = document.scrollingElement || document.documentElement
  if (!scroller) return true
  const distance = scroller.scrollHeight - (window.scrollY + window.innerHeight)
  return distance <= 160
}

/** Let native focus/scrollIntoView account for the fixed mobile input, without owning chat scrolling. */
export function useComposerScrollClearance(
  ref: RefObject<HTMLElement | null>,
  mobile: boolean,
  keyboardHeight: number,
  options?: ComposerScrollClearanceOptions
) {
  const messageListRef = options?.messageListRef
  const messagesLength = options?.messagesLength
  const latestMessageRole = options?.latestMessageRole

  // 1. Single clearance source: apply only CSS variable --conversation-scroll-clearance to root.
  useEffect(() => {
    const element = ref.current
    if (!mobile || !element) return
    const root = document.documentElement
    const previousClearance = root.style.getPropertyValue('--conversation-scroll-clearance')

    let applied = ''
    const measure = () => {
      // Full-width bottom bar includes safe-area-inset-bottom internally.
      // The shell/viewport already shrinks when the visual viewport resizes.
      // Therefore clearance equals the bar's real rendered height only,
      // and keyboardHeight must not inflate clearance a second time.
      applied = `${Math.max(0, Math.ceil(element.getBoundingClientRect().height))}px`
      root.style.setProperty('--conversation-scroll-clearance', applied)
    }

    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(element)

    return () => {
      observer?.disconnect()
      if (root.style.getPropertyValue('--conversation-scroll-clearance') === applied) {
        if (previousClearance) root.style.setProperty('--conversation-scroll-clearance', previousClearance)
        else root.style.removeProperty('--conversation-scroll-clearance')
      }
    }
  }, [ref, mobile, keyboardHeight])

  // 2. Track whether the user is near bottom before a new message arrives.
  const wasNearBottomRef = useRef(true)
  useEffect(() => {
    if (!mobile) return
    const element = ref.current
    const listEl = resolveMessageList(element, messageListRef)
    const container = findScrollContainer(listEl ?? element)
    const target: EventTarget = container ?? window

    const handleScroll = () => {
      wasNearBottomRef.current = isNearBottom(container)
    }

    wasNearBottomRef.current = isNearBottom(container)
    target.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      target.removeEventListener('scroll', handleScroll)
    }
  }, [mobile, ref, messageListRef])

  // 3. Scroll only on mobile, only if user was near bottom or if it's the user's own send.
  const prevLength = useRef(messagesLength ?? 0)
  useEffect(() => {
    if (!mobile) {
      prevLength.current = messagesLength ?? 0
      return
    }

    const element = ref.current
    if (messagesLength !== undefined && messagesLength > prevLength.current) {
      const isUserSend = latestMessageRole === 'user'
      const isAssistantReply = latestMessageRole === 'sohee'
      const shouldScroll = isUserSend || (isAssistantReply && wasNearBottomRef.current)

      if (shouldScroll) {
        const listEl = resolveMessageList(element, messageListRef)
        if (listEl) {
          const cards = listEl.querySelectorAll('.messageRow, [class*="messageRow"], [class*="messageCard"], [class*="interviewCard"]')
          const lastCard = cards.length > 0 ? (cards[cards.length - 1] as HTMLElement) : null
          if (lastCard && typeof lastCard.scrollIntoView === 'function') {
            lastCard.scrollIntoView({ block: 'start', behavior: 'smooth' })
          }
        }
      }
    }
    prevLength.current = messagesLength ?? 0
  }, [ref, mobile, messagesLength, latestMessageRole, messageListRef])
}

