import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EngagementSendDialog } from './engagement-send-dialog'

describe('EngagementSendDialog', () => {
  it('renders with account_label', () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <EngagementSendDialog
        open={true}
        onOpenChange={onOpenChange}
        channelLabel="인스타그램"
        accountLabel="@sohee_store"
        replyText="감사합니다! 좋은 하루 되세요."
        onConfirm={onConfirm}
      />
    )

    expect(screen.getByText('이 답글을 보낼까요?')).toBeInTheDocument()
    expect(screen.getByText('감사합니다! 좋은 하루 되세요.')).toBeInTheDocument()
    expect(
      screen.getByText('인스타그램 · @sohee_store 계정에 실제로 게시돼요. 보낸 뒤에는 소희에서 되돌릴 수 없어요.')
    ).toBeInTheDocument()
  })

  it('renders fallback to "연결된 계정" when accountLabel is not supplied', () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <EngagementSendDialog
        open={true}
        onOpenChange={onOpenChange}
        channelLabel="스레드"
        accountLabel={null}
        replyText="방문해 주셔서 감사합니다."
        onConfirm={onConfirm}
      />
    )

    expect(
      screen.getByText('스레드 · 연결된 계정에 실제로 게시돼요. 보낸 뒤에는 소희에서 되돌릴 수 없어요.')
    ).toBeInTheDocument()
  })

  it('calls onConfirm when 보내기 is clicked', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onOpenChange = vi.fn()

    render(
      <EngagementSendDialog
        open={true}
        onOpenChange={onOpenChange}
        channelLabel="인스타그램"
        accountLabel="@shop"
        replyText="답글 테스트"
        onConfirm={onConfirm}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '보내기' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('calls onOpenChange(false) when 취소 is clicked', () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <EngagementSendDialog
        open={true}
        onOpenChange={onOpenChange}
        channelLabel="인스타그램"
        accountLabel="@shop"
        replyText="답글 테스트"
        onConfirm={onConfirm}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
