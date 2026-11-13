import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { notFound } from 'next/navigation'

import MobileChatPhotoPage from './page'

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('not found')
  }),
}))

describe('development-only chat photo preview', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('검수 화면임을 밝히고 사진 첨부 입력을 보여 준다', () => {
    vi.stubEnv('NODE_ENV', 'development')

    render(<MobileChatPhotoPage />)

    expect(screen.getByText('사진 붙이기 검수 화면')).toBeInTheDocument()
    expect(screen.getByText(/예시 화면이에요/)).toBeInTheDocument()
    expect(screen.getByLabelText('사진 붙이기')).toBeInTheDocument()
  })

  it('운영에서는 404', () => {
    vi.stubEnv('NODE_ENV', 'production')

    expect(() => MobileChatPhotoPage()).toThrow('not found')
    expect(notFound).toHaveBeenCalledOnce()
  })
})
