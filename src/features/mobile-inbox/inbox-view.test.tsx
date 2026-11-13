// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MobileInboxView, type InboxViewSnapshot } from './inbox-view'
import { replyPath, type InboxThreadDto } from './inbox-model'

const WS = 'ws-1'

function thread(o: Partial<InboxThreadDto> = {}): InboxThreadDto {
  return {
    id: 't1', workspaceId: WS, channel: 'instagram_dm', customerName: '김민지', consent: 'granted',
    status: 'draft_ready', unread: true,
    lastMessage: { text: '목요일 오후에 예약 가능한가요?', receivedAt: '2026-10-22T05:00:00Z', fromCustomer: true },
    draft: { text: '목요일 2시 가능해요.', sources: ['예약표'] }, sendBlockers: [], ...o,
  }
}
function snap(o: Partial<InboxViewSnapshot> = {}): InboxViewSnapshot {
  return { loadState: 'ready', threads: [thread()], workspaceId: WS, complete: true, checkedAt: '2026-10-22T07:40:00Z', ...o }
}

describe('M13 소통함', () => {
  it('조회 실패면 빈 목록이 아니라 실패를 알리고 원문을 그리지 않는다', () => {
    const { container } = render(<MobileInboxView snapshot={snap({ loadState: 'error' })} />)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(container.textContent).not.toContain('목요일')
  })

  it('권한이 없으면 조회 실패도 빈 목록도 아닌 권한 안내로 알린다', () => {
    render(<MobileInboxView snapshot={snap({ loadState: 'error', threads: [], complete: false, authFailure: 'forbidden' })} />)
    expect(screen.getByText('이 내용을 볼 권한이 없어요')).toBeTruthy()
    expect(screen.getByText('가게 관리자에게 권한을 요청해 주세요.')).toBeTruthy()
    // 다시 확인해도 풀리지 않는 실패이므로 재시도 문구를 쓰지 않는다.
    expect(screen.queryByText('불러오지 못했어요')).toBeNull()
    expect(screen.queryByText('새 문의가 없어요')).toBeNull()
    // 권한이 없으면 건수도 알 수 없다. 0건 칩을 그리면 '문의가 없다'로 잘못 읽힌다.
    expect(screen.queryByRole('group', { name: '채널 고르기' })).toBeNull()
  })

  it('로그인이 만료되면 권한 없음이 아니라 다시 로그인할 일로 알린다', () => {
    render(<MobileInboxView snapshot={snap({ loadState: 'error', threads: [], complete: false, authFailure: 'expired' })} />)
    expect(screen.getByText('로그인이 만료됐어요')).toBeTruthy()
    expect(screen.getByText('다시 로그인하면 이어서 볼 수 있어요.')).toBeTruthy()
    expect(screen.queryByText('이 내용을 볼 권한이 없어요')).toBeNull()
    expect(screen.queryByText('불러오지 못했어요')).toBeNull()
    expect(screen.queryByText('새 문의가 없어요')).toBeNull()
    expect(screen.queryByRole('group', { name: '채널 고르기' })).toBeNull()
  })

  it('소통함 목록 카드는 제목 1줄과 상태를 보여주고 상세 이동 버튼을 제공한다', () => {
    render(<MobileInboxView snapshot={snap()} onOpenThread={() => {}} />)
    expect(screen.getByText('김민지')).toBeTruthy()
    expect(screen.getByRole('button', { name: '답안 검토하기' })).toBeTruthy()
  })

  it('원문·답안 소스가 없으면 주 동작 버튼을 그리지 않는다', () => {
    render(<MobileInboxView
      snapshot={snap({ threads: [thread({ lastMessage: null, draft: null, status: 'needs_reply' })] })}
      onOpenThread={() => {}}
      onCopyDraft={() => {}}
    />)
    expect(screen.queryByRole('button', { name: '답안 복사' })).toBeNull()
    expect(screen.queryByRole('button', { name: '답안 검토하기' })).toBeNull()
  })

  it('상세 화면이 배선되지 않았으면 눌러도 아무 일이 없는 주 동작을 그리지 않는다', () => {
    render(<MobileInboxView snapshot={snap()} />)
    expect(screen.queryByRole('button', { name: '답안 검토하기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '대화 보기' })).toBeNull()
  })

  it('상세 이동이 배선되면 주 동작이 그 스레드로 이동한다', () => {
    const onOpen = vi.fn()
    render(<MobileInboxView snapshot={snap()} onOpenThread={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: '답안 검토하기' }))
    expect(onOpen).toHaveBeenCalledWith('t1')
  })

  it('전송 권한이 없으면 검토 대신 복사·직접 보내기만 준다', () => {
    const onCopy = vi.fn()
    render(<MobileInboxView snapshot={snap({ threads: [thread({ sendBlockers: ['NO_SEND_SCOPE'] })] })} onCopyDraft={onCopy} />)
    expect(screen.queryByRole('button', { name: '답안 검토하기' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '답안 복사' }))
    expect(onCopy).toHaveBeenCalledWith('t1', '목요일 2시 가능해요.')
  })

  it('다른 가게 스레드는 목록과 개수에서 제외한다', () => {
    const { container } = render(<MobileInboxView snapshot={snap({ threads: [thread(), thread({ id: 'x', workspaceId: 'other', customerName: '타인' })] })} />)
    expect(container.textContent).not.toContain('타인')
    expect(screen.getByRole('button', { name: /^전체 1$/ })).toBeTruthy()
  })

  it('채널 필터가 목록을 줄이고 빈 채널은 확인된 빈 상태로 보인다', () => {
    render(<MobileInboxView snapshot={snap()} />)
    fireEvent.click(screen.getByRole('button', { name: /^카카오톡 0$/ }))
    expect(screen.getByText('새 문의가 없어요')).toBeTruthy()
  })

  it('목록이 불완전하면 비어 있어도 없다고 단정하지 않는다', () => {
    render(<MobileInboxView snapshot={snap({ threads: [], complete: false })} />)
    expect(screen.queryByText('새 문의가 없어요')).toBeNull()
  })

  it('채널 필터 칩 목록이 가로 스크롤 snap 및 shrink-0 whitespace-nowrap, min-h-11 터치 크기를 준수한다', () => {
    render(<MobileInboxView snapshot={snap()} />)
    const chipGroup = screen.getByRole('group', { name: '채널 고르기' })
    expect(chipGroup.className).toContain('overflow-x-auto')
    expect(chipGroup.className).toContain('snap-x')
    const buttons = screen.getAllByRole('button', { name: /전체|Instagram/ })
    for (const btn of buttons) {
      expect(btn.className).toContain('shrink-0')
      expect(btn.className).toContain('whitespace-nowrap')
      expect(btn.className).toContain('min-h-11')
    }
  })
})

describe('replyPath', () => {
  it('철회 동의·답안 없음은 보낼 길이 없다', () => {
    expect(replyPath(thread({ consent: 'withdrawn' })).kind).toBe('none')
    expect(replyPath(thread({ draft: null })).kind).toBe('none')
  })
  it('동의 미확인 DM 은 검토로 가지 못한다(fail-closed)', () => {
    expect(replyPath(thread({ consent: 'unknown' })).kind).toBe('manual')
    expect(replyPath(thread()).kind).toBe('review')
  })
})
