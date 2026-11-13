import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PwaRuntime } from '../pwa-runtime'

const { refreshMock, pushMock, replaceMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  pushMock: vi.fn(),
  replaceMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useRouter: () => ({ refresh: refreshMock, push: pushMock, replace: replaceMock }),
}))

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
}

function setUserAgent(value: string) {
  Object.defineProperty(window.navigator, 'userAgent', { configurable: true, get: () => value })
}

function setPath(path: string) {
  window.history.pushState({}, '', path)
}

function setVisibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value })
  document.dispatchEvent(new Event('visibilitychange'))
}

/**
 * ANI-1721: 설치 제안은 첫 가치 신호가 명시적으로 확인된 뒤에만 뜬다.
 * 실제 신호 생산자(recordFirstValueReached) 배선 전까지는 저장소에 확인된 값을 세워 픽스처를 맞춘다.
 */
function markFirstValueReached() {
  window.localStorage.setItem('sohee-pwa-first-value-reached', '1')
}

beforeEach(() => {
  window.localStorage.clear()
  setOnLine(true)
  setPath('/app')
  refreshMock.mockClear()
  pushMock.mockClear()
  replaceMock.mockClear()
})

afterEach(() => {
  window.localStorage.clear()
  setPath('/')
})

describe('PwaRuntime', () => {
  it('shows an offline notice with a retry action and hides it when online returns', async () => {
    setOnLine(false)
    render(<PwaRuntime />)

    expect(await screen.findByText('네트워크에 연결할 수 없습니다')).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: '다시 확인' })
    expect(retry).toBeInTheDocument()

    setOnLine(true)
    fireEvent(window, new Event('online'))

    await waitFor(() => expect(screen.queryByText('네트워크에 연결할 수 없습니다')).not.toBeInTheDocument())
  })

  it('PC 로그인에서 온라인 힌트가 false여도 실제 연결에 성공하면 오프라인 단정을 해제한다', async () => {
    setPath('/login')
    setOnLine(false)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    try {
      render(<PwaRuntime />)
      await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
      expect(screen.queryByText('서버 연결을 확인했어요')).toBeNull()
      expect(screen.queryByText('네트워크에 연결할 수 없습니다')).toBeNull()
      expect(fetchMock).toHaveBeenCalledWith('/manifest.webmanifest?probe=1', expect.objectContaining({ method: 'HEAD', cache: 'no-store' }))
      expect(refreshMock).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })

  it('실제 연결 실패는 경고하고 재시도 성공 후에는 모든 연결 배너를 닫는다', async () => {
    setOnLine(false)
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    try {
      render(<PwaRuntime />)
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      expect(screen.getByText('네트워크에 연결할 수 없습니다')).toBeVisible()
      fireEvent.click(screen.getByRole('button', { name: '다시 확인' }))
      await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
      expect(screen.queryByText('서버 연결을 확인했어요')).toBeNull()
      expect(screen.queryByText('네트워크에 연결할 수 없습니다')).toBeNull()
      expect(refreshMock).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })

  it('offers iOS install help only inside the app and remembers a decline', async () => {
    setUserAgent(IPHONE_UA)
    markFirstValueReached()
    render(<PwaRuntime />)

    expect(await screen.findAllByText('홈 화면에 소희를 추가할까요?')).not.toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '나중에' }))

    await waitFor(() => expect(screen.queryByText('홈 화면에 소희를 추가할까요?')).not.toBeInTheDocument())
    expect(window.localStorage.getItem('sohee-pwa-install-dismissed-at')).toBeTruthy()
    expect(window.localStorage.getItem('sohee-pwa-install-dismiss-count')).toBe('1')
  })

  it('shows the iOS share instructions when the user asks how', async () => {
    setUserAgent(IPHONE_UA)
    markFirstValueReached()
    render(<PwaRuntime />)

    fireEvent.click(await screen.findByRole('button', { name: '설치 방법 보기' }))
    expect(await screen.findByText('Safari 아래쪽의 공유 버튼을 눌러 주세요.')).toBeInTheDocument()
  })

  it('첫 가치 신호가 없으면 앱 안에서도 설치 제안을 띄우지 않는다 (ANI-1721)', async () => {
    setUserAgent(IPHONE_UA)
    render(<PwaRuntime />)

    // 신호 생산자 배선 전: 저장된 첫 가치 신호가 없으므로 제안하지 않는다.
    await waitFor(() => expect(screen.queryByText('홈 화면에 소희를 추가할까요?')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '설치 방법 보기' })).toBeNull()
  })

  it('Android 가 beforeinstallprompt 를 보내도 첫 가치 신호가 없으면 설치 제안을 열지 않는다 (ANI-1721)', async () => {
    // canPrompt=true 인 실제 설치 창을 받은 경우에도 첫 가치 게이트가 먼저다.
    setUserAgent('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36')
    render(<PwaRuntime />)

    window.dispatchEvent(new Event('beforeinstallprompt'))

    await waitFor(() => expect(screen.queryByText('홈 화면에 소희를 추가할까요?')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '설치하기' })).toBeNull()
  })

  it('Android 에서 첫 가치 신호가 확인되면 beforeinstallprompt 후 설치 제안을 연다 (게이트가 영구 차단이 아님)', async () => {
    setUserAgent('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36')
    markFirstValueReached()
    render(<PwaRuntime />)

    window.dispatchEvent(new Event('beforeinstallprompt'))

    expect(await screen.findByText('홈 화면에 소희를 추가할까요?')).toBeVisible()
  })

  it('does not offer installation on the login screen', async () => {
    setUserAgent(IPHONE_UA)
    setPath('/login')
    render(<PwaRuntime />)

    await waitFor(() => expect(screen.queryByText('홈 화면에 소희를 추가할까요?')).not.toBeInTheDocument())
  })

  it('re-reads server data after a long background stay and stays on the same screen', async () => {
    let now = 1_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      render(<PwaRuntime />)
      setVisibility('hidden')
      now += 90_000
      setVisibility('visible')

      await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1))
      // 복귀는 같은 경로를 다시 읽기만 한다 — 다른 화면/작업공간으로 이동시키지 않는다.
      expect(pushMock).not.toHaveBeenCalled()
      expect(replaceMock).not.toHaveBeenCalled()
    } finally {
      nowSpy.mockRestore()
      setVisibility('visible')
    }
  })

  it('does not re-read after a short background stay or while offline', async () => {
    let now = 1_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      render(<PwaRuntime />)

      setVisibility('hidden')
      now += 5_000
      setVisibility('visible')

      setOnLine(false)
      fireEvent(window, new Event('offline'))
      setVisibility('hidden')
      now += 90_000
      setVisibility('visible')

      await waitFor(() => expect(screen.getByText('네트워크에 연결할 수 없습니다')).toBeInTheDocument())
      expect(refreshMock).not.toHaveBeenCalled()
    } finally {
      nowSpy.mockRestore()
      setVisibility('visible')
      setOnLine(true)
    }
  })

  it('does not re-read outside the app screens', async () => {
    let now = 1_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      setPath('/login')
      render(<PwaRuntime />)

      setVisibility('hidden')
      now += 90_000
      setVisibility('visible')

      await waitFor(() => expect(refreshMock).not.toHaveBeenCalled())
    } finally {
      nowSpy.mockRestore()
      setVisibility('visible')
    }
  })

  it('does not ask for notification permission on load', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted')
    vi.stubGlobal('Notification', { permission: 'default', requestPermission })
    render(<PwaRuntime />)

    await waitFor(() => expect(screen.queryByText('네트워크에 연결할 수 없습니다')).not.toBeInTheDocument())
    expect(requestPermission).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
