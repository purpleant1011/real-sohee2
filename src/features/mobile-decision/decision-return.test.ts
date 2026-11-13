import { expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  rememberDecisionReturn,
  consumeDecisionReturn,
  takeDecisionRestore,
  putBackDecisionRestore,
  useRestoreDecisionPosition,
  rememberDecisionClick,
} from './decision-return'

beforeEach(() => {
  window.history.replaceState(null, '', '/app')
  window.scrollTo = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

it('keeps return metadata only in memory and scopes it to the clicked workspace and item', () => {
  rememberDecisionReturn('a', 'item-a', '/app?filter=waiting', 240)
  expect(consumeDecisionReturn('b', 'item-a')).toBeNull()
  rememberDecisionReturn('a', 'item-a', '/app?filter=waiting', 240)
  expect(consumeDecisionReturn('a', 'item-a')).toBe('/app?filter=waiting')
  expect(takeDecisionRestore('b', '/app?filter=waiting')).toBeNull()
  expect(takeDecisionRestore('a', '/app?filter=waiting')).toMatchObject({ scrollY: 240, itemId: 'item-a' })
  expect(takeDecisionRestore('a', '/app?filter=waiting')).toBeNull()
})

it('does not remember an external or malformed return target', () => {
  rememberDecisionReturn('a', 'item-a', '//evil.example', 100)
  expect(consumeDecisionReturn('a', 'item-a')).toBeNull()
})

it('allows explicitly putting back restore point when needed', () => {
  const point = { workspaceId: 'ws-1', itemId: 'item-1', href: '/app', scrollY: 100 }
  putBackDecisionRestore(point)
  expect(takeDecisionRestore('ws-1', '/app')).toEqual(point)
})


it('preserves restoration point when effect cleans up before frame runs (ready flag toggle or strict mode)', async () => {
  rememberDecisionReturn('ws-1', 'item-1', '/app', 150)
  expect(consumeDecisionReturn('ws-1', 'item-1')).toBe('/app')

  const card = document.createElement('a')
  card.id = 'mobile-decision-item-1'
  card.tabIndex = 0
  document.body.appendChild(card)

  // 1. 마운트되자마자 즉시 unmount (cleanup 발생)
  const { unmount } = renderHook(
    ({ ready }) => useRestoreDecisionPosition('ws-1', ready),
    { initialProps: { ready: true } },
  )
  unmount()

  // 2. 다시 마운트되었을 때 복원이 유실되지 않고 카드로 포커스되어야 함
  const focusSpy = vi.spyOn(card, 'focus')
  const { unmount: unmount2 } = renderHook(
    ({ ready }) => useRestoreDecisionPosition('ws-1', ready),
    { initialProps: { ready: true } },
  )

  await act(async () => {
    // rAF 실행 대기
    await new Promise((resolve) => requestAnimationFrame(resolve))
  })

  expect(focusSpy).toHaveBeenCalled()
  unmount2()
})

it('restores focus and scroll on sequential returns for different items', async () => {
  const scroller = document.createElement('main')
  scroller.scrollTop = 0
  document.body.appendChild(scroller)

  const card1 = document.createElement('a')
  card1.id = 'mobile-decision-comment:1'
  card1.tabIndex = 0
  scroller.appendChild(card1)

  const card2 = document.createElement('a')
  card2.id = 'mobile-decision-comment:2'
  card2.tabIndex = 0
  scroller.appendChild(card2)

  // 첫 번째 아이템 왕복
  rememberDecisionReturn('ws-1', 'comment:1', '/app', 100)
  expect(consumeDecisionReturn('ws-1', 'comment:1')).toBe('/app')

  const focusSpy1 = vi.spyOn(card1, 'focus')
  const h1 = renderHook(
    ({ ready }) => useRestoreDecisionPosition('ws-1', ready),
    { initialProps: { ready: true } },
  )

  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve))
  })
  expect(focusSpy1).toHaveBeenCalled()
  h1.unmount()

  // 두 번째 아이템 왕복 (두 번째 클릭 -> 복귀)
  rememberDecisionReturn('ws-1', 'comment:2', '/app', 300)
  expect(consumeDecisionReturn('ws-1', 'comment:2')).toBe('/app')

  const focusSpy2 = vi.spyOn(card2, 'focus')
  const h2 = renderHook(
    ({ ready }) => useRestoreDecisionPosition('ws-1', ready),
    { initialProps: { ready: true } },
  )

  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve))
  })
  expect(focusSpy2).toHaveBeenCalled()
  h2.unmount()
})

it('captures scroller.scrollTop from closest main element during rememberDecisionClick', () => {
  const main = document.createElement('main')
  main.scrollTop = 420
  document.body.appendChild(main)

  const link = document.createElement('a')
  main.appendChild(link)

  const fakeEvent = {
    currentTarget: link,
    defaultPrevented: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    button: 0,
  } as unknown as React.MouseEvent<HTMLAnchorElement>

  rememberDecisionClick(fakeEvent, 'ws-1', 'item-scroll')
  expect(consumeDecisionReturn('ws-1', 'item-scroll')).toBe('/app')
  const point = takeDecisionRestore('ws-1', '/app')
  expect(point?.scrollY).toBe(420)
})

it('waits for ready flag to turn true and restores without losing point', async () => {
  rememberDecisionReturn('ws-1', 'item-wait', '/app', 210)
  expect(consumeDecisionReturn('ws-1', 'item-wait')).toBe('/app')

  const card = document.createElement('a')
  card.id = 'mobile-decision-item-wait'
  card.tabIndex = 0
  document.body.appendChild(card)
  const focusSpy = vi.spyOn(card, 'focus')

  // 처음에는 ready: false
  const { rerender, unmount } = renderHook(
    ({ ready }) => useRestoreDecisionPosition('ws-1', ready),
    { initialProps: { ready: false } },
  )

  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve))
  })
  expect(focusSpy).not.toHaveBeenCalled()

  // ready: true 로 전환
  rerender({ ready: true })

  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve))
  })
  expect(focusSpy).toHaveBeenCalled()
  unmount()
})

it('retries across rAF frames if element is appended on subsequent frame', async () => {
  rememberDecisionReturn('ws-1', 'item-late', '/app', 180)
  expect(consumeDecisionReturn('ws-1', 'item-late')).toBe('/app')

  const card = document.createElement('a')
  card.id = 'mobile-decision-item-late'
  card.tabIndex = 0

  const focusSpy = vi.spyOn(card, 'focus')

  const { unmount } = renderHook(
    ({ ready }) => useRestoreDecisionPosition('ws-1', ready),
    { initialProps: { ready: true } },
  )

  // 1프레임 시점에는 DOM에 카드가 없음
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve))
  })
  expect(focusSpy).not.toHaveBeenCalled()

  // 2프레임 시점에 카드가 DOM에 추가됨
  document.body.appendChild(card)

  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve))
  })
  expect(focusSpy).toHaveBeenCalled()
  unmount()
})

it('restores directly from remembered point on swipe back without explicit handleBack consumption', () => {
  rememberDecisionReturn('ws-swipe', 'item-swipe', '/app?view=today', 320)
  // handleBack/consumeDecisionReturn 없이 브라우저/iOS 스와이프로 복귀한 상황:
  // takeDecisionRestore가 remembered를 1회 소비해 반환해야 함
  const restored = takeDecisionRestore('ws-swipe', '/app?view=today')
  expect(restored).toMatchObject({
    workspaceId: 'ws-swipe',
    itemId: 'item-swipe',
    href: '/app?view=today',
    scrollY: 320,
  })
  // 1회 소비되었으므로 다시 부르면 null
  expect(takeDecisionRestore('ws-swipe', '/app?view=today')).toBeNull()
})

it('ignores remembered point if workspace or current href does not match on swipe back', () => {
  rememberDecisionReturn('ws-swipe', 'item-swipe', '/app?view=today', 320)

  // 1. workspace 불일치
  expect(takeDecisionRestore('other-ws', '/app?view=today')).toBeNull()

  // 2. href 불일치
  expect(takeDecisionRestore('ws-swipe', '/app/approvals')).toBeNull()

  // 원래 맞는 workspace + href로는 여전히 복원 가능
  expect(takeDecisionRestore('ws-swipe', '/app?view=today')).toMatchObject({
    itemId: 'item-swipe',
    scrollY: 320,
  })
})

it('expires remembered and restoring points after TTL (5 minutes)', () => {
  const baseTime = 1_700_000_000_000
  vi.spyOn(Date, 'now').mockReturnValue(baseTime)

  // 1. remembered 만료 시 consumeDecisionReturn 불가
  rememberDecisionReturn('ws-ttl', 'item-ttl', '/app', 100)
  vi.spyOn(Date, 'now').mockReturnValue(baseTime + 5 * 60 * 1000 + 1) // 5분 1ms 경과
  expect(consumeDecisionReturn('ws-ttl', 'item-ttl')).toBeNull()

  // 2. swipe back에서 remembered 만료 시 takeDecisionRestore 불가
  vi.spyOn(Date, 'now').mockReturnValue(baseTime)
  rememberDecisionReturn('ws-ttl', 'item-ttl-2', '/app', 200)
  vi.spyOn(Date, 'now').mockReturnValue(baseTime + 5 * 60 * 1000 + 1)
  expect(takeDecisionRestore('ws-ttl', '/app')).toBeNull()

  // 3. consume 후 restoring 상태에서 5분 경과 시 takeDecisionRestore 불가
  vi.spyOn(Date, 'now').mockReturnValue(baseTime)
  rememberDecisionReturn('ws-ttl', 'item-ttl-3', '/app', 300)
  expect(consumeDecisionReturn('ws-ttl', 'item-ttl-3')).toBe('/app')
  vi.spyOn(Date, 'now').mockReturnValue(baseTime + 5 * 60 * 1000 + 1)
  expect(takeDecisionRestore('ws-ttl', '/app')).toBeNull()

  // 4. putBackDecisionRestore 시 이미 만료된 포인트는 복원되지 않고 폐기
  const expiredPoint = {
    workspaceId: 'ws-ttl',
    itemId: 'item-ttl-4',
    href: '/app',
    scrollY: 400,
    expiresAt: baseTime + 1000,
  }
  vi.spyOn(Date, 'now').mockReturnValue(baseTime + 2000)
  putBackDecisionRestore(expiredPoint)
  expect(takeDecisionRestore('ws-ttl', '/app')).toBeNull()
})