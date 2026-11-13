import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DataBoundary } from './data-boundary'

describe('DataBoundary', () => {
  it('shows a loading message without presenting an unverified zero', () => {
    render(<DataBoundary state={{ kind: 'loading' }} />)

    expect(screen.getByText('데이터 확인 중')).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('explains both the cause and next action when no data is connected', () => {
    render(
      <DataBoundary
        state={{
          kind: 'empty',
          title: '아직 연결된 작업이 없어요',
          description: '작업을 연결한 뒤 다시 확인해 주세요.',
        }}
      />,
    )

    expect(screen.getByRole('heading', { name: '아직 연결된 작업이 없어요' })).toBeInTheDocument()
    expect(screen.getByText('작업을 연결한 뒤 다시 확인해 주세요.')).toBeInTheDocument()
  })

  it('keeps errors safe and only presents retry when it is available', () => {
    render(
      <DataBoundary
        state={{
          kind: 'error',
          message: '데이터를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.',
          requestId: 'support-123',
          retryable: true,
        }}
      />,
    )

    expect(screen.getByText('데이터를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.')).toBeInTheDocument()
    expect(screen.queryByText('문의 번호: support-123')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다시 시도' })).toHaveStyle({ minHeight: '44px' })
  })

  it('does not present retry when the error cannot be retried', () => {
    render(
      <DataBoundary
        state={{
          kind: 'error',
          message: '데이터를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.',
          requestId: 'support-124',
          retryable: false,
        }}
      />,
    )

    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
  })

  it('renders ready content with its checked time', () => {
    render(
      <DataBoundary state={{ kind: 'ready', data: { title: '오늘의 작업' }, checkedAt: '2026-08-09T09:00:00+09:00' }}>
        {(data) => <p>{data.title}</p>}
      </DataBoundary>,
    )

    expect(screen.getByText('오늘의 작업')).toBeInTheDocument()
    expect(screen.getByText('확인 시각: 2026-08-09T09:00:00+09:00')).toBeInTheDocument()
  })
})
