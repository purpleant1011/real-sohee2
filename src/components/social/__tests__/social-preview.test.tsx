import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InstagramPostPreview, ThreadsPostPreview } from '../social-preview'

describe('social post previews', () => {
  it('renders Instagram handle, caption and hashtags and expands captions over three lines', () => {
    render(
      <InstagramPostPreview
        handle="@momocafe"
        caption={'첫 줄 소개입니다.\n둘째 줄 소개입니다.\n셋째 줄 소개입니다.\n넷째 줄 소개입니다.'}
        hashtags={['카페', '#성수동']}
      />,
    )

    const preview = screen.getByRole('article', { name: '인스타그램 게시물 미리보기' })
    expect(within(preview).getAllByText('momocafe')).toHaveLength(2)
    expect(within(preview).getByText(/첫 줄 소개입니다/)).toBeInTheDocument()
    expect(within(preview).getByText('#카페 #성수동')).toBeInTheDocument()
    fireEvent.click(within(preview).getByRole('button', { name: '더 보기' }))
    expect(within(preview).queryByRole('button', { name: '더 보기' })).not.toBeInTheDocument()
  })

  it('renders the thread preview text', () => {
    render(<ThreadsPostPreview handle="@momocafe" caption="오늘의 신메뉴를 소개해요." />)

    const preview = screen.getByRole('article', { name: '스레드 게시물 미리보기' })
    expect(within(preview).getByText('momocafe')).toBeInTheDocument()
    expect(within(preview).getByText('오늘의 신메뉴를 소개해요.')).toBeInTheDocument()
  })
})
