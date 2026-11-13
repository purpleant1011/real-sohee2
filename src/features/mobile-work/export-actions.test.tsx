import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExportActions } from './export-actions'

describe('ExportActions', () => {
  const originalClipboard = navigator.clipboard

  beforeEach(() => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:mock-image'),
      revokeObjectURL: vi.fn(),
    })

    Object.defineProperty(window, 'location', {
      value: {
        href: '',
      },
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      configurable: true,
      writable: true,
    })
  })

  const sampleProps = {
    channel: 'naver_blog',
    title: '블로그 포스팅 제목',
    caption: '매장 신메뉴 공지입니다.',
    hashtags: ['#신메뉴', '#이벤트'],
    images: [
      { src: '/media/1.jpg', alt: '이미지 1' },
      { src: '/media/2.png', alt: '이미지 2' },
    ],
  }

  it('안내 문구와 2x2 그리드 버튼(최소 높이 14)을 렌더링한다', () => {
    render(<ExportActions {...sampleProps} />)

    expect(
      screen.getByText('소희는 네이버 블로그·당근에 대신 올리지 않아요. 복사하거나 저장해서 직접 올려 주세요.')
    ).toBeInTheDocument()

    const copyBtn = screen.getByRole('button', { name: /본문 복사/i })
    const saveImgBtn = screen.getByRole('button', { name: /이미지 저장/i })
    const shareBtn = screen.getByRole('button', { name: /공유하기/i })
    const mailBtn = screen.getByRole('link', { name: /메일로 보내기/i })

    expect(copyBtn).toHaveClass('min-h-14')
    expect(saveImgBtn).toHaveClass('min-h-14')
    expect(shareBtn).toHaveClass('min-h-14')
    expect(mailBtn).toHaveClass('min-h-14')
  })

  it('본문 복사 클릭 시 클립보드에 복사하고 2초 동안 복사했어요 텍스트를 노출한다', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    })

    render(<ExportActions {...sampleProps} />)
    const copyBtn = screen.getByRole('button', { name: /본문 복사/i })
    fireEvent.click(copyBtn)

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(
        '블로그 포스팅 제목\n\n매장 신메뉴 공지입니다.\n\n#신메뉴 #이벤트'
      )
      expect(screen.getByText('복사했어요')).toBeInTheDocument()
    })
  })

  it('이미지가 없으면 이미지 저장 버튼이 비활성화된다', () => {
    render(<ExportActions {...sampleProps} images={[]} />)
    const saveImgBtn = screen.getByRole('button', { name: /이미지 저장/i })
    expect(saveImgBtn).toBeDisabled()
  })

  it('이미지 저장 클릭 시 각 이미지를 순차적으로 fetch하여 다운로드한다', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const mockBlob = new Blob(['mock-data'], { type: 'image/jpeg' })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(mockBlob),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ExportActions {...sampleProps} />)
    const saveImgBtn = screen.getByRole('button', { name: /이미지 저장/i })
    fireEvent.click(saveImgBtn)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(clickSpy).toHaveBeenCalledTimes(2)
    })
  })

  it('메일로 보내기는 안전한 a 태그 새 창 mailto 링크로 렌더링된다', () => {
    render(<ExportActions {...sampleProps} />)
    const mailLink = screen.getByRole('link', { name: /메일로 보내기/i })
    expect(mailLink).toHaveAttribute('href')
    expect(mailLink.getAttribute('href')).toContain('mailto:?subject=')
    expect(mailLink.getAttribute('href')).toContain(encodeURIComponent('블로그 포스팅 제목'))
    expect(mailLink).toHaveAttribute('target', '_blank')
    expect(mailLink).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('공유하기 클릭 시 Web Share가 지원되지 않으면 안전하게 메일 새 창으로 fallback한다', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    Object.defineProperty(global, 'navigator', {
      value: { share: undefined },
      configurable: true,
      writable: true,
    })

    render(<ExportActions {...sampleProps} images={[]} />)
    const shareBtn = screen.getByRole('button', { name: /공유하기/i })
    fireEvent.click(shareBtn)

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        expect.stringContaining('mailto:?subject='),
        '_blank',
      )
    })
    openSpy.mockRestore()
  })

  it('공유하기 클릭 시 Web Share가 지원되면 share를 호출한다', async () => {
    const mockShare = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(global, 'navigator', {
      value: {
        share: mockShare,
      },
      configurable: true,
      writable: true,
    })

    render(<ExportActions {...sampleProps} images={[]} />)
    const shareBtn = screen.getByRole('button', { name: /공유하기/i })
    fireEvent.click(shareBtn)

    await waitFor(() => {
      expect(mockShare).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '블로그 포스팅 제목',
        })
      )
    })
  })
})
