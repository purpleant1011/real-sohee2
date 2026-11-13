import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PlaceholderNotice } from './placeholder-notice'
import { INFO_REQUEST_PLACEHOLDER } from '@/features/content/placeholder-detect'

describe('PlaceholderNotice', () => {
  it('renders nothing when placeholders list is empty', () => {
    const { container } = render(<PlaceholderNotice placeholders={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders notice with count, placeholder chips, and guide copy when placeholders exist', () => {
    const placeholders = ['[이벤트 기간]', '[문의 방법 또는 예약 방법]']
    render(<PlaceholderNotice placeholders={placeholders} />)

    expect(screen.getByText('채워야 할 곳이 2개 있어요')).toBeInTheDocument()
    expect(screen.getByText('[이벤트 기간]')).toBeInTheDocument()
    expect(screen.getByText('[문의 방법 또는 예약 방법]')).toBeInTheDocument()
    expect(
      screen.getByText('문구 다듬기로 내용을 알려 주시면 채워 드려요.'),
    ).toBeInTheDocument()
  })

  it('renders distinct warning message when info-request placeholder is detected', () => {
    render(<PlaceholderNotice placeholders={[INFO_REQUEST_PLACEHOLDER]} />)

    expect(
      screen.getByText('고객에게 보여줄 글이 아니라 소희의 정보 요청이에요.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('이벤트 정보를 알려주고 다시 만들어 주세요.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/채워야 할 곳이 1개 있어요/)).not.toBeInTheDocument()
  })
})
