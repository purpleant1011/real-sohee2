import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EngagementDmThreadCard } from './engagement-dm-thread-card'
import { DM_EXPIRED_KOREAN_MESSAGE } from './dm/options-generator'
import type { InstagramDmThreadItem } from './dm/types'

const mockThread: InstagramDmThreadItem = {
  id: 'th-1',
  workspace_id: 'ws-1',
  channel_connection_id: 'conn-1',
  channel: 'instagram',
  provider_thread_id: 'prov-th-1',
  customer_id: 'cust-1',
  customer_handle: 'tester_user',
  customer_name: '홍길동',
  last_message_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 20 * 3600 * 1000).toISOString(),
  status: 'NEEDS_REPLY',
  last_message_text: '예약 문의드립니다!',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  channel_label: 'Instagram',
  account_label: '@my_shop',
  status_label: '답장 필요',
  countdown_text: '20시간 남음',
  is_expired: false,
  remaining_seconds: 72000,
  draft: {
    id: 'dr-1',
    workspace_id: 'ws-1',
    thread_id: 'th-1',
    selected_option_id: 'opt_reservation',
    options: [
      { id: 'opt_reservation', label: '방문 및 예약 안내', draftText: '예약 안내드립니다.' },
      { id: 'opt_hours_location', label: '영업시간 및 위치 안내', draftText: '영업시간 안내드립니다.' },
    ],
    draft_text: '예약 안내드립니다.',
    approved_fingerprint: null,
    approved_by: null,
    approved_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  messages: [
    {
      id: 'm-1',
      workspace_id: 'ws-1',
      thread_id: 'th-1',
      provider_message_id: 'p-m-1',
      sender_type: 'customer',
      sender_id: 'cust-1',
      text: '예약 문의드립니다!',
      sent_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    },
  ],
}

describe('EngagementDmThreadCard UI Component', () => {
  it('does not invent available booking slots without a verified schedule source', () => {
    const update = vi.fn()
    render(<EngagementDmThreadCard thread={mockThread} sendEnabled onOpenSendDialog={vi.fn()} onSelectOption={vi.fn()} onRegenerateDraft={vi.fn()} onDismiss={vi.fn()} onUpdateDraft={update} />)
    expect(screen.queryByText(/소희 예약 가용 슬롯 추천/)).toBeNull()
    expect(screen.queryByRole('button', { name: /가용 시간 전체 삽입/ })).toBeNull()
    expect(screen.getByText('예약 가능 시간은 고객 수락·서비스·가격·예약표를 확인한 뒤 안내해 주세요.')).toBeVisible()
    expect(screen.getByRole('textbox')).toHaveValue('예약 안내드립니다.')
    expect(update).not.toHaveBeenCalled()
  })
  it('opens the source conversation for booking review rather than claiming ledger confirmation', () => {
    render(<EngagementDmThreadCard thread={mockThread} sendEnabled onOpenSendDialog={vi.fn()} onSelectOption={vi.fn()} onRegenerateDraft={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByRole('link', { name: '문의·예약 조건 검토' })).toHaveAttribute('href', '/app/engagement/dm%3Ath-1')
    expect(screen.queryByText(/고객 장부에서 예약 확정/)).toBeNull()
  })
  it('renders thread header, timeline messages, and countdown badge', () => {
    render(
      <EngagementDmThreadCard
        thread={mockThread}
        sendEnabled={true}
        onOpenSendDialog={vi.fn()}
        onSelectOption={vi.fn()}
        onRegenerateDraft={vi.fn()}
        onDismiss={vi.fn()}
      />
    )

    expect(screen.getAllByText('@tester_user').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('20시간 남음')).toBeInTheDocument()
    expect(screen.getByText('예약 문의드립니다!')).toBeInTheDocument()
  })

  it('renders direction option chips and populates textarea when clicked', () => {
    const onSelectOption = vi.fn().mockResolvedValue(undefined)

    render(
      <EngagementDmThreadCard
        thread={mockThread}
        sendEnabled={true}
        onOpenSendDialog={vi.fn()}
        onSelectOption={onSelectOption}
        onRegenerateDraft={vi.fn()}
        onDismiss={vi.fn()}
      />
    )

    const hoursChip = screen.getByRole('radio', { name: '영업시간 및 위치 안내' })
    expect(hoursChip).toBeInTheDocument()

    fireEvent.click(hoursChip)
    expect(onSelectOption).toHaveBeenCalledWith('th-1', 'opt_hours_location')

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe('영업시간 안내드립니다.')
  })

  it('displays 24h expiration warning banner and disables send when expired (Hard Invariant 2)', () => {
    const expiredThread: InstagramDmThreadItem = {
      ...mockThread,
      is_expired: true,
      status: 'EXPIRED',
      status_label: '만료됨',
      countdown_text: '만료됨',
    }

    render(
      <EngagementDmThreadCard
        thread={expiredThread}
        sendEnabled={true}
        onOpenSendDialog={vi.fn()}
        onSelectOption={vi.fn()}
        onRegenerateDraft={vi.fn()}
        onDismiss={vi.fn()}
      />
    )

    expect(screen.getByText(DM_EXPIRED_KOREAN_MESSAGE)).toBeInTheDocument()
    // 만료된 경우 [만료됨] 뱃지가 2개 중복 렌더링되지 않고 1개만 노출되어야 한다
    expect(screen.getAllByText('만료됨')).toHaveLength(1)
    const textarea = screen.getByRole('textbox')
    expect(textarea).toBeDisabled()

    const sendBtn = screen.getByRole('button', { name: /답장 보내기/ })
    expect(sendBtn).toBeDisabled()
  })

  it('triggers send dialog when 답장 보내기 button is clicked', () => {
    const onOpenSendDialog = vi.fn()

    render(
      <EngagementDmThreadCard
        thread={mockThread}
        sendEnabled={true}
        onOpenSendDialog={onOpenSendDialog}
        onSelectOption={vi.fn()}
        onRegenerateDraft={vi.fn()}
        onDismiss={vi.fn()}
      />
    )

    const sendBtn = screen.getByRole('button', { name: /답장 보내기/ })
    expect(sendBtn).not.toBeDisabled()
    fireEvent.click(sendBtn)

    expect(onOpenSendDialog).toHaveBeenCalledWith(mockThread, '예약 안내드립니다.')
  })
})
