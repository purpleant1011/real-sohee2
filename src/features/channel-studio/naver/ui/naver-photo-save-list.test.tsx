import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NaverPhotoSaveList } from './naver-photo-save-list'

describe('NaverPhotoSaveList', () => {
  const photos = [
    { id: 'p1', src: 'https://example.com/p1.jpg', alt: '첫 번째 사진' },
    { id: 'p2', src: 'https://example.com/p2.png', alt: '두 번째 사진' },
  ]

  let createObjectURLSpy: ReturnType<typeof vi.spyOn>
  let revokeObjectURLSpy: ReturnType<typeof vi.spyOn>
  const originalCanShareDescriptor = Object.getOwnPropertyDescriptor(navigator, 'canShare')
  const originalShareDescriptor = Object.getOwnPropertyDescriptor(navigator, 'share')

  beforeEach(() => {
    vi.clearAllMocks()

    createObjectURLSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation((blob: Blob | MediaSource) => `blob:mock-url-${(blob as Blob).type || 'image/jpeg'}`)
    revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalCanShareDescriptor) {
      Object.defineProperty(navigator, 'canShare', originalCanShareDescriptor)
    } else {
      // @ts-expect-error clean up mock
      delete navigator.canShare
    }
    if (originalShareDescriptor) {
      Object.defineProperty(navigator, 'share', originalShareDescriptor)
    } else {
      // @ts-expect-error clean up mock
      delete navigator.share
    }
  })

  it('renders nothing when photos array is empty', () => {
    const { container } = render(<NaverPhotoSaveList photos={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('disables buttons with "준비 중…" and aria-busy before preparation completes', () => {
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}))

    render(<NaverPhotoSaveList photos={photos} />)

    expect(
      screen.getByText('사진은 하나씩 저장하거나 ZIP으로 한꺼번에 받을 수 있어요.'),
    ).toBeInTheDocument()

    const busyButtons = screen.getAllByRole('button', { name: /사진 \d 저장/ })
    expect(busyButtons).toHaveLength(2)
    busyButtons.forEach((btn) => {
      expect(btn).toBeDisabled()
      expect(btn).toHaveAttribute('aria-busy', 'true')
      expect(btn).toHaveTextContent('준비 중…')
      expect(btn.className).toMatch(/min-h-11|min-h-\[44px\]/)
    })
  })

  it('부모가 같은 내용의 새 배열을 다시 넘겨도 사진을 다시 내려받거나 준비 상태를 초기화하지 않는다', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['x'], { type: 'image/png' })) }))
    global.fetch = fetchMock
    const { rerender } = render(<NaverPhotoSaveList photos={photos} />)
    await screen.findByRole('button', { name: '사진 1 저장' })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    rerender(<NaverPhotoSaveList photos={photos.map((photo) => ({ ...photo }))} />)
    expect(screen.getByRole('button', { name: '사진 1 저장' })).toBeEnabled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('enables buttons with "사진 N 저장" after photos are prepared', async () => {
    const blob1 = new Blob(['img1'], { type: 'image/jpeg' })
    const blob2 = new Blob(['img2'], { type: 'image/png' })

    global.fetch = vi.fn().mockImplementation((url: string) => {
      const blob = url.includes('p1') ? blob1 : blob2
      return Promise.resolve({
        ok: true,
        blob: () => Promise.resolve(blob),
      })
    })

    render(<NaverPhotoSaveList photos={photos} />)

    const btn1 = await screen.findByRole('button', { name: '사진 1 저장' })
    const btn2 = await screen.findByRole('button', { name: '사진 2 저장' })

    expect(btn1).toBeEnabled()
    expect(btn2).toBeEnabled()
    expect(btn1).not.toHaveAttribute('aria-busy', 'true')
    expect(btn2).not.toHaveAttribute('aria-busy', 'true')

    const img1 = screen.getByRole('img', { name: '첫 번째 사진' })
    const img2 = screen.getByRole('img', { name: '두 번째 사진' })
    expect(img1).toHaveAttribute('src', 'https://example.com/p1.jpg')
    expect(img2).toHaveAttribute('src', 'https://example.com/p2.png')
  })

  it('limits concurrent prefetching to at most 2 photos', async () => {
    const threePhotos = [
      { id: 'p1', src: 'https://example.com/p1.jpg', alt: '1' },
      { id: 'p2', src: 'https://example.com/p2.jpg', alt: '2' },
      { id: 'p3', src: 'https://example.com/p3.jpg', alt: '3' },
    ]

    const resolvers: Array<(value: unknown) => void> = []
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve)
        }),
    )
    global.fetch = fetchMock

    render(<NaverPhotoSaveList photos={threePhotos} />)

    // At initial mount, only 2 requests should be sent concurrently
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // Resolve the first request
    const blob = new Blob(['img'], { type: 'image/jpeg' })
    await act(async () => {
      resolvers[0]({
        ok: true,
        blob: () => Promise.resolve(blob),
      })
    })

    // Once one finishes, the 3rd request should be dispatched
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
  })

  it('calls navigator.share immediately without awaiting fetch on click, showing guiding messages', async () => {
    let resolveShare!: () => void
    const sharePromise = new Promise<void>((resolve) => {
      resolveShare = resolve
    })
    const shareMock = vi.fn().mockReturnValue(sharePromise)
    const canShareMock = vi.fn().mockReturnValue(true)

    Object.defineProperty(navigator, 'canShare', {
      value: canShareMock,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(navigator, 'share', {
      value: shareMock,
      configurable: true,
      writable: true,
    })

    const blob = new Blob(['image-data'], { type: 'image/jpeg' })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(blob),
    })
    global.fetch = fetchMock

    render(<NaverPhotoSaveList photos={photos} />)

    const btn1 = await screen.findByRole('button', { name: '사진 1 저장' })
    const fetchCallsBeforeClick = fetchMock.mock.calls.length

    // Click handler must trigger share synchronously (no await before share)
    fireEvent.click(btn1)

    // Verify fetch was NOT called again on click
    expect(fetchMock.mock.calls.length).toBe(fetchCallsBeforeClick)
    expect(canShareMock).toHaveBeenCalled()
    expect(shareMock).toHaveBeenCalled()

    // Guidance status message while share sheet is open
    const statusMsg = screen.getByRole('status')
    expect(statusMsg).toHaveTextContent('공유 화면에서 "이미지 저장"을 눌러 주세요.')
    expect(statusMsg).toHaveAttribute('aria-live', 'polite')

    // After share completes
    await act(async () => {
      resolveShare()
    })

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('저장 화면을 열었어요.')
    })
  })

  it('clears message when share is canceled by user (AbortError)', async () => {
    const abortError = new Error('Share canceled')
    abortError.name = 'AbortError'

    const shareMock = vi.fn().mockRejectedValue(abortError)
    const canShareMock = vi.fn().mockReturnValue(true)

    Object.defineProperty(navigator, 'canShare', {
      value: canShareMock,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(navigator, 'share', {
      value: shareMock,
      configurable: true,
      writable: true,
    })

    const blob = new Blob(['image-data'], { type: 'image/jpeg' })
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(blob),
    })

    render(<NaverPhotoSaveList photos={photos} />)

    const btn1 = await screen.findByRole('button', { name: '사진 1 저장' })
    fireEvent.click(btn1)

    await waitFor(() => {
      expect(shareMock).toHaveBeenCalled()
    })

    // Message should be cleared without error alert
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('displays alert message when share fails with NotAllowedError or generic error', async () => {
    const notAllowedError = new Error('Permission denied')
    notAllowedError.name = 'NotAllowedError'

    const shareMock = vi.fn().mockRejectedValue(notAllowedError)
    const canShareMock = vi.fn().mockReturnValue(true)

    Object.defineProperty(navigator, 'canShare', {
      value: canShareMock,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(navigator, 'share', {
      value: shareMock,
      configurable: true,
      writable: true,
    })

    const blob = new Blob(['image-data'], { type: 'image/jpeg' })
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(blob),
    })

    render(<NaverPhotoSaveList photos={photos} />)

    const btn1 = await screen.findByRole('button', { name: '사진 1 저장' })
    fireEvent.click(btn1)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      '이 사진을 저장하지 못했어요. 다시 시도하거나 ZIP으로 받아 주세요.',
    )
  })

  it('falls back to pre-created object URL with <a download> when canShare is unsupported', async () => {
    Object.defineProperty(navigator, 'canShare', {
      value: () => false,
      configurable: true,
      writable: true,
    })

    const blob = new Blob(['image-data'], { type: 'image/png' })
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(blob),
    })

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(<NaverPhotoSaveList photos={photos} />)

    const btn2 = await screen.findByRole('button', { name: '사진 2 저장' })
    fireEvent.click(btn2)

    expect(clickSpy).toHaveBeenCalled()
    const statusMsg = await screen.findByRole('status')
    expect(statusMsg).toHaveTextContent(
      '다운로드를 시작했어요. 파일 앱 또는 다운로드 목록을 확인해 주세요.',
    )
    expect(statusMsg).toHaveAttribute('aria-live', 'polite')
  })

  it('isolates prefetch failure to the affected photo, leaving other photos ready', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('p1')) {
        return Promise.resolve({ ok: false, status: 500 })
      }
      return Promise.resolve({
        ok: true,
        blob: () => Promise.resolve(new Blob(['p2'], { type: 'image/jpeg' })),
      })
    })

    render(<NaverPhotoSaveList photos={photos} />)

    // p1 failed
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      '이 사진을 저장하지 못했어요. 다시 시도하거나 ZIP으로 받아 주세요.',
    )
    expect(screen.getAllByRole('alert')).toHaveLength(1)

    // p2 succeeded and ready
    const btn2 = screen.getByRole('button', { name: '사진 2 저장' })
    expect(btn2).toBeEnabled()
  })

  it('revokes created object URLs when unmounted or when photos prop changes', async () => {
    const blob = new Blob(['image-data'], { type: 'image/jpeg' })
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(blob),
    })

    const { unmount, rerender } = render(<NaverPhotoSaveList photos={photos} />)

    await screen.findByRole('button', { name: '사진 1 저장' })
    expect(createObjectURLSpy).toHaveBeenCalledTimes(2)

    // Change photos prop
    const nextPhotos = [{ id: 'p3', src: 'https://example.com/p3.jpg', alt: '3' }]
    rerender(<NaverPhotoSaveList photos={nextPhotos} />)

    // Previous URLs must be revoked
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(2)

    await screen.findByRole('button', { name: '사진 1 저장' })
    expect(createObjectURLSpy).toHaveBeenCalledTimes(3)

    unmount()
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(3)
  })
})

