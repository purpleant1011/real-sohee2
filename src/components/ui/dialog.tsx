'use client'

import { useEffect, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { Button, Dialog as AriaDialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { X } from 'lucide-react'
import styles from './dialog.module.css'

const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [contenteditable="true"], [tabindex]:not([tabindex="-1"])'

function isKeyboardTarget(element: HTMLElement, scope: HTMLElement) {
  if (element.matches(':disabled, input[type="hidden"]') || (element.hasAttribute('tabindex') && element.tabIndex < 0)) return false
  if (element.tagName === 'SUMMARY' && Array.from(element.parentElement?.children ?? []).find(node => node.tagName === 'SUMMARY') !== element) return false
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.hidden || node.inert || node.getAttribute('aria-hidden') === 'true') return false
    const style = getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false
    if (node.tagName === 'DETAILS' && !(node as HTMLDetailsElement).open) {
      const summary = Array.from(node.children).find(child => child.tagName === 'SUMMARY')
      if (!summary?.contains(element)) return false
    }
    if (node === scope) break
  }
  return true
}

let scrollLockCount = 0
let previousBodyOverflow = ''

function lockBodyScroll() {
  if (scrollLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  scrollLockCount += 1
}

function unlockBodyScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1)
  if (scrollLockCount === 0) document.body.style.overflow = previousBodyOverflow
}

type DialogProps = {
  children: ReactNode
  onOpenChange: (open: boolean) => void
  open: boolean
  restoreFocusFallbackSelector?: string
  title: string
}

export function Dialog({ children, onOpenChange, open, restoreFocusFallbackSelector, title }: DialogProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (open && document.activeElement instanceof HTMLElement) restoreFocusRef.current = document.activeElement
  }, [open])

  useEffect(() => {
    if (!open) return
    lockBodyScroll()
    return unlockBodyScroll
  }, [open])

  function changeOpen(nextOpen: boolean) {
    onOpenChange(nextOpen)
    if (nextOpen || !restoreFocusFallbackSelector) return
    const originalTarget = restoreFocusRef.current
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const originalVisible = originalTarget?.isConnected && originalTarget.matches(focusableSelector) && isKeyboardTarget(originalTarget, document.body)
      if (!originalVisible) {
        const fallback = Array.from(document.querySelectorAll<HTMLElement>(restoreFocusFallbackSelector))
          .find(element => element.matches(focusableSelector) && isKeyboardTarget(element, document.body))
        fallback?.focus()
      }
    }))
  }

  function keepTabInside(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab' || !dialogRef.current) return
    const scope = dialogRef.current
    const focusable = Array.from(scope.querySelectorAll<HTMLElement>(focusableSelector)).filter(element => isKeyboardTarget(element, scope))
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable.at(-1)!
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault()
      event.stopPropagation()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      event.stopPropagation()
      first.focus()
    } else if (!event.shiftKey) {
      const index = focusable.indexOf(document.activeElement as HTMLElement)
      if (index >= 0 && index < focusable.length - 1) {
        event.preventDefault()
        event.stopPropagation()
        focusable[index + 1].focus()
      }
    }
  }

  return (
    <ModalOverlay
      className={styles.overlay}
      data-testid="dialog-backdrop"
      isDismissable
      isOpen={open}
      onMouseDownCapture={(event) => { if (event.target === event.currentTarget) changeOpen(false) }}
      onOpenChange={changeOpen}
    >
      <Modal className={styles.modal}>
        <AriaDialog className={styles.dialog} ref={dialogRef}>
          <div onKeyDownCapture={keepTabInside}>
            <header className={styles.header}>
              <Heading slot="title">{title}</Heading>
              <Button aria-label="닫기" className={styles.close} onPress={() => changeOpen(false)} slot="close"><X aria-hidden="true" /></Button>
            </header>
            <div className={styles.body}>{children}</div>
          </div>
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  )
}
