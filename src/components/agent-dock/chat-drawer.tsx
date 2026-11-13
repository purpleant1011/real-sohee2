'use client'

import React, { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useMediaQuery } from '@/hooks/use-media-query'

export const CHAT_DRAWER_WIDTH_PX = 460

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface ViewportInsets {
  height: number
  bottom: number
}

/** 모바일 가상 키보드가 올라오면 보이는 영역(visualViewport) 기준으로 시트 높이와 하단 오프셋을 계산한다. */
function useVisualViewportInsets(enabled: boolean): ViewportInsets | null {
  const [insets, setInsets] = useState<ViewportInsets | null>(null)
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!enabled || !vv) {
      setInsets(null)
      return
    }
    const update = () =>
      setInsets({
        height: vv.height,
        bottom: Math.max(0, window.innerHeight - vv.height - vv.offsetTop),
      })
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [enabled])
  return insets
}

export interface ChatDrawerProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
}

export function ChatDrawer({ open, onClose, children }: ChatDrawerProps) {
  const reduceMotion = useReducedMotion()
  const isMobile = useMediaQuery('(max-width: 767px)')
  const insets = useVisualViewportInsets(open && isMobile)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const panel = panelRef.current
    if (!open || !isMobile || !panel || panel.contains(document.activeElement)) return
    const target = panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel
    target.focus({ preventScroll: true })
  }, [open, isMobile])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const trapTab = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isMobile || event.key !== 'Tab') return
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || !panelRef.current?.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !panelRef.current?.contains(active))) {
      event.preventDefault()
      first.focus()
    }
  }

  const offscreen = reduceMotion ? { opacity: 0 } : isMobile ? { y: '100%' } : { x: '100%' }
  const onscreen = reduceMotion ? { opacity: 1 } : isMobile ? { y: 0 } : { x: 0 }
  const transition = reduceMotion
    ? { duration: 0.12 }
    : { type: 'spring' as const, stiffness: 380, damping: 38, mass: 0.9 }

  const style: React.CSSProperties = isMobile
    ? insets
      ? { bottom: insets.bottom, height: Math.min(insets.height, window.innerHeight * 0.92) }
      : {}
    : { width: CHAT_DRAWER_WIDTH_PX }

  return (
    <AnimatePresence>
      {open && (
        <React.Fragment key="chat-drawer">
          {isMobile && (
            <motion.button
              type="button"
              data-testid="sohee-chat-drawer-scrim"
              aria-label="대화창 닫기"
              onClick={onClose}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-[45] bg-black/30"
            />
          )}
          <motion.div
            ref={panelRef}
            role="dialog"
            tabIndex={-1}
            aria-label="소희와 대화"
            aria-modal={isMobile ? 'true' : 'false'}
            data-testid="sohee-chat-drawer"
            onKeyDown={trapTab}
            initial={offscreen}
            animate={onscreen}
            exit={offscreen}
            transition={transition}
            style={style}
            className={
              isMobile
                ? 'fixed inset-x-0 bottom-0 z-50 flex h-[92dvh] flex-col overflow-hidden rounded-t-2xl border-t border-[var(--v088-border)] bg-[var(--v088-surface)] shadow-2xl'
                : 'fixed inset-y-0 right-0 z-50 flex max-w-full flex-col overflow-hidden border-l border-[var(--v088-border)] bg-[var(--v088-surface)] shadow-2xl'
            }
          >
            {children}
          </motion.div>
        </React.Fragment>
      )}
    </AnimatePresence>
  )
}
