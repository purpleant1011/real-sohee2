import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import type { PushTokenLookup } from '@/features/pwa/push-token-status'
import { NotificationsEntry } from './notifications-entry'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/notifications',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/features/notifications/notification-center', () => ({ NotificationCenter: () => <p>legacy-notifications</p> }))
vi.mock('@/features/notifications/notifications-realtime', () => ({ NotificationsRealtime: () => null }))
vi.mock('@/features/notifications/actions/manage-notifications', () => ({
  markNotificationReadAction: vi.fn(),
  saveNotificationPreferencesAction: vi.fn(),
}))

const WS = '11111111-1111-4111-8111-111111111111'

const data = {
  userId: '22222222-2222-4222-8222-222222222222',
  preferences: { approvalEvents: true, scheduleEvents: true, publishEvents: true },
  notifications: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      kind: 'system' as const,
      body: '이번 주 성과 기록이 준비됐어요',
      href: '/app/results',
      readAt: null,
      createdAt: '2026-10-20T03:00:00.000Z',
    },
  ],
}

function narrow(matches: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }))
}

function renderEntry(r2: boolean, pushTokenLookup?: PushTokenLookup) {
  const tree = <NotificationsEntry data={data} workspaceId={WS} pushTokenLookup={pushTokenLookup} />
  return render(r2 ? <MobileR2Provider enabled>{tree}</MobileR2Provider> : tree)
}

afterEach(() => vi.unstubAllGlobals())

describe('/app/notifications 배선(ANI-1770)', () => {
  it('플래그 OFF(기본) 이면 기존 알림 센터', () => {
    narrow(true)
    renderEntry(false)
    expect(screen.getByText('legacy-notifications')).toBeVisible()
    expect(screen.queryByText('내 알림만 보여드려요.')).toBeNull()
  })

  it('플래그 ON 이어도 넓은 화면이면 기존 화면이며 PC 셸로 감싸진다', () => {
    narrow(false)
    renderEntry(true)
    expect(screen.getByText('legacy-notifications')).toBeVisible()
    expect(screen.getByTestId('business-world-pane')).toBeInTheDocument()
    expect(screen.queryByText('내 알림만 보여드려요.')).toBeNull()
  })

  it('플래그 ON + 좁은 화면이면 R2 알림함, 서버가 준 알림만 표시', () => {
    narrow(true)
    renderEntry(true)
    expect(screen.getByText('내 알림만 보여드려요.')).toBeVisible()
    expect(screen.getByText('이번 주 성과 기록이 준비됐어요')).toBeVisible()
    expect(screen.queryByText('legacy-notifications')).toBeNull()
  })

  it('플래그 ON + 좁은 화면이면 알림 설정이 서버 값 그대로 보인다', () => {
    narrow(true)
    renderEntry(true)
    expect(screen.getByRole('heading', { name: '알림 받을 소식' })).toBeVisible()
    for (const label of ['승인 요청', '예약·일정', '게시 결과']) {
      expect(screen.getByRole('switch', { name: label })).toHaveAttribute('aria-checked', 'true')
    }
    // 저장된 값과 같으므로 저장 버튼은 눌리지 않는다.
    expect(screen.getByRole('button', { name: '저장된 설정이에요' })).toBeDisabled()
  })

  it('플래그 OFF 이면 R2 알림 설정은 그리지 않는다', () => {
    narrow(true)
    renderEntry(false)
    expect(screen.queryByRole('heading', { name: '알림 받을 소식' })).toBeNull()
  })
})

describe('/app/notifications 푸시 구독 조회 배선(ANI-1724)', () => {
  const FUTURE = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()

  it('조회 결과를 넘기지 않으면 토큰 상태 줄을 그리지 않는다', () => {
    narrow(true)
    const { container } = renderEntry(true)
    expect(container.querySelector('[data-push-token]')).toBeNull()
  })

  it('서버가 준 유효 구독은 "준비됨"으로 표시한다', () => {
    narrow(true)
    const lookup: PushTokenLookup = { ok: true, record: { status: 'active', expiresAt: FUTURE } }
    const { container } = renderEntry(true, lookup)
    expect(container.querySelector('[data-push-token="active"]')).not.toBeNull()
    expect(screen.getByText('준비됨')).toBeVisible()
  })

  it('서버가 "없음"을 확인하면 등록 없음으로 표시한다', () => {
    narrow(true)
    const { container } = renderEntry(true, { ok: true, record: null })
    expect(container.querySelector('[data-push-token="not_registered"]')).not.toBeNull()
    expect(screen.getByText('아직 켜지 않았어요')).toBeVisible()
  })

  it('조회 실패는 등록 없음으로 바꾸지 않고 "확인하지 못했어요"로 남긴다', () => {
    narrow(true)
    const { container } = renderEntry(true, { ok: false })
    expect(container.querySelector('[data-push-token="unknown"]')).not.toBeNull()
    expect(screen.getByText('확인하지 못했어요')).toBeVisible()
    expect(screen.queryByText('아직 켜지 않았어요')).toBeNull()
  })
})

/**
 * 등급 B 근거 1 — 플래그 OFF 동일성.
 * 이 배포에는 구독 테이블이 없어 게이트가 꺼져 있다. 그 상태에서 page 가 실제로 호출하는
 * `readPushTokenLookup` 을 그대로 돌려 화면에 넣고, lookup 을 아예 넘기지 않은 화면과
 * 마크업이 같은지 본다. 배선을 넣기 전과 화면이 달라지지 않았다는 증거다.
 */
describe('/app/notifications 플래그 OFF 동일성(ANI-1724)', () => {
  it('게이트가 꺼진 현재 배포는 조회를 보내지 않고, 화면은 lookup 미주입과 완전히 같다', async () => {
    narrow(true)
    const { readPushTokenLookup, PUSH_SUBSCRIPTION_STORE_READY } = await import('@/features/pwa/server/read-push-token')
    expect(PUSH_SUBSCRIPTION_STORE_READY).toBe(false)

    const lookup = await readPushTokenLookup({ userId: data.userId })
    expect(lookup).toBeUndefined()

    const withLookup = renderEntry(true, lookup)
    const withLookupMarkup = withLookup.container.innerHTML
    withLookup.unmount()

    const withoutLookup = renderEntry(true)
    expect(withLookupMarkup).toBe(withoutLookup.container.innerHTML)
    expect(withoutLookup.container.querySelector('[data-push-token]')).toBeNull()
  })
})

/**
 * 등급 B 근거 2 — 토큰 값 비노출.
 * 서버가 실수로 endpoint·키를 함께 내려도 화면에는 상태 문구만 남아야 한다.
 * 표시 계약에 없는 필드는 컴포넌트가 읽지 않으므로 마크업에 새어 나가지 않는다.
 */
describe('/app/notifications 토큰 값 비노출(ANI-1724)', () => {
  const SECRET_ENDPOINT = 'https://push.example.test/secret-endpoint'
  const SECRET_KEY = 'secret-p256dh-key'
  const FUTURE = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()

  it('서버 record 에 비밀값이 섞여 와도 화면 마크업에 나오지 않는다', () => {
    narrow(true)
    const leaky = {
      ok: true as const,
      record: { status: 'active', expiresAt: FUTURE, endpoint: SECRET_ENDPOINT, p256dh: SECRET_KEY, auth: SECRET_KEY },
    } as unknown as PushTokenLookup
    const { container } = renderEntry(true, leaky)

    const markup = container.innerHTML
    expect(markup).not.toContain('secret')
    expect(markup).not.toContain('push.example.test')
    expect(markup).not.toContain(SECRET_ENDPOINT)
    expect(markup).not.toContain(SECRET_KEY)
    // 상태 문구만 나간다.
    expect(container.querySelector('[data-push-token="active"]')).not.toBeNull()
  })
})
