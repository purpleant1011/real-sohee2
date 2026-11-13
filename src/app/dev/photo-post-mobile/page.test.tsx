// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { notFound } from 'next/navigation'

const mockSearchParams = vi.fn(() => new URLSearchParams())

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => mockSearchParams(),
}))

import PhotoPostMobilePage from './page'

describe('PhotoPostMobilePage', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
    mockSearchParams.mockReturnValue(new URLSearchParams())
  })

  it('renders photo post mobile harness in development and auto-opens sheet with saved photos', async () => {
    vi.stubEnv('NODE_ENV', 'development')

    render(<PhotoPostMobilePage />)

    // 셸 헤더 h1 (시트 열림으로 aria-hidden 상태일 수 있어 hidden: true 허용)
    expect(screen.getByRole('heading', { level: 1, name: '사진으로 글 만들기', hidden: true })).toBeInTheDocument()

    // 자동 클릭으로 Sheet가 열려 Dialog와 SheetTitle(h2)가 노출됨
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '사진으로 글 만들기' })).toBeInTheDocument()
    })
    expect(screen.getByRole('heading', { level: 2, name: '사진으로 글 만들기' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '저장한 사진 다시 확인' })).toBeInTheDocument()

    // 기본 saved 상태에서는 확인된 사진 선택 버튼과 자물쇠(미적격) 버튼이 렌더링됨
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: '이 사진 선택' }).length).toBe(2)
      expect(screen.getByRole('button', { name: '권리 확인 필요' })).toBeInTheDocument()
    })
  })

  it('handles state=empty query parameter', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    mockSearchParams.mockReturnValue(new URLSearchParams('state=empty'))

    render(<PhotoPostMobilePage />)

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '사진으로 글 만들기' })).toBeInTheDocument()
    })

    // empty 상태에서는 사진 선택 버튼이 0개
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '이 사진 선택' })).not.toBeInTheDocument()
    })
  })

  it('calls notFound in production', () => {
    vi.stubEnv('NODE_ENV', 'production')

    expect(() => PhotoPostMobilePage()).toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
  })
})
