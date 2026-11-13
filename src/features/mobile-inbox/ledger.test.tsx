// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MobileLedgerView, type LedgerViewSnapshot } from './ledger-view'
import { entryDisplay, findConflicts, isMismatch, isStale, type LedgerEntryDto } from './ledger-model'
import * as useKakaoHistoryModule from '@/features/kakao/history/use-kakao-history'
import type { KakaoHistoryItem } from '@/features/kakao/history/contract'

vi.mock('@/features/kakao/history/use-kakao-history', () => ({
  useKakaoHistory: vi.fn().mockReturnValue({
    items: [],
    load: 'ready',
    refresh: vi.fn(),
  }),
}))

const WS = 'ws'
const NOW = '2026-10-23T02:00:00Z' // KST 11:00
function entry(o: Partial<LedgerEntryDto> = {}): LedgerEntryDto {
  return {
    id: 'e1', workspaceId: WS, customerName: '김민지', serviceLabel: '속눈썹펌',
    startsAt: '2026-10-23T05:00:00Z', endsAt: '2026-10-23T06:00:00Z', status: 'confirmed', source: 'owner_confirmed',
    ledgerVerifiedAt: '2026-10-23T01:58:00Z', otherSurfaceStatus: null, ...o,
  }
}
function snap(o: Partial<LedgerViewSnapshot> = {}): LedgerViewSnapshot {
  return { loadState: 'ready', entries: [entry()], workspaceId: WS, timeZone: 'Asia/Seoul', now: NOW, complete: true, checkedAt: '2026-10-23T01:58:00Z', ...o }
}

describe('ledger model', () => {
  it('예약표 확인 시각이나 근거가 없으면 확정으로 그리지 않는다', () => {
    expect(entryDisplay(entry())).toBe('confirmed')
    expect(entryDisplay(entry({ ledgerVerifiedAt: null }))).toBe('unverified')
    expect(entryDisplay(entry({ source: 'unverified' }))).toBe('unverified')
    expect(entryDisplay(entry({ status: 'pending_confirmation' }))).toBe('pending')
  })
  it('겹친 유효 예약은 둘 다 충돌, 취소·다른 가게는 제외', () => {
    const a = entry({ id: 'a' })
    const b = entry({ id: 'b', startsAt: '2026-10-23T05:30:00Z', endsAt: '2026-10-23T06:30:00Z' })
    const c = entry({ id: 'c', startsAt: '2026-10-23T06:30:00Z', endsAt: '2026-10-23T07:30:00Z' })
    expect([...findConflicts([a, b, c], WS)].sort()).toEqual(['a', 'b'])
    expect(findConflicts([a, { ...b, status: 'cancelled' }], WS).size).toBe(0)
    expect(findConflicts([a, { ...b, workspaceId: 'x' }], WS).size).toBe(0)
  })
  it('다른 화면 상태가 다르면 불일치', () => {
    expect(isMismatch(entry({ otherSurfaceStatus: 'pending_confirmation' }))).toBe(true)
    expect(isMismatch(entry({ otherSurfaceStatus: 'confirmed' }))).toBe(false)
  })
  it('확인 시각이 없거나 오래되면 stale', () => {
    expect(isStale(null, new Date(NOW))).toBe(true)
    expect(isStale('2026-10-23T01:58:00Z', new Date(NOW))).toBe(false)
    expect(isStale('2026-10-23T00:00:00Z', new Date(NOW))).toBe(true)
  })
})

describe('MobileLedgerView', () => {
  it('오늘 예약을 시각·출처와 함께 보여준다(KST)', () => {
    const { container } = render(<MobileLedgerView snapshot={snap()} />)
    expect(container.textContent).toContain('14:00')
    expect(container.textContent).toContain('기록 출처: 사장님이 확정')
    expect(screen.getByText('확정')).toBeTruthy()
  })
  it('조회 실패면 빈 표가 아니라 실패를 알린다', () => {
    const { container } = render(<MobileLedgerView snapshot={snap({ loadState: 'error' })} />)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(container.textContent).not.toContain('김민지')
  })
  it('확인 시각이 오래되면 stale 안내를 띄운다', () => {
    render(<MobileLedgerView snapshot={snap({ checkedAt: '2026-10-23T00:00:00Z' })} />)
    expect(screen.getByText('이전에 확인한 내용이에요')).toBeTruthy()
  })
  it('겹친 예약은 경고하고 두 건 모두 표시한다', () => {
    render(<MobileLedgerView snapshot={snap({ entries: [entry({ id: 'a' }), entry({ id: 'b', customerName: '이서연', startsAt: '2026-10-23T05:30:00Z', endsAt: '2026-10-23T06:30:00Z' })] })} />)
    expect(screen.getByRole('alert').textContent).toContain('겹친 예약')
    expect(screen.getAllByText('같은 시간에 다른 예약과 겹쳐요')).toHaveLength(2)
  })
  it('오늘 범위 밖(내일) 예약끼리 겹쳐도 오늘 화면에는 충돌 경고가 뜨지 않는다', () => {
    const mk = (id: string, s: string, e: string) => entry({ id, startsAt: s, endsAt: e })
    render(<MobileLedgerView snapshot={snap({ entries: [mk('a', '2026-10-25T05:00:00Z', '2026-10-25T06:00:00Z'), mk('b', '2026-10-25T05:30:00Z', '2026-10-25T06:30:00Z')] })} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('다른 가게 예약은 보이지 않는다', () => {
    const { container } = render(<MobileLedgerView snapshot={snap({ entries: [entry(), entry({ id: 'x', workspaceId: 'other', customerName: '타인' })] })} />)
    expect(container.textContent).not.toContain('타인')
  })
  it('내일 예약은 이번 주에서만 보이고, 읽기 전용이라 예약 변경 버튼이 없다', () => {
    const tomorrow = entry({ id: 't', customerName: '박내일', startsAt: '2026-10-24T05:00:00Z', endsAt: '2026-10-24T06:00:00Z' })
    const { container } = render(<MobileLedgerView snapshot={snap({ entries: [tomorrow] })} />)
    expect(container.textContent).not.toContain('박내일')
    fireEvent.click(screen.getByRole('button', { name: '이번 주' }))
    expect(container.textContent).toContain('박내일')
    expect(screen.queryByRole('button', { name: /확정하기|취소|변경|저장/ })).toBeNull()
  })
  it('빈 오늘은 확인된 빈 상태, 불완전하면 단정하지 않는다', () => {
    const { rerender } = render(<MobileLedgerView snapshot={snap({ entries: [] })} />)
    expect(screen.getByText('오늘 예약이 없어요')).toBeTruthy()
    rerender(<MobileLedgerView snapshot={snap({ entries: [], complete: false })} />)
    expect(screen.queryByText('오늘 예약이 없어요')).toBeNull()
  })
  it('예약 항목의 상태 뱃지에 shrink-0 whitespace-nowrap이 적용된다', () => {
    render(<MobileLedgerView snapshot={snap()} />)
    const badge = screen.getByText('확정')
    expect(badge.className).toContain('shrink-0')
    expect(badge.className).toContain('whitespace-nowrap')
  })

  it('워크스페이스 단위로 알림톡 내역을 1회 조회하여 예약 건별 최신 상태를 배지로 표시한다', () => {
    const useKakaoHistorySpy = vi.spyOn(useKakaoHistoryModule, 'useKakaoHistory')
    const kakaoItems: KakaoHistoryItem[] = [
      {
        id: 'k1',
        reservationId: 'e1',
        event: 'BOOKING_CONFIRMED',
        eventLabel: '예약 확정 안내',
        status: 'SENT',
        statusLabel: '보냈어요',
        detailLabel: null,
        dueAt: '2026-10-23T01:00:00Z',
        updatedAt: '2026-10-23T01:00:00Z',
      },
      {
        id: 'k2',
        reservationId: 'e1', // e1의 더 최신 항목
        event: 'REMINDER_24H',
        eventLabel: '방문 하루 전 안내',
        status: 'DELIVERED',
        statusLabel: '도착 확인',
        detailLabel: null,
        dueAt: '2026-10-23T02:00:00Z',
        updatedAt: '2026-10-23T02:00:00Z',
      },
    ]

    useKakaoHistorySpy.mockReturnValue({
      items: kakaoItems,
      load: 'ready',
      refresh: vi.fn(),
    })

    const { container } = render(
      <MobileLedgerView
        snapshot={snap({
          workspaceId: 'ws-test-42',
          entries: [
            entry({ id: 'e1', workspaceId: 'ws-test-42' }),
            entry({ id: 'e2', workspaceId: 'ws-test-42', customerName: '이서연', startsAt: '2026-10-23T07:00:00Z', endsAt: '2026-10-23T08:00:00Z' }),
          ],
        })}
      />,
    )

    // 워크스페이스 단위 1회 호출
    expect(useKakaoHistorySpy).toHaveBeenCalledWith({ workspaceId: 'ws-test-42' })

    // e1에는 최신 상태(DELIVERED -> 도착 확인) 배지가 표시됨
    expect(screen.getByText('알림톡 도착 확인')).toBeTruthy()
    // 이전 상태(SENT -> 보냈어요)는 덮어씌워져 표시되지 않음
    expect(screen.queryByText('알림톡 보냈어요')).toBeNull()

    // e2에는 알림톡 발송내역이 없으므로 배지가 표시되지 않음
    const e2Container = screen.getByText('이서연 · 속눈썹펌').closest('li')
    expect(e2Container?.textContent).not.toContain('알림톡')

    // 크레딧·비용 숫자 금지
    expect(container.textContent).not.toMatch(/크레딧|잔액|비용/)
  })

  it('단일 CTA 예약 등록 버튼이 렌더링되고 클릭 시 예약 등록 시트가 열린다', () => {
    const handleRefresh = vi.fn()
    render(<MobileLedgerView snapshot={snap()} onRefresh={handleRefresh} />)

    const registerBtn = screen.getByRole('button', { name: '예약 등록' })
    expect(registerBtn).toBeTruthy()

    // 클릭 전에는 시트 미노출
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(registerBtn)

    // 클릭 후 예약 등록 시트가 열림
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '예약 등록' })).toBeTruthy()
  })

  it('확정(confirmed)된 예약 건에는 44px 이상의 관리 버튼이 표시되고 클릭 시 예약 관리 시트가 열린다', () => {
    render(<MobileLedgerView snapshot={snap({ entries: [entry({ id: 'e1', status: 'confirmed' })] })} />)

    const manageBtn = screen.getByRole('button', { name: '관리' })
    expect(manageBtn).toBeTruthy()
    expect(manageBtn.className).toMatch(/min-h-(?:11|\[44px\])/)

    // 클릭 전에는 관리 시트 미노출
    expect(screen.queryByRole('heading', { name: '예약 관리' })).toBeNull()

    fireEvent.click(manageBtn)

    // 클릭 후 예약 관리 시트가 열림
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '예약 관리' })).toBeTruthy()
    expect(screen.getAllByText('김민지 · 속눈썹펌')).toHaveLength(2)
  })

  it('확정 대기 상태(pending_confirmation)인 건에도 관리 버튼이 표시되어 신청 관리 시트를 열 수 있다', () => {
    render(
      <MobileLedgerView
        snapshot={snap({
          entries: [entry({ id: 'e1', status: 'pending_confirmation', customerName: '이신청' })],
        })}
      />
    )

    const manageBtn = screen.getByRole('button', { name: '관리' })
    expect(manageBtn).toBeDefined()
    fireEvent.click(manageBtn)
    expect(screen.getByRole('heading', { name: '예약 신청 관리' })).toBeDefined()
  })

  it('완료(completed)된 건에는 관리 버튼이 표시되지 않는다', () => {
    render(
      <MobileLedgerView
        snapshot={snap({
          entries: [entry({ id: 'e1', status: 'completed' })],
        })}
      />
    )

    expect(screen.queryByRole('button', { name: '관리' })).toBeNull()
  })

  it('헤더에 신청 링크 복사 버튼이 렌더링된다', () => {
    render(
      <MobileLedgerView
        snapshot={snap({
          entries: [],
        })}
      />
    )

    expect(screen.getByRole('button', { name: /신청 링크 복사/ })).toBeDefined()
  })

  it('취소(cancelled)된 예약 건은 목록에서 숨겨진다', () => {
    const { container } = render(
      <MobileLedgerView
        snapshot={snap({
          entries: [
            entry({ id: 'e1', customerName: '김민지', status: 'confirmed' }),
            entry({ id: 'e2', customerName: '이취소', status: 'cancelled' }),
          ],
        })}
      />
    )

    expect(container.textContent).toContain('김민지')
    expect(container.textContent).not.toContain('이취소')
  })

  it('예시 화면(preview-*)에서는 관리 버튼이 비활성화된다', () => {
    render(
      <MobileLedgerView
        snapshot={snap({
          workspaceId: 'preview-workspace',
          entries: [entry({ id: 'e1', workspaceId: 'preview-workspace', status: 'confirmed' })],
        })}
      />
    )

    const manageBtn = screen.getByRole('button', { name: '관리' }) as HTMLButtonElement
    expect(manageBtn.disabled).toBe(true)
  })
})
