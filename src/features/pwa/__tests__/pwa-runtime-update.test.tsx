import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SwUpdateHandlers } from '../sw-client'
import { PwaRuntime } from '../pwa-runtime'
import { applyServiceWorkerUpdate, reloadPage } from '../sw-client'

const mocks = vi.hoisted(() => ({
  handlers: null as SwUpdateHandlers | null,
  worker: { postMessage: vi.fn() } as unknown as ServiceWorker,
  refreshMock: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useRouter: () => ({ refresh: mocks.refreshMock }),
}))
vi.mock('../sw-client', () => ({
  registerPwaServiceWorker: vi.fn(async () => ({}) as ServiceWorkerRegistration),
  watchServiceWorkerUpdate: vi.fn((_registration: ServiceWorkerRegistration, handlers: SwUpdateHandlers) => {
    mocks.handlers = handlers
    return () => { mocks.handlers = null }
  }),
  applyServiceWorkerUpdate: vi.fn(),
  reloadPage: vi.fn(),
}))
const applyUpdateMock = vi.mocked(applyServiceWorkerUpdate)
const reloadPageMock = vi.mocked(reloadPage)
async function updateReady() {
  act(() => mocks.handlers?.onUpdateReady(mocks.worker))
  await waitFor(() => expect(applyUpdateMock).toHaveBeenCalledWith(mocks.worker))
}
beforeEach(() => {
  window.localStorage.clear()
  mocks.handlers = null
  vi.clearAllMocks()
})

describe('설치 앱 복귀의 새 문서 확인', () => {
  it('오래 열린 설치 앱의 복귀는 캐시 없이 빌드를 조회하되 문서를 자동 교체하지 않는다', async () => {
    window.history.pushState({}, '', '/app')
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
    vi.stubEnv('NEXT_PUBLIC_SOHEE_BUILD_SHA', 'aaaaaaa')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ buildSha: 'bbbbbbb' }) })
    vi.stubGlobal('fetch', fetchMock)
    try {
      render(<PwaRuntime />)
      act(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/diagnostics/version', expect.objectContaining({ cache: 'no-store' })))
      expect(reloadPageMock).not.toHaveBeenCalled()
    } finally {
      delete (navigator as Navigator & { standalone?: boolean }).standalone
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
  })
})

describe('배너 없는 서비스 워커 업데이트', () => {
  it.each(['/login', '/app'])('%s에서 새 버전을 조용히 적용하고 배너·선택 버튼을 띄우지 않는다', async path => {
    window.history.pushState({}, '', path)
    render(<PwaRuntime />)
    await waitFor(() => expect(mocks.handlers).not.toBeNull())
    await updateReady()
    expect(screen.queryByText('새 버전이 준비됐어요')).toBeNull()
    expect(screen.queryByRole('button', { name: '지금 적용' })).toBeNull()
    expect(screen.queryByRole('button', { name: '나중에' })).toBeNull()
  })

  it('작성 중 입력을 보존하고 controllerchange에도 새로고침·refresh하지 않는다', async () => {
    render(<><textarea aria-label="작성 중 답장" defaultValue="아직 작성 중" /><PwaRuntime /></>)
    await waitFor(() => expect(mocks.handlers).not.toBeNull())
    await updateReady()
    act(() => mocks.handlers?.onControllerChange?.())
    expect(screen.getByRole('textbox', { name: '작성 중 답장' })).toHaveValue('아직 작성 중')
    expect(reloadPageMock).not.toHaveBeenCalled()
    expect(mocks.refreshMock).not.toHaveBeenCalled()
  })

  it('같은 워커의 중복 알림은 한 번만 적용한다', async () => {
    render(<PwaRuntime />)
    await waitFor(() => expect(mocks.handlers).not.toBeNull())
    await updateReady()
    await updateReady()
    expect(applyUpdateMock).toHaveBeenCalledTimes(1)
  })
})
