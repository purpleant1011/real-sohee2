import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import {
  approvalHref,
  ChatBody,
  ChatComposer,
  ChatComposerHost,
  ChatExecutionCard,
  ChatTranscript,
} from './chat-parts'
import { BUBBLE_CLAMP_CLASS, LONG_DRAFT_LABEL } from './chat-long-form'
import { BUBBLE_COLLAPSE_CHARS } from './long-form'
import { CHAT_SEND_FAILED_NOTICE } from './chat-send'
import type { ChatBubble } from './transcript'

const LONG_TEXT = '가'.repeat(BUBBLE_COLLAPSE_CHARS)

function bubble(overrides: Partial<ChatBubble> = {}): ChatBubble {
  return {
    id: 'm1',
    role: 'sohee',
    text: '초안을 준비했어요.',
    pending: false,
    evidence: [],
    approval: null,
    ...overrides,
  }
}

describe('ChatTranscript', () => {
  it('대화가 없으면 빈 상태 문구를 보여준다', () => {
    render(<ChatTranscript bubbles={[]} emptyLabel="아직 대화가 없어요." />)

    expect(screen.getByText('아직 대화가 없어요.')).toBeInTheDocument()
  })

  it('대화가 없으면 퀵 제안 칩을 보여주고 클릭 시 onSelectSuggestion을 호출한다', () => {
    const onSelect = vi.fn()
    render(<ChatTranscript bubbles={[]} onSelectSuggestion={onSelect} />)

    const suggestionButton = screen.getByRole('button', { name: '이번 주 인스타 피드 게시물 만들어줘' })
    expect(suggestionButton).toBeVisible()
    expect(suggestionButton).toHaveClass('min-h-11')

    fireEvent.click(suggestionButton)
    expect(onSelect).toHaveBeenCalledWith('이번 주 인스타 피드 게시물 만들어줘')
  })

  it('역할 라벨과 본문을 보여준다', () => {
    render(
      <ChatTranscript
        bubbles={[
          bubble({ id: 'a', role: 'owner', text: '이번 주 게시 도와줘' }),
          bubble({ id: 'b', role: 'sohee', text: '네, 초안부터 볼게요' }),
        ]}
      />,
    )

    expect(screen.getByText('사장님')).toBeInTheDocument()
    expect(screen.getByText('소희')).toBeInTheDocument()
    expect(screen.getByText('이번 주 게시 도와줘')).toBeInTheDocument()
  })

  it('전송 중인 버블은 전송 중으로 표시한다', () => {
    render(<ChatTranscript bubbles={[bubble({ pending: true })]} />)

    expect(screen.getByRole('status')).toHaveTextContent('전송 중')
  })

  it('검증을 통과하지 못한 근거 링크는 렌더하지 않는다', () => {
    const { container } = render(
      <ChatTranscript
        bubbles={[
          bubble({
            evidence: [
              { label: '게시물', href: '/app/work/1' },
              { label: '위험한 링크', href: 'javascript:alert(1)' },
            ],
          }),
        ]}
      />,
    )

    expect(screen.getByText('게시물')).toBeInTheDocument()
    expect(screen.queryByText('위험한 링크')).not.toBeInTheDocument()
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull()
  })

  it('승인 제안은 승인 화면 링크를 만든다', () => {
    render(
      <ChatTranscript
        bubbles={[bubble({ approval: { id: 'apr/1', title: '게시 승인' } })]}
      />,
    )

    expect(screen.getByText('게시 승인')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '승인 화면에서 확인' })).toHaveAttribute(
      'href',
      '/app/approvals/apr%2F1',
    )
  })

  it('긴 본문은 접어 두고 더 보기로 펼친다', () => {
    render(<ChatTranscript bubbles={[bubble({ text: LONG_TEXT })]} />)

    expect(screen.getByText(LONG_TEXT)).toHaveClass(BUBBLE_CLAMP_CLASS)

    fireEvent.click(screen.getByRole('button', { name: '더 보기' }))

    expect(screen.getByText(LONG_TEXT)).not.toHaveClass(BUBBLE_CLAMP_CLASS)
    expect(screen.getByRole('button', { name: '접기' })).toBeInTheDocument()
  })

  it('짧은 본문에는 더 보기를 만들지 않는다', () => {
    render(<ChatTranscript bubbles={[bubble()]} />)

    expect(screen.queryByRole('button', { name: '더 보기' })).toBeNull()
  })
})

describe('approvalHref', () => {
  it('승인 id 를 경로 조각으로 인코딩한다', () => {
    expect(approvalHref('apr_1')).toBe('/app/approvals/apr_1')
    expect(approvalHref('apr 1?x=1')).toBe('/app/approvals/apr%201%3Fx%3D1')
  })
})

describe('ChatExecutionCard', () => {
  it('서버가 준 단계가 아니면 카드를 만들지 않는다', () => {
    const { container } = render(<ChatExecutionCard stage="done" />)

    expect(container.querySelector('[data-chat-execution]')).toBeNull()
  })

  it('외부 확인 단계가 아니면 검증으로 표시하지 않는다', () => {
    const { container } = render(<ChatExecutionCard stage="drafting" hasServerOutput />)

    const card = container.querySelector('[data-chat-execution]')
    expect(card?.getAttribute('data-verified')).toBeNull()
    expect(screen.getByText('초안 준비 중')).toBeInTheDocument()
    expect(screen.queryByText('외부 결과까지 확인했어요.')).not.toBeInTheDocument()
  })

  it('외부 확인 단계에 서버 산출물이 있을 때만 검증이다', () => {
    const { container } = render(
      <ChatExecutionCard stage="verifying_external" hasServerOutput />,
    )

    expect(container.querySelector('[data-chat-execution]')).toHaveAttribute(
      'data-verified',
      'true',
    )
    expect(screen.getByText('외부 결과까지 확인했어요.')).toBeInTheDocument()
  })

  it('서버 산출물이 없으면 확인 중으로 남는다', () => {
    const { container } = render(<ChatExecutionCard stage="verifying_external" />)

    expect(
      container.querySelector('[data-chat-execution]')?.getAttribute('data-verified'),
    ).toBeNull()
    expect(screen.getByText('확인되기 전에는 완료로 표시하지 않아요.')).toBeInTheDocument()
  })

  it('사장님 결정이 필요한 단계에서만 확인을 요청한다', () => {
    render(<ChatExecutionCard stage="awaiting_decision" />)

    expect(screen.getByText('사장님 확인이 필요해요.')).toBeInTheDocument()
  })
})

describe('ChatComposer', () => {
  it('내용이 비어 있으면 보내기를 누를 수 없다', () => {
    render(<ChatComposer value="" onChange={() => {}} onSubmit={() => {}} />)

    expect(screen.getByRole('button', { name: '보내기' })).toBeDisabled()
    expect(screen.getByPlaceholderText('소희에게 무엇을 맡길까요?')).toBeInTheDocument()
  })

  it('내용이 있으면 보내기가 onSubmit 을 호출한다', () => {
    const onSubmit = vi.fn()
    render(<ChatComposer value="안녕하세요" onChange={() => {}} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: '보내기' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('전송 중에는 다시 보낼 수 없다', () => {
    render(
      <ChatComposer value="안녕하세요" onChange={() => {}} onSubmit={() => {}} busy />,
    )

    expect(screen.getByRole('button', { name: '보내기' })).toBeDisabled()
  })

  it('실패 문구를 알림으로 보여준다', () => {
    render(
      <ChatComposer
        value="안녕하세요"
        onChange={() => {}}
        onSubmit={() => {}}
        notice="보내지 못했어요."
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('보내지 못했어요.')
  })

  it('길게 쓰기를 누르면 같은 초안으로 편집기가 열린다', () => {
    render(<ChatComposer value="이번 주 게시 도와줘" onChange={() => {}} onSubmit={() => {}} />)

    const opener = screen.getByRole('button', { name: LONG_DRAFT_LABEL })
    expect(opener).toHaveAttribute('aria-haspopup', 'dialog')
    expect(opener).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(opener)

    expect(opener).toHaveAttribute('aria-expanded', 'true')
    const dialog = screen.getByRole('dialog', { name: LONG_DRAFT_LABEL })
    expect(within(dialog).getByLabelText('메시지 내용 (길게 쓰기)')).toHaveValue(
      '이번 주 게시 도와줘',
    )
  })

  it('편집기에서 고친 내용은 컴포저 초안으로 올라간다', () => {
    const onChange = vi.fn()
    render(<ChatComposer value="처음 초안" onChange={onChange} onSubmit={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: LONG_DRAFT_LABEL }))
    fireEvent.change(screen.getByLabelText('메시지 내용 (길게 쓰기)'), {
      target: { value: '고친 초안' },
    })

    expect(onChange).toHaveBeenCalledWith('고친 초안')
  })

  it('편집기에서 보내면 시트를 닫고 전송한다', () => {
    const onSubmit = vi.fn()
    render(<ChatComposer value="보낼 원고" onChange={() => {}} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: LONG_DRAFT_LABEL }))
    fireEvent.click(
      within(screen.getByRole('dialog', { name: LONG_DRAFT_LABEL })).getByRole('button', {
        name: '보내기',
      }),
    )

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: LONG_DRAFT_LABEL })).toBeNull()
  })

  it('빈 초안으로는 편집기에서도 보낼 수 없다', () => {
    const onSubmit = vi.fn()
    render(<ChatComposer value="   " onChange={() => {}} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: LONG_DRAFT_LABEL }))

    expect(
      within(screen.getByRole('dialog', { name: LONG_DRAFT_LABEL })).getByRole('button', {
        name: '보내기',
      }),
    ).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('긴 초안에는 글자 수를 붙인다', () => {
    render(<ChatComposer value={'가'.repeat(250)} onChange={() => {}} onSubmit={() => {}} />)

    expect(screen.getByText('250자')).toBeInTheDocument()
  })
})

describe('ChatComposerHost', () => {
  it('전송에 성공하면 입력을 비운다', async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true })
    render(<ChatComposerHost onSend={onSend} />)

    const textarea = screen.getByLabelText('메시지 내용')
    fireEvent.change(textarea, { target: { value: '이번 주 게시 도와줘' } })
    fireEvent.submit(textarea.closest('form') as HTMLFormElement)

    await waitFor(() => expect(textarea).toHaveValue(''))
    expect(onSend).toHaveBeenCalledWith('이번 주 게시 도와줘')
  })

  it('전송에 실패하면 입력을 남기고 다시 시도할 수 있게 한다', async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: false, message: '네트워크가 불안정해요.' })
    render(<ChatComposerHost onSend={onSend} />)

    const textarea = screen.getByLabelText('메시지 내용')
    fireEvent.change(textarea, { target: { value: '이번 주 게시 도와줘' } })
    fireEvent.submit(textarea.closest('form') as HTMLFormElement)

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('네트워크가 불안정해요.'),
    )
    expect(textarea).toHaveValue('이번 주 게시 도와줘')
  })

  it('전송 호출이 던져도 기본 실패 문구로 알린다', async () => {
    const onSend = vi.fn().mockRejectedValue(new Error('boom'))
    render(<ChatComposerHost onSend={onSend} />)

    const textarea = screen.getByLabelText('메시지 내용')
    fireEvent.change(textarea, { target: { value: '안녕하세요' } })
    fireEvent.submit(textarea.closest('form') as HTMLFormElement)

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(CHAT_SEND_FAILED_NOTICE),
    )
    expect(textarea).toHaveValue('안녕하세요')
  })

  it('공백만 입력하면 전송하지 않는다', () => {
    const onSend = vi.fn()
    render(<ChatComposerHost onSend={onSend} />)

    const textarea = screen.getByLabelText('메시지 내용')
    fireEvent.change(textarea, { target: { value: '   ' } })
    fireEvent.submit(textarea.closest('form') as HTMLFormElement)

    expect(onSend).not.toHaveBeenCalled()
  })
})

describe('ChatBody', () => {
  it('단계가 없으면 진행 카드 없이 대화만 그린다', () => {
    const { container } = render(<ChatBody bubbles={[bubble()]} />)

    expect(container.querySelector('[data-chat-execution]')).toBeNull()
    expect(screen.getByText('초안을 준비했어요.')).toBeInTheDocument()
  })

  it('서버 단계가 있으면 진행 카드를 함께 그린다', () => {
    const { container } = render(
      <ChatBody bubbles={[bubble()]} stage="verifying_external" hasServerOutput />,
    )

    expect(container.querySelector('[data-chat-execution]')).toHaveAttribute(
      'data-stage',
      'verifying_external',
    )
  })
})
