import { afterEach, describe, expect, it, vi } from 'vitest'
import { boundedMobileRead } from './bounded-mobile-read'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('모바일 읽기 제한', () => {
  it('성공한 본문을 반환하고 타이머를 정리한다', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"value":1}')))
    expect(await boundedMobileRead('/api/test', res => res.json(), new AbortController().signal)).toEqual({ value: 1 })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('이미 취소된 화면의 요청은 시작하지 않는다', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort()
    await expect(boundedMobileRead('/api/test', res => res.json(), controller.signal)).rejects.toThrow('조회 취소')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('화면 이탈은 abort를 무시하는 전송도 즉시 종료하고 타이머를 정리한다', async () => {
    vi.useFakeTimers()
    let transport: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      transport = init.signal as AbortSignal
      return new Promise(() => {})
    }))
    const controller = new AbortController()
    const result = boundedMobileRead('/api/test', res => res.json(), controller.signal)
    const assertion = expect(result).rejects.toThrow('조회 취소')
    controller.abort()
    await assertion
    expect(transport?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('헤더를 기다린 시간도 본문 제한 15초에 포함한다', async () => {
    vi.useFakeTimers()
    let headers: (response: Response) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { headers = resolve })))
    const result = boundedMobileRead('/api/test', res => res.json(), new AbortController().signal)
    const assertion = expect(result).rejects.toThrow('조회 시간 초과')
    await vi.advanceTimersByTimeAsync(10_000)
    headers({ json: () => new Promise(() => {}) } as Response)
    await vi.advanceTimersByTimeAsync(5_000)
    await assertion
    expect(vi.getTimerCount()).toBe(0)
  })

  it('인증 거부는 끝나지 않는 본문을 기다리지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 401, json: () => new Promise(() => {}) })))
    expect(await boundedMobileRead('/api/test', async res => res.status, new AbortController().signal)).toBe(401)
  })
})
