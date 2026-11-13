import { renderHook } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DUPLICATE_WRITE_COPY,
  EXTERNAL_WRITE_KINDS,
  OFFLINE_WRITE_COPY,
  createActionGuard,
} from '../action-guard'
import { subscribeToAppResume } from '../resume'
import {
  createExternalWriteRunner,
  externalWriteKey,
  publishWriteKey,
  reservationWriteKey,
  resetPageActionGuardForTests,
} from '../external-write'
import { useExternalWriteGuard } from '../use-external-write-guard'

// 훅은 실제 연결 확인(probe)을 거친다. 테스트에서는 probe 결과를 직접 정한다.
const { probeMock } = vi.hoisted(() => ({ probeMock: vi.fn(async () => true) }))

vi.mock('../network', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../network')>()
  return {
    ...actual,
    probeConnectivity: probeMock,
  }
})

/**
 * ANI-1778 — 실제 외부 쓰기 진입점이 쓰는 가드의 계약.
 * 오프라인은 fail-closed 로 거절하고, 진행 중인 같은 행위는 한 번만 실행하며,
 * 거절된 작업을 큐에 쌓아 자동 재전송하지 않는다.
 */

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createExternalWriteRunner', () => {
  it.each(EXTERNAL_WRITE_KINDS)('%s: 오프라인이면 작업을 시작하지 않는다', async (kind) => {
    const task = vi.fn(async () => 'done')
    const run = createExternalWriteRunner({ guard: createActionGuard(), isOnlineHint: () => false })

    const outcome = await run(kind, 'action-1', task)

    expect(outcome).toEqual({
      ran: false,
      decision: { allowed: false, reason: 'offline', message: OFFLINE_WRITE_COPY },
    })
    expect(task).not.toHaveBeenCalled()
  })

  it('진행 중인 같은 행위는 두 번째 호출을 실행하지 않는다', async () => {
    const pending = deferred<string>()
    const task = vi.fn(() => pending.promise)
    const run = createExternalWriteRunner({ guard: createActionGuard(), isOnlineHint: () => true })

    const first = run('send', 'thread-1', task)
    const second = await run('send', 'thread-1', task)

    expect(second).toEqual({
      ran: false,
      decision: { allowed: false, reason: 'duplicate', message: DUPLICATE_WRITE_COPY },
    })
    expect(task).toHaveBeenCalledTimes(1)

    pending.resolve('sent')
    await expect(first).resolves.toEqual({ ran: true, value: 'sent' })

    // 끝난 뒤에는 다시 시작할 수 있다.
    await expect(run('send', 'thread-1', async () => 'again')).resolves.toEqual({
      ran: true,
      value: 'again',
    })
  })

  it('대상이 다르면 같은 종류라도 동시에 진행할 수 있다', async () => {
    const firstTask = deferred<string>()
    const secondTask = deferred<string>()
    const run = createExternalWriteRunner({ guard: createActionGuard(), isOnlineHint: () => true })

    const first = run('send', 'thread-1', () => firstTask.promise)
    const second = run('send', 'thread-2', () => secondTask.promise)

    firstTask.resolve('one')
    secondTask.resolve('two')

    await expect(first).resolves.toEqual({ ran: true, value: 'one' })
    await expect(second).resolves.toEqual({ ran: true, value: 'two' })
  })

  it('publishWriteKey prefixes channel accurately for distinct deduplication (D4)', () => {
    expect(publishWriteKey('instagram', 'content-1', 'publish_now')).toBe('instagram-post:content-1:publish_now')
    expect(publishWriteKey('threads', 'content-1', 'publish_now')).toBe('threads-post:content-1:publish_now')
    expect(publishWriteKey('naver_blog', 'content-1', 'schedule')).toBe('naver_blog-post:content-1:schedule')
  })

  it('종류가 다르면 같은 대상 키라도 서로 막지 않는다', async () => {
    const pending = deferred<string>()
    const run = createExternalWriteRunner({ guard: createActionGuard(), isOnlineHint: () => true })

    const publish = run('publish', 'same-key', () => pending.promise)
    const send = run('send', 'same-key', async () => 'sent')

    await expect(send).resolves.toEqual({ ran: true, value: 'sent' })
    pending.resolve('published')
    await expect(publish).resolves.toEqual({ ran: true, value: 'published' })
    expect(externalWriteKey('publish', 'same-key')).not.toBe(externalWriteKey('send', 'same-key'))
  })

  it('오프라인 거절은 큐에 쌓이지 않는다 — 온라인이 되어도 자동 재실행이 없다', async () => {
    let online = false
    const task = vi.fn(async () => 'done')
    const run = createExternalWriteRunner({ guard: createActionGuard(), isOnlineHint: () => online })

    await expect(run('publish', 'mission-1', task)).resolves.toMatchObject({
      ran: false,
      decision: { reason: 'offline' },
    })
    expect(task).not.toHaveBeenCalled()

    online = true
    await Promise.resolve()
    expect(task).not.toHaveBeenCalled()
  })

  it('작업이 실패해도 차단기를 풀어 다시 시도할 수 있다', async () => {
    const run = createExternalWriteRunner({ guard: createActionGuard(), isOnlineHint: () => true })

    await expect(run('payment', 'intent-1', async () => {
      throw new Error('provider down')
    })).rejects.toThrow('provider down')

    await expect(run('payment', 'intent-1', async () => 'retried')).resolves.toEqual({
      ran: true,
      value: 'retried',
    })
  })

  it('연결 상태를 알 수 없으면 시작하지 않는다(fail-closed)', async () => {
    const task = vi.fn(async () => 'done')
    const run = createExternalWriteRunner({ guard: createActionGuard(), isOnlineHint: () => false })

    const outcome = await run('refund', 'refund-1', task)

    expect(outcome.ran).toBe(false)
    expect(task).not.toHaveBeenCalled()
  })

  it('힌트가 온라인이어도 실제 연결 확인이 실패하면 시작하지 않는다', async () => {
    const task = vi.fn(async () => 'done')
    const probe = vi.fn(async () => false)
    const run = createExternalWriteRunner({
      guard: createActionGuard(),
      isOnlineHint: () => true,
      probe,
    })

    const outcome = await run('publish', 'mission-1', task)

    expect(outcome).toEqual({
      ran: false,
      decision: { allowed: false, reason: 'offline', message: OFFLINE_WRITE_COPY },
    })
    expect(probe).toHaveBeenCalledTimes(1)
    expect(task).not.toHaveBeenCalled()
  })

  it('연결 확인이 예외를 던져도 거절로 처리한다', async () => {
    const task = vi.fn(async () => 'done')
    const run = createExternalWriteRunner({
      guard: createActionGuard(),
      isOnlineHint: () => true,
      probe: async () => {
        throw new Error('probe failed')
      },
    })

    const outcome = await run('send', 'thread-1', task)

    expect(outcome).toMatchObject({ ran: false, decision: { reason: 'offline' } })
    expect(task).not.toHaveBeenCalled()
  })

  it('연결 확인 중 두 번째 탭도 중복으로 막고, 확인 후에는 다시 시도할 수 있다', async () => {
    const pendingProbe = deferred<boolean>()
    const probe = vi.fn(() => pendingProbe.promise)
    const task = vi.fn(async () => 'done')
    const guard = createActionGuard()
    const run = createExternalWriteRunner({ guard, isOnlineHint: () => true, probe })

    const first = run('publish', 'mission-1', task)
    await expect(run('publish', 'mission-1', task)).resolves.toEqual({
      ran: false,
      decision: { allowed: false, reason: 'duplicate', message: DUPLICATE_WRITE_COPY },
    })

    pendingProbe.resolve(true)
    await expect(first).resolves.toEqual({ ran: true, value: 'done' })
    expect(guard.isRunning(externalWriteKey('publish', 'mission-1'))).toBe(false)
  })

  it('힌트가 오프라인이면 연결 확인조차 하지 않는다', async () => {
    const probe = vi.fn(async () => true)
    const run = createExternalWriteRunner({
      guard: createActionGuard(),
      isOnlineHint: () => false,
      probe,
    })

    await run('publish', 'mission-1', async () => 'done')

    expect(probe).not.toHaveBeenCalled()
  })
})

describe('reservationWriteKey', () => {
  it('두 진입점이 같은 예약을 같은 키로 잡는다', () => {
    const fromLedger = reservationWriteKey('ws-1', '홍길동', '2026-10-24T10:00:00+09:00')
    const fromDock = reservationWriteKey('ws-1', '  홍길동 ', ' 2026-10-24T10:00:00+09:00 ')

    expect(fromLedger).toBe(fromDock)
  })

  it('워크스페이스가 다르면 다른 키다', () => {
    expect(reservationWriteKey('ws-1', '홍길동', '2026-10-24T10:00:00+09:00')).not.toBe(
      reservationWriteKey('ws-2', '홍길동', '2026-10-24T10:00:00+09:00'),
    )
  })

  it('고객이 다르면 다른 키다', () => {
    expect(reservationWriteKey('ws-1', '홍길동', '2026-10-24T10:00:00+09:00')).not.toBe(
      reservationWriteKey('ws-1', '김철수', '2026-10-24T10:00:00+09:00'),
    )
  })
})

describe('useExternalWriteGuard', () => {
  beforeEach(() => {
    resetPageActionGuardForTests()
    probeMock.mockReset()
    probeMock.mockResolvedValue(true)
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true })
  })

  it('서로 다른 화면의 훅이라도 같은 행위의 중복 실행을 막는다', async () => {
    const pending = deferred<string>()
    const { result: firstScreen } = renderHook(() => useExternalWriteGuard())
    const { result: secondScreen } = renderHook(() => useExternalWriteGuard())

    const first = firstScreen.current('publish', 'mission-1', () => pending.promise)
    const second = await secondScreen.current('publish', 'mission-1', async () => 'second')

    expect(second).toEqual({
      ran: false,
      decision: { allowed: false, reason: 'duplicate', message: DUPLICATE_WRITE_COPY },
    })

    pending.resolve('first')
    await expect(first).resolves.toEqual({ ran: true, value: 'first' })
  })

  it('오프라인이면 훅을 통한 호출도 거절한다', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false })
    const { result } = renderHook(() => useExternalWriteGuard())
    const task = vi.fn(async () => 'done')

    const outcome = await result.current('reservation', 'booking-1', task)

    expect(outcome).toMatchObject({ ran: false, decision: { reason: 'offline' } })
    expect(task).not.toHaveBeenCalled()
    expect(probeMock).not.toHaveBeenCalled()
  })

  it('힌트가 온라인이어도 실제 연결 확인이 실패하면 거절한다', async () => {
    probeMock.mockResolvedValue(false)
    const { result } = renderHook(() => useExternalWriteGuard())
    const task = vi.fn(async () => 'done')

    const outcome = await result.current('publish', 'content-1', task)

    expect(outcome).toMatchObject({ ran: false, decision: { reason: 'offline' } })
    expect(task).not.toHaveBeenCalled()
  })
})

// 종류 목록이 줄어들면 위 it.each 가 조용히 약해지므로 고정한다.
describe('EXTERNAL_WRITE_KINDS', () => {
  it('다섯 가지 외부 쓰기 종류를 유지한다', () => {
    expect([...EXTERNAL_WRITE_KINDS]).toEqual([
      'publish',
      'send',
      'reservation',
      'payment',
      'refund',
    ])
  })
})

/**
 * ANI-1725 — 배경 복귀·오프라인 발송 큐.
 * 앱을 나갔다 돌아오는 사이에도 진행 중인 같은 행위는 다시 시작되지 않고,
 * 오프라인 거절은 어떤 저장소에도 남겨 두지 않는다(자동 재전송 큐 없음).
 */
describe('배경 복귀와 오프라인 발송 큐 (ANI-1725)', () => {
  function setVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    document.dispatchEvent(new Event('visibilitychange'))
  }

  function storageKeys(storage: Storage) {
    return Array.from({ length: storage.length }, (_, index) => storage.key(index)).sort()
  }

  afterEach(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    vi.restoreAllMocks()
  })

  it('백그라운드에 다녀와도 진행 중인 같은 행위는 다시 시작되지 않는다', async () => {
    const pending = deferred<string>()
    const task = vi.fn(() => pending.promise)
    const run = createExternalWriteRunner({ guard: createActionGuard(), isOnlineHint: () => true })

    const first = run('send', 'comment:c-1', task)

    // 앱을 나갔다 돌아온다 — 화면이 다시 그려져도 차단기는 메모리에 그대로 있다.
    setVisibility('hidden')
    setVisibility('visible')

    await expect(run('send', 'comment:c-1', task)).resolves.toEqual({
      ran: false,
      decision: { allowed: false, reason: 'duplicate', message: DUPLICATE_WRITE_COPY },
    })
    expect(task).toHaveBeenCalledTimes(1)

    pending.resolve('sent')
    await expect(first).resolves.toEqual({ ran: true, value: 'sent' })

    // 끝난 뒤에는 다시 시작할 수 있다 — 복귀가 차단기를 영구히 잠그지 않는다.
    await expect(run('send', 'comment:c-1', async () => 'again')).resolves.toEqual({
      ran: true,
      value: 'again',
    })
  })

  it('복귀 알림은 조회만 다시 하라고 알리고, 끝난 쓰기를 다시 보내지 않는다', async () => {
    let now = 0
    const onResume = vi.fn()
    const unsubscribe = subscribeToAppResume(onResume, { now: () => now })
    const task = vi.fn(async () => 'published')
    const run = createExternalWriteRunner({ guard: createActionGuard(), isOnlineHint: () => true })

    await run('publish', 'mission-1', task)

    setVisibility('hidden')
    now += 120_000
    setVisibility('visible')

    expect(onResume).toHaveBeenCalledTimes(1)
    expect(onResume).toHaveBeenCalledWith({ hiddenMs: 120_000, source: 'visibility' })
    expect(task).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('오프라인 거절은 저장소에 발송 큐를 남기지 않고, 재연결해도 자동 재전송하지 않는다', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const localBefore = storageKeys(window.localStorage)
    const sessionBefore = storageKeys(window.sessionStorage)
    let online = false
    const task = vi.fn(async () => 'sent')
    const run = createExternalWriteRunner({ guard: createActionGuard(), isOnlineHint: () => online })

    await expect(run('send', 'comment:c-1', task)).resolves.toMatchObject({
      ran: false,
      decision: { reason: 'offline' },
    })

    // 연결이 돌아와도 거절된 발송은 저절로 나가지 않는다.
    online = true
    window.dispatchEvent(new Event('online'))
    await Promise.resolve()

    expect(task).not.toHaveBeenCalled()
    expect(setItem).not.toHaveBeenCalled()
    expect(storageKeys(window.localStorage)).toEqual(localBefore)
    expect(storageKeys(window.sessionStorage)).toEqual(sessionBefore)
  })

  it('가드 소스는 저장소나 서비스워커 큐를 쓰지 않는다', () => {
    for (const file of ['action-guard.ts', 'external-write.ts', 'use-external-write-guard.ts']) {
      const source = readFileSync(resolve(process.cwd(), 'src/features/pwa', file), 'utf8')
      expect(source, file).not.toMatch(/localStorage|sessionStorage|indexedDB/)
      expect(source, file).not.toMatch(/serviceWorker/)
    }
  })

  it('key 가 빈 문자열이거나 유효하지 않은 경우에도 외부 쓰기를 중복 차단하고 메모리에만 둔다 (ANI-1725)', async () => {
    const pending = deferred<string>()
    const task = vi.fn(() => pending.promise)
    const run = createExternalWriteRunner({ guard: createActionGuard(), isOnlineHint: () => true })

    const first = run('publish', '', task)
    // 빈 문자열 키라도 실행 중이면 중복 거절된다
    const second = await run('publish', '', async () => 'second')
    expect(second).toEqual({
      ran: false,
      decision: { allowed: false, reason: 'duplicate', message: DUPLICATE_WRITE_COPY },
    })

    pending.resolve('ok')
    await expect(first).resolves.toEqual({ ran: true, value: 'ok' })
  })
})
