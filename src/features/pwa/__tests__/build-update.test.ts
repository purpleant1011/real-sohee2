import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBuildUpdateNavigation } from '../build-update'

beforeEach(() => {
  Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
})
afterEach(() => {
  document.body.innerHTML = ''
  delete (navigator as Navigator & { standalone?: boolean }).standalone
  Reflect.deleteProperty(navigator, 'onLine')
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function setup(buildSha: unknown = 'bbbbbbb', currentBuild = 'aaaaaaa') {
  const navigate = vi.fn()
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ buildSha }) })
  vi.stubGlobal('fetch', fetchMock)
  return { navigation: createBuildUpdateNavigation(() => currentBuild, navigate), navigate, fetchMock }
}

describe('설치 앱의 다음 메뉴에서만 새 문서로 전환', () => {
  it('새 빌드를 조회만 하고 다음 메뉴의 경로·필터를 유지해 한 번 이동한다', async () => {
    const { navigation, navigate, fetchMock } = setup()
    expect(navigation.navigate('/app/results')).toBe(false)
    await navigation.check()
    expect(navigate).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith('/api/diagnostics/version', expect.objectContaining({ cache: 'no-store', method: 'GET' }))
    expect(navigation.navigate('/app/content?f=draft')).toBe(true)
    expect(navigate).toHaveBeenCalledWith('/app/content?f=draft')
    expect(navigation.navigate('/app/results')).toBe(false)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it.each(['aaaaaaa', 'development', '', null, 'not-a-sha'])('동일하거나 판정 불가한 빌드 %s는 이동시키지 않는다', async buildSha => {
    const { navigation, navigate } = setup(buildSha)
    await navigation.check()
    expect(navigation.navigate('/app/results')).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('현재 빌드가 불명확하면 서버 조회도 하지 않는다', async () => {
    const { navigation, fetchMock } = setup('bbbbbbb', '')
    await navigation.check()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('브라우저 탭에서는 새 문서 전환을 준비하지 않는다', async () => {
    const { navigation, fetchMock } = setup()
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: false })
    await navigation.check()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('작성 중 입력이 있으면 보류하고 입력이 사라진 다음 메뉴에서 전환한다', async () => {
    const { navigation, navigate } = setup()
    await navigation.check()
    document.body.innerHTML = '<textarea>작성 중 답장</textarea>'
    expect(navigation.navigate('/app/results')).toBe(false)
    expect(document.querySelector('textarea')?.value).toBe('작성 중 답장')
    expect(navigate).not.toHaveBeenCalled()
    document.body.innerHTML = ''
    expect(navigation.navigate('/app/results')).toBe(true)
  })

  it('오프라인이면 조회와 이미 준비된 새 문서 전환을 보류한다', async () => {
    const { navigation, fetchMock } = setup()
    await navigation.check()
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await navigation.check()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(navigation.navigate('/app/results')).toBe(false)
  })

  it.each(['https://example.com/app', '//example.com/app', '/login', '/app/../login', '/app\\evil'])('앱 밖 경로 %s로 문서 이동하지 않는다', async href => {
    const { navigation, navigate } = setup()
    await navigation.check()
    expect(navigation.navigate(href)).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('조회 실패는 기존 메뉴 이동을 막거나 재시도하지 않는다', async () => {
    const { navigation, fetchMock } = setup()
    fetchMock.mockRejectedValue(new Error('offline'))
    await navigation.check()
    expect(navigation.navigate('/app/results')).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('동시에 복귀해도 진행 중인 버전 조회는 한 번만 실행한다', async () => {
    const { navigation, fetchMock } = setup()
    let complete!: (response: unknown) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    const first = navigation.check()
    await navigation.check()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(navigation.navigate('/app/results')).toBe(false)
    complete({ ok: true, json: async () => ({ buildSha: 'bbbbbbb' }) })
    await first
    expect(navigation.navigate('/app/results')).toBe(true)
  })

  it('5초 동안 응답이 없으면 취소하고 다음 복귀에서 다시 조회할 수 있다', async () => {
    vi.useFakeTimers()
    const { navigation, fetchMock, navigate } = setup()
    let signal!: AbortSignal
    fetchMock.mockImplementationOnce((_url: string, options: RequestInit) => {
      signal = options.signal as AbortSignal
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    })
    const first = navigation.check()
    await vi.advanceTimersByTimeAsync(4_999)
    expect(signal.aborted).toBe(false)
    expect(navigation.navigate('/app/results')).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await first
    expect(signal.aborted).toBe(true)
    expect(navigate).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    await navigation.check()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(navigation.navigate('/app/results')).toBe(true)
  })

  it('정상 응답 뒤에는 타임아웃을 해제해 완료된 요청을 취소하지 않는다', async () => {
    vi.useFakeTimers()
    const { navigation, fetchMock } = setup()
    await navigation.check()
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(signal.aborted).toBe(false)
    expect(navigation.navigate('/app/results')).toBe(true)
  })

  it('조회 실패 뒤에도 잠금을 해제해 다음 복귀를 검사한다', async () => {
    const { navigation, fetchMock } = setup()
    fetchMock.mockRejectedValueOnce(new Error('network'))
    await navigation.check()
    expect(navigation.navigate('/app/results')).toBe(false)
    await navigation.check()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(navigation.navigate('/app/results')).toBe(true)
  })

  it('HTTP 오류의 JSON을 새 버전 근거로 사용하지 않는다', async () => {
    const { navigation, fetchMock } = setup()
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ buildSha: 'bbbbbbb' }) })
    await navigation.check()
    expect(navigation.navigate('/app/results')).toBe(false)
  })
})
