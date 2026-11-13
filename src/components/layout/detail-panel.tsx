'use client'

import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import styles from './detail-panel.module.css'

type DetailPanelProps = Readonly<{
  children: ReactNode
  description?: ReactNode
  onOpenChange: (open: boolean) => void
  open: boolean
  restoreFocusFallbackSelector?: string
  title: string
}>

const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true',
  )
}

let scrollLockCount = 0
let previousHtmlOverflow = ''
let previousBodyOverflow = ''

function lockDocumentScroll() {
  if (scrollLockCount === 0) {
    previousHtmlOverflow = document.documentElement.style.overflow
    previousBodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
  }
  scrollLockCount += 1
}

function unlockDocumentScroll() {
  if (scrollLockCount === 0) return
  scrollLockCount -= 1
  if (scrollLockCount === 0) {
    document.documentElement.style.overflow = previousHtmlOverflow
    document.body.style.overflow = previousBodyOverflow
  }
}

export function DetailPanel({
  children,
  description,
  onOpenChange,
  open,
  restoreFocusFallbackSelector,
  title,
}: DetailPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const focusRestoreFrameRef = useRef<number | null>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    if (!open || typeof document === 'undefined') return

    if (focusRestoreFrameRef.current !== null) cancelAnimationFrame(focusRestoreFrameRef.current)
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const firstControl = panelRef.current ? getFocusableElements(panelRef.current)[0] : null
    ;(firstControl ?? panelRef.current)?.focus()

    return () => {
      const restoreTarget = restoreFocusRef.current
      focusRestoreFrameRef.current = requestAnimationFrame(() => {
        focusRestoreFrameRef.current = null
        if (restoreTarget?.isConnected) restoreTarget.focus()
        else if (restoreFocusFallbackSelector) document.querySelector<HTMLElement>(restoreFocusFallbackSelector)?.focus()
      })
    }
  }, [open, restoreFocusFallbackSelector])

  useEffect(() => {
    if (!open) return
    lockDocumentScroll()
    return unlockDocumentScroll
  }, [open])

  if (!open) return null

  function close() {
    onOpenChange(false)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (event.key !== 'Tab' || !panelRef.current) return

    const focusable = getFocusableElements(panelRef.current)
    if (focusable.length === 0) {
      event.preventDefault()
      panelRef.current.focus()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className={styles.backdrop}
      data-testid="detail-panel-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div
        ref={panelRef}
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={styles.panel}
        role="dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <header className={styles.header}>
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <div className={styles.description} id={descriptionId}>{description}</div> : null}
          </div>
          <button className={styles.closeButton} type="button" aria-label="상세 정보 닫기" onClick={close}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  )
}
