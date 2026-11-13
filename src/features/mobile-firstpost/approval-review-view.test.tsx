// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApprovalReviewView } from './approval-review-view'
import type { ApprovalReviewInput } from './approval-review'

const base: ApprovalReviewInput = {
  workspaceName: '예시 가게',
  targets: [{ channel: 'instagram', handle: '@shop', connection: 'CONNECTED', publishPermission: 'GRANTED' }],
  copies: [{ channel: 'instagram', text: '신메뉴\n출시', cta: '예약하기' }],
  imageIds: ['img-1'],
  rights: 'CONFIRMED',
  saved: true,
  cost: { amountKrw: 0, source: 'SERVER_QUOTE' },
  executionSurface: 'MOBILE_OK',
  serverFingerprint: 'fp-1',
  approved: null,
}

describe('ApprovalReviewView', () => {
  it('조건이 모두 확인되면 CTA 한 번에 요청 1건만 보낸다', async () => {
    const onSubmit = vi.fn().mockResolvedValue({})
    render(<ApprovalReviewView input={base} onSubmit={onSubmit} />)
    expect(screen.getByText('기본 플랜 포함')).toBeInTheDocument()
    expect(screen.queryByText(/0원|예상 비용 0원/)).not.toBeInTheDocument()
    const cta = screen.getByRole('button', { name: '이 내용으로 게시 요청' })
    fireEvent.click(cta)
    fireEvent.click(cta)
    await waitFor(() => expect(screen.getByText(/게시 요청을 보냈어요/)).toBeTruthy())
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/게시됨|게시 완료/)).toBeNull()
  })

  it('비용 미확인이면 CTA 를 열지 않는다', () => {
    render(<ApprovalReviewView input={{ ...base, cost: { amountKrw: null, source: 'UNKNOWN' } }} onSubmit={vi.fn()} />)
    expect((screen.getByRole('button', { name: '이 내용으로 게시 요청' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('예상 비용 확인 중')).toBeTruthy()
  })

  it('게시 권한이 없으면 수동 경로를 보여준다', () => {
    const input = { ...base, targets: [{ ...base.targets[0], publishPermission: 'DENIED' as const }] }
    render(<ApprovalReviewView input={input} onSubmit={vi.fn()} />)
    expect(screen.getByText('복사')).toBeTruthy()
  })

  it('전송 실패는 게시된 것이 없다고 알리고 다시 시도할 수 있다', async () => {
    render(<ApprovalReviewView input={base} onSubmit={vi.fn().mockRejectedValue(new Error('x'))} />)
    fireEvent.click(screen.getByRole('button', { name: '이 내용으로 게시 요청' }))
    await waitFor(() => expect(screen.getByText(/게시된 것은 없어요/)).toBeTruthy())
  })
})
