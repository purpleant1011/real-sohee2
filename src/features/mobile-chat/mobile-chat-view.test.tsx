import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  chatScreenConfig,
  chatStateChip,
  MobileChatView,
  type ChatViewSnapshot,
} from './mobile-chat-view'
import type { ChatBubble } from './transcript'

function bubble(overrides: Partial<ChatBubble> = {}): ChatBubble {
  return {
    id: 'b1',
    role: 'sohee',
    text: '초안을 준비했어요.',
    pending: false,
    evidence: [],
    approval: null,
    ...overrides,
  }
}

function snapshot(overrides: Partial<ChatViewSnapshot> = {}): ChatViewSnapshot {
  return {
    loadState: 'ready',
    bubbles: [bubble()],
    complete: true,
    checkedAt: '2026-10-24T01:00:00.000Z',
    ...overrides,
  }
}

describe('5상태 칩 — 정직한 판정', () => {
  it.each([
    [{ loadState: 'loading', complete: true }, 'loading'],
    [{ loadState: 'error', complete: true }, 'error'],
    [{ loadState: 'stale', complete: true }, 'stale'],
    [{ loadState: 'unknown', complete: true }, 'partial'],
    [{ loadState: 'ready', complete: false }, 'partial'],
    [{ loadState: 'ready', complete: true, offline: true }, 'offline'],
    [{ loadState: 'error', complete: false, unauthorized: true }, null],
    [{ loadState: 'ready', complete: true }, null],
  ] as const)('%o → %s', (input, expected) => {
    expect(chatStateChip(input)).toBe(expected)
  })

  it('조회 실패는 빈 대화로 위장하지 않고 오류 칩과 재확인만 보여 준다', () => {
    const onRetry = vi.fn()
    render(<MobileChatView snapshot={snapshot({ loadState: 'error', bubbles: [] })} onSend={vi.fn()} onRetry={onRetry} />)

    expect(screen.getByText('확인 실패')).toBeInTheDocument()
    expect(screen.queryByText('아직 나눈 대화가 없어요.')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '메시지 내용' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다시 확인' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('권한 없음은 확인 실패가 아니라 권한 없음 화면이다', () => {
    const onRetry = vi.fn()
    render(
      <MobileChatView
        snapshot={snapshot({ loadState: 'error', bubbles: [], unauthorized: true })}
        onSend={vi.fn()}
        onRetry={onRetry}
      />,
    )

    expect(screen.getByText('이 내용을 볼 권한이 없어요')).toBeInTheDocument()
    // 같은 error 상태라도 '확인 실패'로 뭉개지 않고, 다시 확인해도 풀리지 않으므로 재확인을 주지 않는다.
    expect(screen.queryByText('확인 실패')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다시 확인' })).not.toBeInTheDocument()
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('서버가 일부만 확인했으면 완료로 읽히는 칩을 쓰지 않는다', () => {
    render(<MobileChatView snapshot={snapshot({ complete: false })} onSend={vi.fn()} />)
    expect(screen.getByText('일부만 확인')).toBeInTheDocument()
    expect(screen.queryByText('확인됨')).not.toBeInTheDocument()
    expect(screen.queryByText('완료')).not.toBeInTheDocument()
  })

  it('전체를 확인했으면 칩을 붙이지 않는다', () => {
    const { container } = render(<MobileChatView snapshot={snapshot()} onSend={vi.fn()} />)
    expect(container.querySelector('[data-state-chip]')).toBeNull()
  })

  it('오래된 내용은 이전에 확인한 내용으로 표시하고 다시 확인 행동을 준다', () => {
    const onRetry = vi.fn()
    render(<MobileChatView snapshot={snapshot({ loadState: 'stale' })} onSend={vi.fn()} onRetry={onRetry} />)
    expect(screen.getByText('이전에 확인한 내용')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '최신 내용으로 다시 확인' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})

describe('업무 위임 입력', () => {
  it('빈 입력은 보내지 않고, 입력하면 그대로 위임한다', async () => {
    const onSend = vi.fn(() => ({ ok: true as const }))
    render(<MobileChatView snapshot={snapshot()} onSend={onSend} />)

    const send = screen.getByRole('button', { name: '보내기' })
    expect(send).toBeDisabled()

    fireEvent.change(screen.getByRole('textbox', { name: '메시지 내용' }), {
      target: { value: '이번 주 예약 문의 답장 준비해 줘' },
    })
    fireEvent.click(send)

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('이번 주 예약 문의 답장 준비해 줘'))
  })

  it('전송에 실패하면 입력을 지우지 않고 실패 문구를 보여 준다', async () => {
    const onSend = vi.fn(() => ({ ok: false as const, message: '메시지를 보내지 못했어요. 잠시 뒤 다시 시도해 주세요.' }))
    render(<MobileChatView snapshot={snapshot()} onSend={onSend} />)

    const input = screen.getByRole('textbox', { name: '메시지 내용' })
    fireEvent.change(input, { target: { value: '답장 준비해 줘' } })
    fireEvent.click(screen.getByRole('button', { name: '보내기' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('보내지 못했어요')
    expect(input).toHaveValue('답장 준비해 줘')
  })

  it('셸 컴포저 슬롯을 쓰는 경우 화면은 입력창을 중복 생성하지 않는다', () => {
    render(<MobileChatView snapshot={snapshot()} onSend={vi.fn()} showComposer={false} />)
    expect(screen.queryByRole('textbox', { name: '메시지 내용' })).not.toBeInTheDocument()
  })
})

describe('진행 복귀', () => {
  it('서버가 준 단계만 진행 카드로 보여 주고 완료로 단정하지 않는다', () => {
    render(<MobileChatView snapshot={snapshot({ stage: 'awaiting_decision' })} onSend={vi.fn()} />)

    const card = document.querySelector('[data-chat-execution]')
    expect(card).toHaveAttribute('data-stage', 'awaiting_decision')
    expect(card).not.toHaveAttribute('data-verified')
    expect(screen.getByText('사장님 확인이 필요해요.')).toBeInTheDocument()
  })

  it('모르는 단계 값은 진행 카드를 만들지 않는다', () => {
    render(<MobileChatView snapshot={snapshot({ stage: 'done' })} onSend={vi.fn()} />)
    expect(document.querySelector('[data-chat-execution]')).toBeNull()
  })

  it('진행 중인 업무로 돌아가는 길을 준다', () => {
    render(<MobileChatView snapshot={snapshot()} onSend={vi.fn()} returnHref="/app/work/w1" />)
    expect(screen.getByRole('link', { name: /진행 중인 업무로 돌아가기/ })).toHaveAttribute('href', '/app/work/w1')
  })

  it('돌아갈 업무가 없으면 복귀 링크를 만들지 않는다', () => {
    render(<MobileChatView snapshot={snapshot()} onSend={vi.fn()} />)
    expect(screen.queryByRole('link', { name: /진행 중인 업무로 돌아가기/ })).toBeNull()
  })

  it('아직 확정되지 않은 대기 버블을 확정 대화 뒤에 붙인다', () => {
    render(
      <MobileChatView
        snapshot={snapshot({
          queued: [bubble({ id: 'q1', role: 'owner', text: '지금 보낸 메시지', pending: true })],
        })}
        onSend={vi.fn()}
      />,
    )

    expect(screen.getByText('지금 보낸 메시지')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('전송 중')
  })
})

describe('대화가 정말 비었을 때', () => {
  it('전체를 확인했고 대화가 없으면 그 사실을 그대로 알린다', () => {
    render(<MobileChatView snapshot={snapshot({ bubbles: [] })} onSend={vi.fn()} />)
    expect(screen.getByText('아직 나눈 대화가 없어요.')).toBeInTheDocument()
  })

  it('대화가 없으면 추천 질문 칩을 누를 때 onSend를 호출한다', () => {
    const onSend = vi.fn(() => ({ ok: true as const }))
    render(<MobileChatView snapshot={snapshot({ bubbles: [] })} onSend={onSend} />)

    const chip = screen.getByRole('button', { name: '이번 주 인스타 피드 게시물 만들어줘' })
    fireEvent.click(chip)
    expect(onSend).toHaveBeenCalledWith('이번 주 인스타 피드 게시물 만들어줘')
  })
})

describe('셸 계약', () => {
  it('CHAT 모드로 등록되고 5탭·고정 CTA 를 갖지 않는다', () => {
    expect(chatScreenConfig()).toEqual({ mode: 'CHAT', title: '소희와 대화' })
  })
})
