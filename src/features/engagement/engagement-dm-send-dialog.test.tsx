import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EngagementDmSendDialog } from './engagement-dm-send-dialog'

describe('EngagementDmSendDialog (Hard Invariant 4: 100% Owner Approval)', () => {
  it('renders confirmation dialog with channel, account and customer handle', () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <EngagementDmSendDialog
        open={true}
        onOpenChange={onOpenChange}
        channelLabel="Instagram"
        accountLabel="@my_store"
        customerHandle="customer_1"
        replyText="안녕하세요! 예약 안내 도와드릴게요."
        onConfirm={onConfirm}
      />
    )

    expect(screen.getByText('이 메시지를 보낼까요?')).toBeInTheDocument()
    expect(screen.getByText('안녕하세요! 예약 안내 도와드릴게요.')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Instagram (@my_store) · @customer_1 고객에게 직접 1:1 메시지로 전송돼요. 보낸 뒤에는 소희에서 되돌릴 수 없어요.'
      )
    ).toBeInTheDocument()
  })

  it('calls onConfirm when 보내기 button is clicked', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onOpenChange = vi.fn()

    render(
      <EngagementDmSendDialog
        open={true}
        onOpenChange={onOpenChange}
        channelLabel="Instagram"
        accountLabel="@my_store"
        customerHandle="customer_1"
        replyText="메시지 내용"
        onConfirm={onConfirm}
      />
    )

    const sendBtn = screen.getByRole('button', { name: '보내기' })
    fireEvent.click(sendBtn)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('cancels dialog when 취소 button is clicked', () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <EngagementDmSendDialog
        open={true}
        onOpenChange={onOpenChange}
        channelLabel="Instagram"
        accountLabel="@my_store"
        customerHandle="customer_1"
        replyText="메시지 내용"
        onConfirm={onConfirm}
      />
    )

    const cancelBtn = screen.getByRole('button', { name: '취소' })
    fireEvent.click(cancelBtn)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
