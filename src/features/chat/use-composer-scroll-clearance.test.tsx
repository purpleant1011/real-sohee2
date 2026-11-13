import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRef } from 'react'
import { resetSafeAreaBottomCacheForTesting, useComposerScrollClearance } from './use-composer-scroll-clearance'

beforeEach(() => {
  resetSafeAreaBottomCacheForTesting()
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.style.removeProperty('--conversation-scroll-clearance')
  document.documentElement.style.scrollPaddingBottom = ''
})

it('sets --conversation-scroll-clearance on root and restores prior style on unmount without inline padding on list/root', () => {
  let resize!: () => void
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback } observe() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 80 } as DOMRect)
  document.documentElement.style.setProperty('--conversation-scroll-clearance', '12px')

  function Harness({ keyboard = 0 }) {
    const composerRef = useRef<HTMLDivElement>(null)
    const listRef = useRef<HTMLOListElement>(null)
    useComposerScrollClearance(composerRef, true, keyboard, { messageListRef: listRef })
    return (
      <div>
        <ol ref={listRef} data-testid="msg-list" />
        <div ref={composerRef} />
      </div>
    )
  }

  const { rerender, unmount, getByTestId } = render(<Harness />)
  const list = getByTestId('msg-list')

  // Clearance is applied ONLY to the CSS variable --conversation-scroll-clearance:
  // Equal to the bar's real rendered height (+ keyboard inset) without double counting:
  // Math.max(0, 80 (height) + 0 (keyboard)) = 80px
  expect(document.documentElement.style.getPropertyValue('--conversation-scroll-clearance')).toBe('80px')
  // No inline padding or scroll-padding should be applied
  expect(list.style.paddingBlockEnd).toBe('')
  expect(list.style.scrollPaddingBottom).toBe('')
  expect(document.documentElement.style.scrollPaddingBottom).toBe('')

  rerender(<Harness keyboard={250} />)
  act(() => resize())
  // The shell already resizes when the keyboard opens; keyboardHeight must not inflate clearance
  expect(document.documentElement.style.getPropertyValue('--conversation-scroll-clearance')).toBe('80px')

  unmount()
  expect(document.documentElement.style.getPropertyValue('--conversation-scroll-clearance')).toBe('12px')
  vi.restoreAllMocks()
})

it('does not crash when scrollIntoView is undefined in jsdom', () => {
  // window.HTMLElement.prototype.scrollIntoView is undefined in default jsdom
  const original = window.HTMLElement.prototype.scrollIntoView
  // @ts-expect-error intentionally remove for testing jsdom absence
  delete window.HTMLElement.prototype.scrollIntoView

  function Harness({ count }: { count: number }) {
    const composerRef = useRef<HTMLDivElement>(null)
    const listRef = useRef<HTMLOListElement>(null)
    useComposerScrollClearance(composerRef, true, 0, {
      messageListRef: listRef,
      messagesLength: count,
      latestMessageRole: 'sohee',
    })
    return (
      <div>
        <ol ref={listRef}>
          <li className="messageRow">Card 1</li>
          {count > 1 ? <li className="messageRow">Card 2</li> : null}
        </ol>
        <div ref={composerRef} />
      </div>
    )
  }

  const { rerender } = render(<Harness count={1} />)
  expect(() => {
    rerender(<Harness count={2} />)
  }).not.toThrow()

  window.HTMLElement.prototype.scrollIntoView = original
  vi.restoreAllMocks()
})

it('does NOT scroll on desktop even if an assistant message arrives', () => {
  const scrollIntoViewMock = vi.fn()
  window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock

  function Harness({ count }: { count: number }) {
    const composerRef = useRef<HTMLDivElement>(null)
    const listRef = useRef<HTMLOListElement>(null)
    useComposerScrollClearance(composerRef, false, 0, {
      messageListRef: listRef,
      messagesLength: count,
      latestMessageRole: 'sohee',
    })
    return (
      <div>
        <ol ref={listRef}>
          <li className="messageRow">Card 1</li>
          {count > 1 ? <li className="messageRow">Card 2</li> : null}
        </ol>
        <div ref={composerRef} />
      </div>
    )
  }

  const { rerender } = render(<Harness count={1} />)
  rerender(<Harness count={2} />)
  expect(scrollIntoViewMock).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

it('does NOT scroll when user has scrolled up away from bottom and an assistant message arrives', () => {
  const scrollIntoViewMock = vi.fn()
  window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock

  function Harness({ count, role }: { count: number; role?: string }) {
    const composerRef = useRef<HTMLDivElement>(null)
    const listRef = useRef<HTMLOListElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    useComposerScrollClearance(composerRef, true, 0, {
      messageListRef: listRef,
      messagesLength: count,
      latestMessageRole: role,
    })
    return (
      <div ref={containerRef} style={{ overflowY: 'auto' }} data-testid="scroll-container">
        <ol ref={listRef}>
          <li className="messageRow">Card 1</li>
          {count > 1 ? <li className="messageRow">Card 2</li> : null}
        </ol>
        <div ref={composerRef} />
      </div>
    )
  }

  const { rerender, getByTestId } = render(<Harness count={1} role="user" />)
  const container = getByTestId('scroll-container')

  // Simulate scrolled up (far from bottom: distance = 1000 - (200 + 400) = 400 > 160)
  Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true })
  Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true })
  Object.defineProperty(container, 'scrollTop', { value: 200, configurable: true })
  fireEvent.scroll(container)

  // Assistant message arrives
  rerender(<Harness count={2} role="sohee" />)
  expect(scrollIntoViewMock).not.toHaveBeenCalled()

  // But if the user sends a message, it DOES scroll!
  rerender(<Harness count={3} role="user" />)
  expect(scrollIntoViewMock).toHaveBeenCalled()

  vi.restoreAllMocks()
})

it('probes the safe-area inset once and caches it across ResizeObserver callbacks', () => {
  let resize!: () => void
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback } observe() {} disconnect() {} })
  const appendChildSpy = vi.spyOn(document.body, 'appendChild')

  function Harness() {
    const composerRef = useRef<HTMLDivElement>(null)
    useComposerScrollClearance(composerRef, true, 0)
    return <div ref={composerRef} />
  }

  render(<Harness />)
  const initialAppends = appendChildSpy.mock.calls.length

  // Trigger resize multiple times
  act(() => resize())
  act(() => resize())
  act(() => resize())

  // appendChild should not have been called again on subsequent resizes
  expect(appendChildSpy.mock.calls.length).toBe(initialAppends)
  vi.restoreAllMocks()
})


