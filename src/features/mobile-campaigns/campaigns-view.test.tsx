// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { MobileCustomerDto } from '@/features/mobile-customers/customer-model'
import type { CreditLedger } from '@/features/mobile-settings/credit-model'
import {
  MobileCampaignsView,
  campaignsScreenConfig,
  type CampaignCandidate,
  type CampaignsViewSnapshot,
} from './campaigns-view'
import type { CampaignProposal, ChannelPublishState, EmptySlot } from './campaign-model'

const WORKSPACE = 'w1'

const customer = (o: Partial<MobileCustomerDto> = {}): MobileCustomerDto => ({
  id: 'c1',
  workspaceId: WORKSPACE,
  displayName: '김민지',
  segment: 'revisit',
  consent: { status: 'granted', checkedAt: '2026-10-20T00:00:00Z', source: '예약 시 동의' },
  verifiedContacts: ['message'],
  lastAction: null,
  sourceLabel: null,
  ...o,
})

const slot = (o: Partial<EmptySlot> = {}): EmptySlot => ({
  id: 's1',
  workspaceId: WORKSPACE,
  serviceLabel: '속눈썹 연장',
  startsAt: '2026-10-23T06:00:00Z',
  availability: 'confirmed_open',
  observedAt: '2026-10-22T09:50:00Z',
  sourceLabel: '예약표',
  ...o,
})

const proposal = (o: Partial<CampaignProposal> = {}): CampaignProposal => ({
  id: 'p1',
  workspaceId: WORKSPACE,
  kind: 'empty_slot_rescue',
  slotId: 's1',
  message: '내일 3시 자리가 비었어요',
  audienceIds: ['c1'],
  estimatedConversions: 2,
  sentTo: [],
  approvedAt: null,
  dispatchIdempotencyKey: 'dispatch-p1',
  ...o,
})

const channel = (o: Partial<ChannelPublishState> = {}): ChannelPublishState => ({
  channelLabel: '인스타그램',
  publishable: true,
  reason: null,
  next: null,
  ...o,
})

const ledger = (o: Partial<CreditLedger> = {}): CreditLedger => ({
  available: 100,
  reserved: 0,
  consumed: 10,
  refunded: 0,
  observedAt: '2026-10-22T09:00:00Z',
  ...o,
})

const candidate = (o: Partial<CampaignCandidate> = {}): CampaignCandidate => ({
  proposal: proposal(),
  slot: slot(),
  channel: channel(),
  ledger: ledger(),
  estimate: 5,
  actualConversions: null,
  actualSource: null,
  ...o,
})

function makeSnapshot(overrides: Partial<CampaignsViewSnapshot> = {}): CampaignsViewSnapshot {
  return {
    loadState: 'ready',
    candidates: [candidate()],
    customers: [customer()],
    now: '2026-10-22T10:00:00Z',
    checkedAt: '2026-10-22T09:55:00Z',
    ...overrides,
  }
}

const approveButton = () => screen.getByRole('button', { name: '문구 확인하고 승인' }) as HTMLButtonElement

const renderView = (snapshot: CampaignsViewSnapshot, onApprove = vi.fn()) =>
  render(<MobileCampaignsView snapshot={snapshot} onApprove={onApprove} />)

describe('M18 캠페인 제안 화면', () => {
  it('채널 게시가 확인되지 않으면 승인 버튼을 잠그고 사유를 보여준다', () => {
    const onApprove = vi.fn()
    const { container } = renderView(
      makeSnapshot({
        candidates: [
          candidate({ channel: channel({ publishable: false, reason: '게시 권한 심사가 끝나지 않았어요', next: '채널 다시 확인' }) }),
        ],
      }),
      onApprove,
    )

    expect(screen.getByText(/게시 권한 심사가 끝나지 않았어요/)).toBeTruthy()
    expect(screen.getByText(/채널 다시 확인/)).toBeTruthy()
    expect(approveButton().disabled).toBe(true)
    fireEvent.click(approveButton())
    expect(onApprove).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('발송 준비 완료')
  })

  it('크레딧 잔액을 확인하지 못하면 승인 전에 멈춘다', () => {
    const onApprove = vi.fn()
    renderView(makeSnapshot({ candidates: [candidate({ ledger: ledger({ available: null }) })] }), onApprove)

    expect(screen.getByText(/잔액을 확인하지 못했어요/)).toBeTruthy()
    expect(approveButton().disabled).toBe(true)
    fireEvent.click(approveButton())
    expect(onApprove).not.toHaveBeenCalled()
  })

  it('연락할 수 있는 고객이 없으면 0명으로 보이고 승인은 막힌다', () => {
    const onApprove = vi.fn()
    const { container } = renderView(
      makeSnapshot({
        customers: [customer({ consent: { status: 'withdrawn', checkedAt: null, source: null } })],
      }),
      onApprove,
    )

    expect(screen.getAllByText(/지금 연락해도 되는 고객이 없어요/).length).toBeGreaterThan(0)
    expect(container.textContent).toContain('수신 동의가 확인되지 않아요 1명')
    expect(approveButton().disabled).toBe(true)
    fireEvent.click(approveButton())
    expect(onApprove).not.toHaveBeenCalled()
  })

  it('모든 확인이 끝나면 승인 버튼이 열리고 제안을 그대로 넘긴다', () => {
    const onApprove = vi.fn()
    const target = proposal()
    renderView(makeSnapshot({ candidates: [candidate({ proposal: target })] }), onApprove)

    expect(screen.getByText('사장님 승인 전')).toBeTruthy()
    const button = approveButton()
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    expect(onApprove).toHaveBeenCalledTimes(1)
    expect(onApprove).toHaveBeenCalledWith(target)
  })

  it('승인된 제안도 발송 완료가 아니라 외부 게시 전으로만 표시한다', () => {
    const { container } = renderView(makeSnapshot({ candidates: [candidate({ proposal: proposal({ approvedAt: '2026-10-22T09:58:00Z' }) })] }))

    expect(screen.getByText('승인 완료')).toBeTruthy()
    expect(screen.getByText('발송 준비 완료 · 외부 게시 전')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '문구 확인하고 승인' })).toBeNull()
    expect(container.textContent).not.toContain('발송 완료')
    expect(container.textContent).not.toContain('게시 완료')
  })

  it('승인 후 채널을 쓸 수 없으면 보낼 수 없다고 알린다', () => {
    const { container } = renderView(
      makeSnapshot({
        candidates: [
          candidate({
            proposal: proposal({ approvedAt: '2026-10-22T09:58:00Z' }),
            channel: channel({ publishable: false, reason: '게시 권한 심사가 끝나지 않았어요', next: '채널 다시 확인' }),
          }),
        ],
      }),
    )

    expect(screen.getByText('승인은 됐지만 지금은 보낼 수 없어요')).toBeTruthy()
    expect(container.textContent).not.toContain('발송 준비 완료')
  })

  it('실측 전환이 없으면 예상으로만 표시하고 실적으로 쓰지 않는다', () => {
    const { container } = renderView(makeSnapshot())

    expect(container.textContent).toContain('예상 예약 2건')
    expect(container.textContent).toContain('소희 계산값 · 실적 아님')
    expect(container.textContent).not.toContain('출처 ')
  })

  it('실측 출처가 있을 때만 예약 건수를 실적으로 표시한다', () => {
    const { container } = renderView(
      makeSnapshot({ candidates: [candidate({ actualConversions: 2, actualSource: '예약표 10-22' })] }),
    )

    expect(container.textContent).toContain('예약 2건 · 출처 예약표 10-22')
    // 하단 공통 캡션은 제외하고, 카드의 결과 줄에서만 예상값이 사라졌는지 본다.
    expect(screen.getByRole('listitem').textContent).not.toContain('예상 예약')
  })

  it('오래된 빈자리 관측은 열린 자리로 주장하지 않는다', () => {
    const onApprove = vi.fn()
    const { container } = renderView(
      makeSnapshot({ now: '2026-10-22T11:00:00Z' }),
      onApprove,
    )

    expect(screen.getByText('빈자리 정보가 오래되어 다시 확인이 필요해요')).toBeTruthy()
    expect(screen.getByText(/빈자리 정보를 확인하지 못했어요/)).toBeTruthy()
    // 오래된 관측은 발송 준비 완료로 승격되지 않는다.
    expect(container.textContent).not.toContain('발송 준비 완료')
    expect(approveButton().disabled).toBe(true)
    fireEvent.click(approveButton())
    expect(onApprove).not.toHaveBeenCalled()
  })

  it('확인 시각을 모르면 빈자리를 열린 것으로 보지 않는다', () => {
    renderView(makeSnapshot({ now: null }))

    expect(screen.getByText(/빈자리 정보를 확인하지 못했어요/)).toBeTruthy()
    expect(approveButton().disabled).toBe(true)
  })

  it('불러오지 못한 상태에서는 제안 카드를 그리지 않는다', () => {
    renderView(makeSnapshot({ loadState: 'error' }))

    expect(screen.getByText('불러오지 못했어요')).toBeTruthy()
    expect(screen.queryByText('내일 3시 자리가 비었어요')).toBeNull()
    expect(screen.queryByRole('list', { name: '캠페인 제안' })).toBeNull()
  })

  it('이전에 확인한 내용이면 배너를 띄우고 확인된 카드만 그린다', () => {
    renderView(makeSnapshot({ loadState: 'stale' }))

    expect(screen.getByText('이전에 확인한 내용이에요')).toBeTruthy()
    expect(screen.getByText('내일 3시 자리가 비었어요')).toBeTruthy()
  })

  it('확인된 제안이 없으면 오류가 아니라 0건으로 보여준다', () => {
    renderView(makeSnapshot({ candidates: [] }))

    expect(screen.getByText('제안이 없어요')).toBeTruthy()
    expect(screen.getByText('확인해 보니 지금 제안할 캠페인이 없습니다.')).toBeTruthy()
    expect(screen.queryByText('불러오지 못했어요')).toBeNull()
  })

  it('셸 화면 설정은 탐색 모드 제안 제목을 쓴다', () => {
    expect(campaignsScreenConfig()).toEqual({ mode: 'BROWSE', title: '제안' })
  })

  it('예시 태그에 shrink-0 whitespace-nowrap이 적용된다', () => {
    render(<MobileCampaignsView snapshot={makeSnapshot()} onApprove={vi.fn()} example />)
    const tag = screen.getAllByText('예시')[0]
    expect(tag.className).toContain('shrink-0')
    expect(tag.className).toContain('whitespace-nowrap')
  })
})
