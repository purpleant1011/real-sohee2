// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MobileChannelsView, channelsScreenConfig, type ChannelsViewSnapshot } from './channels-view'
import type { MobileChannelDto } from './channel-readiness'
import { parseConnectFlow } from './channels-connect'

function ch(overrides: Partial<MobileChannelDto> = {}): MobileChannelDto {
  return {
    id: 'instagram',
    level: 'publish_verified',
    publishSupported: true,
    expired: false,
    restricted: false,
    needsExternalCheck: false,
    requiresDesktopConnector: false,
    connectedAccountMatches: true,
    lastCheckedAt: '2026-10-22T07:40:00Z',
    ...overrides,
  }
}

function makeSnapshot(overrides: Partial<ChannelsViewSnapshot> = {}): ChannelsViewSnapshot {
  return {
    loadState: 'ready',
    channels: [
      ch(),
      ch({ id: 'threads', level: 'account_connected' }),
      ch({ id: 'naver_blog', publishSupported: false, requiresDesktopConnector: true }),
      ch({ id: 'naver_place', needsExternalCheck: true }),
      ch({ id: 'daangn', expired: true }),
    ],
    checkedAt: '2026-10-22T07:40:00Z',
    ...overrides,
  }
}

describe('M21 채널 화면', () => {
  it.each(['publish_verified', 'permission_granted', 'account_connected'] as const)('%s 상태에서도 기본 권한으로 계정을 변경할 수 있다', (level) => {
    render(<MobileChannelsView snapshot={makeSnapshot({ channels: [ch({ level, username: 'current_shop' })], extendedScopesAllowed: false })} />)
    expect(screen.getByText('@current_shop')).toBeVisible()
    expect(screen.getByRole('link', { name: '인스타그램 다른 계정으로 변경' })).toHaveAttribute('href', '/api/channels/instagram/connect?returnPath=%2Fapp%2Fchannels')
    expect(screen.queryByRole('link', { name: /확장 권한/ })).toBeNull()
    expect(screen.getByText(/연결을 먼저 해제할 필요는 없어요/)).toBeInTheDocument()
  })

  it('외부 확인·만료 상태에서도 다른 계정으로 변경할 수 있다', () => {
    render(<MobileChannelsView snapshot={makeSnapshot({ channels: [ch({ needsExternalCheck: true }), ch({ id: 'threads', expired: true })] })} />)
    expect(screen.getByRole('link', { name: '인스타그램 다른 계정으로 변경' })).toBeVisible()
    expect(screen.getByRole('link', { name: '스레드 다른 계정으로 변경' })).toBeVisible()
  })

  it('Meta 권한 부족의 구체적 안내와 재시도를 모바일에서도 제공한다', () => {
    render(<MobileChannelsView snapshot={makeSnapshot()} connectFlow={parseConnectFlow('?connect=unavailable&connect_error=SCOPE_MISSING&channel=instagram')} />)
    expect(screen.getByText('게시 권한을 허용해 주세요')).toBeVisible()
    expect(screen.getByRole('link', { name: '다시 연결하기' })).toHaveAttribute('href', '/api/channels/instagram/connect?returnPath=%2Fapp%2Fchannels')
  })

  it('5개 채널을 모두 한국어 이름으로 보여준다', () => {
    render(<MobileChannelsView snapshot={makeSnapshot()} />)
    for (const name of ['인스타그램', '스레드', '네이버 블로그', '네이버 플레이스', '당근']) {
      expect(screen.getByText(name)).toBeTruthy()
    }
    expect(within(screen.getByRole('list', { name: '연결 채널' })).getAllByRole('listitem')).toHaveLength(5)
  })

  it('검증 완료 채널만 게시 가능으로 표시한다', () => {
    render(<MobileChannelsView snapshot={makeSnapshot()} />)
    expect(screen.getByText('게시 가능')).toBeTruthy()
  })

  it('PC 커넥터가 필요한 채널은 PC 작업 필요로 안내한다', () => {
    render(<MobileChannelsView snapshot={makeSnapshot({
      channels: [
        ch(),
        ch({ id: 'daangn', requiresDesktopConnector: true, publishSupported: true }),
      ],
    })} />)
    expect(screen.getByText('PC 작업 필요')).toBeTruthy()
    expect(screen.getByText('PC에서 올리기')).toBeTruthy()
  })

  it('만료·다른 계정 채널은 다시 연결을 안내한다', () => {
    render(<MobileChannelsView snapshot={makeSnapshot()} />)
    expect(screen.getByText('연결 만료')).toBeTruthy()
    expect(screen.getAllByText('다시 연결하기').length).toBeGreaterThan(0)
  })

  it('외부 확인이 필요한 채널은 그 사실을 숨기지 않는다', () => {
    render(<MobileChannelsView snapshot={makeSnapshot()} />)
    expect(screen.getByText('외부 확인 필요')).toBeTruthy()
    expect(screen.getByText('채널에서 확인하기')).toBeTruthy()
  })

  it('조회 실패면 목록 대신 실패를 알리고 채널을 그리지 않는다', () => {
    const { container } = render(<MobileChannelsView snapshot={makeSnapshot({ loadState: 'error' })} />)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByText('인스타그램')).toBeNull()
    expect(screen.queryByRole('listitem')).toBeNull()
    expect(container.textContent).not.toContain('게시 가능')
  })

  it('불러오는 중에는 채널 목록을 그리지 않는다', () => {
    const { container } = render(<MobileChannelsView snapshot={makeSnapshot({ loadState: 'loading' })} />)
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(container.textContent).not.toContain('인스타그램')
  })

  it('권한이 없으면 조회 실패도 빈 목록도 아닌 권한 안내로 알린다', () => {
    render(<MobileChannelsView snapshot={makeSnapshot({ loadState: 'error', accessDenied: true })} />)
    expect(screen.getByText('이 내용을 볼 권한이 없어요')).toBeVisible()
    expect(screen.queryByText('불러오지 못했어요')).toBeNull()
    expect(screen.queryByText('아직 아무것도 없어요')).toBeNull()
    expect(screen.queryByRole('listitem')).toBeNull()
  })

  it('채널이 없으면 빈 목록이 아니라 확인된 빈 상태로 알린다', () => {
    render(<MobileChannelsView snapshot={makeSnapshot({ channels: [] })} />)
    expect(screen.getByText('아직 아무것도 없어요')).toBeTruthy()
    expect(screen.queryByRole('listitem')).toBeNull()
  })

  it('내부 단계 코드를 사장님 화면에 노출하지 않는다', () => {
    const { container } = render(<MobileChannelsView snapshot={makeSnapshot()} />)
    for (const code of ['publish_verified', 'account_connected', 'permission_granted', 'not_connected', 'BROWSE']) {
      expect(container.textContent).not.toContain(code)
    }
  })

  it('채널 화면은 DETAIL 모드와 /app/system 복귀 계약을 따른다', () => {
    const config = channelsScreenConfig()
    expect(config.mode).toBe('DETAIL')
    expect(config.title).toBe('채널')
    expect(config.backHref).toBe('/app/system')
  })

  it('검증 중·점검 기록 없음을 정직하게 표시한다', () => {
    render(<MobileChannelsView snapshot={makeSnapshot({ channels: [ch({ verifying: true }), ch({ id: 'threads', lastCheckedAt: null })] })} />)
    expect(screen.getByText('검증 중')).toBeTruthy()
    expect(screen.getAllByText(/마지막 점검 기록 없음/).length).toBe(1)
  })

  it('확인 근거가 없는 채널은 기다리라고 하지 않고 직접 올리기를 안내한다', () => {
    render(<MobileChannelsView snapshot={makeSnapshot({
      channels: [ch({ id: 'naver_place', level: 'unknown', publishSupported: false, lastCheckedAt: null })],
    })} />)
    expect(screen.getByText('아직 확인할 수 없어요')).toBeTruthy()
    expect(screen.getByText('직접 올리기')).toBeTruthy()
    expect(screen.queryByText('조금 기다리기')).toBeNull()
    expect(screen.queryByText('게시 가능')).toBeNull()
  })

  it('미연결 채널의 계정 연결 안내는 실제 연결 경로로 간다', () => {
    render(<MobileChannelsView snapshot={makeSnapshot({
      channels: [ch({ id: 'instagram', level: 'not_connected', connectedAccountMatches: null })],
    })} />)
    const link = screen.getByRole('link', { name: '계정 연결하기' })
    expect(link.getAttribute('href')).toBe('/api/channels/instagram/connect?returnPath=%2Fapp%2Fchannels')
    expect(link.className).toContain('min-h-11')
  })

  it('만료·다른 계정 채널의 다시 연결은 실제 연결 경로로 가고 여전히 게시 불가다', () => {
    render(<MobileChannelsView snapshot={makeSnapshot({
      channels: [ch({ id: 'threads', expired: true })],
    })} />)
    const link = screen.getByRole('link', { name: '다시 연결하기' })
    expect(link.getAttribute('href')).toBe('/api/channels/threads/connect?returnPath=%2Fapp%2Fchannels')
    expect(screen.queryByText('게시 가능')).toBeNull()
  })

  it('연결 라우트가 없는 채널은 눌러도 아무 일 없는 링크를 만들지 않는다', () => {
    render(<MobileChannelsView snapshot={makeSnapshot({
      channels: [ch({ id: 'naver_place', level: 'not_connected', publishSupported: false, connectedAccountMatches: null })],
    })} />)
    expect(screen.queryByRole('link', { name: '계정 연결하기' })).toBeNull()
    expect(screen.getByText('계정 연결하기')).toBeTruthy()
  })

  it('연결 복귀 직후에는 readback 전까지 확인 중만 보여주고 게시 가능을 그리지 않는다', () => {
    const { rerender } = render(<MobileChannelsView
      snapshot={makeSnapshot({ loadState: 'loading', channels: [] })}
      connectFlow={parseConnectFlow('?connect=authorized&channel=instagram')} />)
    expect(screen.getByText('연결을 확인하는 중이에요')).toBeTruthy()
    expect(screen.queryByText('게시 가능')).toBeNull()
    rerender(<MobileChannelsView
      snapshot={makeSnapshot({ channels: [ch({ id: 'instagram', level: 'account_connected' })] })}
      connectFlow={parseConnectFlow('?connect=connected&channel=instagram')} />)
    expect(screen.queryByText('게시 가능')).toBeNull()
  })

  it('readback 실패는 확인하지 못했어요와 다시 확인 링크로 끝난다', () => {
    render(<MobileChannelsView
      snapshot={makeSnapshot({ loadState: 'error', channels: [] })}
      connectFlow={parseConnectFlow('?connect=connected&channel=instagram')} />)
    expect(screen.getByText('확인하지 못했어요')).toBeTruthy()
    expect(screen.getByRole('link', { name: '다시 확인하기' }).getAttribute('href')).toBe('/app/channels')
    expect(screen.queryByText('게시 가능')).toBeNull()
  })

  it('취소는 안내와 다시 연결 버튼을 준다', () => {
    render(<MobileChannelsView
      snapshot={makeSnapshot()}
      connectFlow={parseConnectFlow('?connect=cancelled&channel=threads')} />)
    expect(screen.getByText('새 연결을 완료하지 못했어요')).toBeTruthy()
    expect(screen.getByRole('link', { name: '다시 연결하기' }).getAttribute('href'))
      .toBe('/api/channels/threads/connect?returnPath=%2Fapp%2Fchannels')
  })

  it.each([
    ['invalid', '연결 정보가 맞지 않아요', true],
    ['unavailable', '지금은 연결을 확인할 수 없어요', false],
    ['forbidden', '이 계정으로는 연결할 권한이 없어요', true],
  ] as const)('%s 결과는 안내하고 게시 가능은 그리지 않는다', (code, title, retry) => {
    render(<MobileChannelsView
      snapshot={makeSnapshot({ channels: [ch({ id: 'instagram', level: 'account_connected' })] })}
      connectFlow={parseConnectFlow(`?connect=${code}&channel=instagram`)} />)
    expect(screen.getByText(title)).toBeTruthy()
    expect(screen.queryByText('게시 가능')).toBeNull()
    expect(screen.queryAllByRole('link', { name: '다시 연결하기' })).toHaveLength(retry ? 1 : 0)
    if (retry) {
      expect(screen.getByRole('link', { name: '다시 연결하기' }).getAttribute('href'))
        .toBe('/api/channels/instagram/connect?returnPath=%2Fapp%2Fchannels')
    }
  })

  it('모르는 값은 무시한다', () => {
    expect(parseConnectFlow('?connect=hacked&channel=instagram')).toBeNull()
    expect(parseConnectFlow('?connect=&channel=instagram')).toBeNull()
    expect(parseConnectFlow('?connect=AUTHORIZED&channel=instagram')).toBeNull()
    render(<MobileChannelsView snapshot={makeSnapshot()} connectFlow={parseConnectFlow('?connect=hacked')} />)
    expect(screen.queryByText(/연결을 확인하는 중|연결을 취소했어요|확인하지 못했어요|연결 정보가 맞지 않아요|지금은 연결을 확인할 수 없어요|연결할 권한이 없어요/)).toBeNull()
  })

  it('네이버 블로그 카드는 PC 문구 없이 직접 게시 라벨, 정직한 안내, 원고 준비 CTA 링크를 보여준다', () => {
    const { container } = render(<MobileChannelsView snapshot={makeSnapshot({
      channels: [ch({ id: 'naver_blog', level: 'account_connected', publishSupported: false, requiresDesktopConnector: true })],
    })} />)
    expect(screen.getByText('직접 게시')).toBeTruthy()
    expect(screen.getByText('소희는 네이버에 자동으로 올리지 않아요. 원고와 사진을 준비해 드리면 복사해서 네이버 글쓰기에서 직접 올려 주세요.')).toBeTruthy()
    const link = screen.getByRole('link', { name: '원고 준비하러 가기' })
    expect(link.getAttribute('href')).toBe('/app/content')
    expect(container.textContent).not.toContain('PC 작업 필요')
    expect(container.textContent).not.toContain('PC에서 올리기')
    expect(screen.queryByText('게시 가능')).toBeNull()
  })

  it('extendedScopesAllowed가 true이면 메타 채널(인스타그램·스레드)에만 44px 터치·16px 폰트의 확장 권한 액션이 노출된다', () => {
    render(<MobileChannelsView snapshot={makeSnapshot({ extendedScopesAllowed: true })} />)

    const igLink = screen.getByRole('link', {
      name: '인스타그램 확장 권한으로 다시 연결 (댓글·DM·인사이트)',
    })
    const thLink = screen.getByRole('link', {
      name: '스레드 확장 권한으로 다시 연결 (댓글·DM·인사이트)',
    })

    expect(igLink).toHaveAttribute('href', '/api/channels/instagram/connect?returnPath=/app/channels&extended=1')
    expect(thLink).toHaveAttribute('href', '/api/channels/threads/connect?returnPath=/app/channels&extended=1')
    expect(igLink.className).toMatch(/min-h-\[44px\]/)
    expect(igLink.className).toMatch(/text-\[16px\]|text-base/)

    // 네이버 블로그/당근 등에는 확장 권한 액션 없음
    expect(screen.queryByRole('link', { name: /네이버.*확장 권한/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /당근.*확장 권한/ })).toBeNull()
  })

  it('채널 카드에 실시간 알림 상태가 정직하게 표시되고 기술 용어나 크레딧이 없다', () => {
    const { container } = render(
      <MobileChannelsView
        snapshot={makeSnapshot({
          channels: [
            ch({ id: 'instagram', level: 'publish_verified', webhook_status: 'healthy' }),
            ch({ id: 'threads', level: 'account_connected', webhook_status: 'pending' }),
            ch({ id: 'naver_blog', level: 'account_connected', webhook_status: null }),
          ],
        })}
      />
    )

    // healthy인 인스타그램: '새 댓글·메시지 받기 켜져 있어요'
    expect(screen.getByText('새 댓글·메시지 받기 켜져 있어요')).toBeInTheDocument()

    // pending이나 null인 스레드, 네이버 블로그: '새 댓글·메시지 받기 확인 중'
    const pendingNotices = screen.getAllByText('새 댓글·메시지 받기 확인 중')
    expect(pendingNotices).toHaveLength(2)

    // 기술 용어('웹훅', '구독 검증') 및 크레딧 숫자 금지
    expect(container.textContent).not.toMatch(/웹훅|구독 검증|구독검증/)
    expect(container.textContent).not.toMatch(/크레딧|\d+C|\d+P/)
  })
})
