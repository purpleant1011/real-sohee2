import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RESUME_STALE_MS,
  shouldRevalidateOnResume,
  subscribeToAppResume,
} from '../resume'

/**
 * ANI-1725 — 배경 복귀 계약.
 *
 * 복귀는 "서버 데이터를 다시 읽는다"까지다. 복귀 자체가 외부 쓰기(발송·게시·예약)를
 * 다시 시작하면 안 되고, 오래 숨겨져 있었는지 판정은 순수 함수로 고정한다.
 */

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

function pageShow(persisted: boolean) {
  const event = new Event('pageshow')
  Object.defineProperty(event, 'persisted', { value: persisted })
  window.dispatchEvent(event)
}

afterEach(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
})

describe('shouldRevalidateOnResume', () => {
  it('앱 화면에서 오래 숨겨졌다 돌아오면 다시 확인한다', () => {
    expect(
      shouldRevalidateOnResume({ hiddenMs: RESUME_STALE_MS, online: true, pathname: '/app' }),
    ).toBe(true)
    expect(
      shouldRevalidateOnResume({
        hiddenMs: RESUME_STALE_MS,
        online: true,
        pathname: '/app/engagement',
      }),
    ).toBe(true)
    expect(
      shouldRevalidateOnResume({ hiddenMs: Number.POSITIVE_INFINITY, online: true, pathname: '/start' }),
    ).toBe(true)
  })

  it('짧게 다녀왔거나 오프라인이면 아무 것도 하지 않는다', () => {
    expect(
      shouldRevalidateOnResume({ hiddenMs: RESUME_STALE_MS - 1, online: true, pathname: '/app' }),
    ).toBe(false)
    expect(
      shouldRevalidateOnResume({ hiddenMs: RESUME_STALE_MS, online: false, pathname: '/app' }),
    ).toBe(false)
  })

  it('앱 밖 화면(로그인·관리자·유사 경로)은 다시 확인하지 않는다', () => {
    for (const pathname of ['/login', '/admin', '/app-evil', '/', '/appx']) {
      expect(
        shouldRevalidateOnResume({ hiddenMs: RESUME_STALE_MS, online: true, pathname }),
      ).toBe(false)
    }
  })

  it('hiddenMs 가 음수·NaN·Infinity 등 비정상 값이면 안전하게 처리한다 (ANI-1725 fail-closed)', () => {
    // 음수/NaN 은 오래된 것으로 단정할 수 없으므로 false. Infinity(bfcache 등)는 재확인 대상이다.
    expect(shouldRevalidateOnResume({ hiddenMs: -1000, online: true, pathname: '/app' })).toBe(false)
    expect(shouldRevalidateOnResume({ hiddenMs: Number.NaN, online: true, pathname: '/app' })).toBe(false)
    expect(shouldRevalidateOnResume({ hiddenMs: Number.POSITIVE_INFINITY, online: true, pathname: '/app' })).toBe(true)
  })
})

describe('subscribeToAppResume', () => {
  it('숨겨져 있던 시간을 계산해 알린다', () => {
    let now = 1_000_000
    const onResume = vi.fn()
    const unsubscribe = subscribeToAppResume(onResume, { now: () => now })

    setVisibility('hidden')
    now += 90_000
    setVisibility('visible')

    expect(onResume).toHaveBeenCalledTimes(1)
    expect(onResume).toHaveBeenCalledWith({ hiddenMs: 90_000, source: 'visibility' })
    unsubscribe()
  })

  it('bfcache 복귀는 숨겨진 시간을 알 수 없으므로 pageshow(persisted) 로 알린다', () => {
    const onResume = vi.fn()
    const unsubscribe = subscribeToAppResume(onResume, { now: () => 0 })

    pageShow(true)

    expect(onResume).toHaveBeenCalledWith({
      hiddenMs: Number.POSITIVE_INFINITY,
      source: 'pageshow',
    })
    unsubscribe()
  })

  it('일반 페이지 로드(persisted=false)는 복귀로 보지 않는다', () => {
    const onResume = vi.fn()
    const unsubscribe = subscribeToAppResume(onResume, { now: () => 0 })

    pageShow(false)

    expect(onResume).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('숨김 이벤트만으로는 알리지 않고, 해제하면 더 이상 부르지 않는다', () => {
    const onResume = vi.fn()
    const unsubscribe = subscribeToAppResume(onResume, { now: () => 0 })

    setVisibility('hidden')
    expect(onResume).not.toHaveBeenCalled()

    setVisibility('visible')
    expect(onResume).toHaveBeenCalledTimes(1)

    unsubscribe()
    setVisibility('hidden')
    setVisibility('visible')
    expect(onResume).toHaveBeenCalledTimes(1)
  })

  it('구독 해제 후 pageshow 복귀도 알리지 않는다', () => {
    const onResume = vi.fn()
    const unsubscribe = subscribeToAppResume(onResume, { now: () => 0 })
    unsubscribe()

    pageShow(true)

    expect(onResume).not.toHaveBeenCalled()
  })
})
