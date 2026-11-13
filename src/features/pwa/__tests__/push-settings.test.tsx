import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PUSH_CONSENT_COPY } from '../push-opt-in'
import { PUSH_TOKEN_STATUS_COPY } from '../push-token-status'
import { PushSettings, PushSettingsView } from '../push-settings'

const DAY = 24 * 60 * 60 * 1000

function stubBrowser(permission: NotificationPermission, requestPermission = vi.fn()) {
  vi.stubGlobal('Notification', { permission, requestPermission })
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
  return requestPermission
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PushSettingsView — 동의 안내', () => {
  it('권한을 물을 수 있으면 두 선택지를 준다', () => {
    render(<PushSettingsView consent={{ kind: 'offer' }} onAccept={vi.fn()} onDecline={vi.fn()} />)
    expect(screen.getByRole('heading', { name: '잠금 화면 알림' })).toBeVisible()
    expect(screen.getByRole('button', { name: PUSH_CONSENT_COPY.accept })).toBeEnabled()
    expect(screen.getByRole('button', { name: PUSH_CONSENT_COPY.decline })).toBeEnabled()
    expect(screen.getByText(PUSH_CONSENT_COPY.description)).toBeVisible()
  })

  it('브라우저에서 거부했으면 다시 묻는 버튼을 만들지 않는다', () => {
    render(<PushSettingsView consent={{ kind: 'denied' }} />)
    expect(screen.getByText(PUSH_CONSENT_COPY.denied)).toBeVisible()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('아이폰 미설치·미지원도 이유를 숨기지 않는다', () => {
    const { unmount } = render(<PushSettingsView consent={{ kind: 'needs-install' }} />)
    expect(screen.getByText(PUSH_CONSENT_COPY.needsInstall)).toBeVisible()
    unmount()
    render(<PushSettingsView consent={{ kind: 'unsupported' }} />)
    expect(screen.getByText(PUSH_CONSENT_COPY.unsupported)).toBeVisible()
  })

  it('브라우저 허용만으로 수신 중이라고 쓰지 않는다', () => {
    render(<PushSettingsView consent={{ kind: 'granted', serverConfirmed: false }} />)
    expect(screen.getByText(PUSH_CONSENT_COPY.grantedUnconfirmed)).toBeVisible()
    expect(screen.queryByText(/받고 있어요/)).toBeNull()
  })

  it('서버가 만료·폐기를 확인했으면 "확인하지 못했어요"로 뭉개지 않는다 (ANI-1724)', () => {
    for (const tokenStatus of ['expiring', 'expired', 'revoked'] as const) {
      const { unmount } = render(<PushSettingsView consent={{ kind: 'granted_token_stale', tokenStatus }} />)
      expect(screen.getByText(PUSH_CONSENT_COPY.grantedTokenStale)).toBeVisible()
      expect(screen.queryByText(PUSH_CONSENT_COPY.grantedUnconfirmed)).toBeNull()
      expect(screen.queryByText(/받고 있어요/)).toBeNull()
      unmount()
    }
  })

  it('서버가 등록 없음을 확인했으면 등록 없음으로 말한다 (ANI-1724)', () => {
    render(<PushSettingsView consent={{ kind: 'granted_not_registered' }} />)
    expect(screen.getByText(PUSH_CONSENT_COPY.grantedNotRegistered)).toBeVisible()
    expect(screen.queryByText(PUSH_CONSENT_COPY.grantedUnconfirmed)).toBeNull()
  })

  it('그릴 것이 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(<PushSettingsView consent={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('PushSettingsView — 토큰 수명', () => {
  it('상태별로 문구와 재확인 행동을 보여 준다', () => {
    render(<PushSettingsView consent={null} tokenStatus="expiring" onRetryToken={vi.fn()} />)
    expect(screen.getByText(PUSH_TOKEN_STATUS_COPY.expiring.label)).toBeVisible()
    expect(screen.getByText(PUSH_TOKEN_STATUS_COPY.expiring.description)).toBeVisible()
    expect(screen.getByRole('button', { name: PUSH_TOKEN_STATUS_COPY.expiring.actionLabel! })).toBeVisible()
  })

  it('조회 실패는 "확인하지 못했어요"로 남고 등록 없음으로 읽히지 않는다', () => {
    render(<PushSettingsView consent={null} tokenStatus="unknown" onRetryToken={vi.fn()} />)
    expect(screen.getByText('확인하지 못했어요')).toBeVisible()
    expect(screen.getByText(PUSH_TOKEN_STATUS_COPY.unknown.description)).toBeVisible()
    expect(screen.queryByText(PUSH_TOKEN_STATUS_COPY.not_registered.label)).toBeNull()
  })

  it('준비된 상태에는 행동 버튼을 붙이지 않는다', () => {
    render(<PushSettingsView consent={null} tokenStatus="active" onRetryToken={vi.fn()} />)
    expect(screen.getByText(PUSH_TOKEN_STATUS_COPY.active.label)).toBeVisible()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('PushSettings — 브라우저 환경 배선', () => {
  it('마운트만으로는 권한 창을 띄우지 않는다', async () => {
    const requestPermission = stubBrowser('default')
    render(<PushSettings />)
    await screen.findByRole('button', { name: PUSH_CONSENT_COPY.accept })
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('사용자가 누를 때 한 번만 요청하고, 허용 뒤에도 서버 확인 전이라고 알린다', async () => {
    const requestPermission = stubBrowser('default', vi.fn().mockResolvedValue('granted'))
    render(<PushSettings />)

    fireEvent.click(await screen.findByRole('button', { name: PUSH_CONSENT_COPY.accept }))

    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(PUSH_CONSENT_COPY.grantedUnconfirmed)).toBeVisible()
    expect(screen.queryByRole('button', { name: PUSH_CONSENT_COPY.accept })).toBeNull()
  })

  it('거부되면 안내로 바뀌고 권한을 다시 요청하지 않는다', async () => {
    const requestPermission = stubBrowser('default', vi.fn().mockResolvedValue('denied'))
    render(<PushSettings />)

    fireEvent.click(await screen.findByRole('button', { name: PUSH_CONSENT_COPY.accept }))

    expect(await screen.findByText(PUSH_CONSENT_COPY.denied)).toBeVisible()
    expect(screen.queryByRole('button', { name: PUSH_CONSENT_COPY.accept })).toBeNull()
    expect(requestPermission).toHaveBeenCalledTimes(1)
  })

  it('"지금은 괜찮아요"는 거절로 기록하고 다시 묻지 않는다', async () => {
    stubBrowser('default')
    const { unmount } = render(<PushSettings />)

    fireEvent.click(await screen.findByRole('button', { name: PUSH_CONSENT_COPY.decline }))
    expect(await screen.findByText(/알림을 켜지 않았어요/)).toBeVisible()

    unmount()
    render(<PushSettings />)
    await waitFor(() => expect(screen.queryByRole('button', { name: PUSH_CONSENT_COPY.accept })).toBeNull())
    expect(window.localStorage.getItem('sohee-pwa-push-dismiss-count')).toBe('1')
  })

  it('서버 조회 결과가 없으면 토큰 상태 줄을 그리지 않는다', async () => {
    stubBrowser('denied')
    const { container } = render(<PushSettings />)
    await screen.findByText(PUSH_CONSENT_COPY.denied)
    expect(container.querySelector('[data-push-token]')).toBeNull()
  })

  it('조회 실패를 넘기면 상태 줄이 fail-closed 로 표시된다', async () => {
    stubBrowser('denied')
    const { container } = render(<PushSettings lookup={{ ok: false }} />)
    await screen.findByText(PUSH_CONSENT_COPY.denied)
    expect(container.querySelector('[data-push-token="unknown"]')).not.toBeNull()
    expect(screen.getByText('확인하지 못했어요')).toBeVisible()
  })

  it('아이폰 홈 화면 미설치면 설치 안내만 보여 준다', async () => {
    stubBrowser('default')
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')
    render(<PushSettings />)
    expect(await screen.findByText(PUSH_CONSENT_COPY.needsInstall)).toBeVisible()
  })

  it('30일이 지난 거절은 다시 안내한다', async () => {
    stubBrowser('default')
    window.localStorage.setItem('sohee-pwa-push-dismissed-at', String(Date.now() - 31 * DAY))
    window.localStorage.setItem('sohee-pwa-push-dismiss-count', '1')
    render(<PushSettings />)
    expect(await screen.findByRole('button', { name: PUSH_CONSENT_COPY.accept })).toBeVisible()
  })
})
