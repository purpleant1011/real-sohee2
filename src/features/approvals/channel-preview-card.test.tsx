import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ApprovalPreviewSnapshot } from '@/features/content/types'
import { ChannelPreviewCard } from './channel-preview-card'

const instagramPreview: ApprovalPreviewSnapshot = {
  workspaceId: '10000000-0000-4000-8000-000000000001',
  contentId: '20000000-0000-4000-8000-000000000001',
  versionId: '30000000-0000-4000-8000-000000000001',
  versionNumber: 3,
  fingerprint: 'a'.repeat(64),
  approval: { id: null, status: 'unreviewed', fingerprint: null },
  channel: 'instagram',
  account: { connectionId: '40000000-0000-4000-8000-000000000001', label: '@sohee', status: 'connected' },
  caption: '정확한 본문',
  hashtags: ['#소희'],
  disclosure: '',
  text: '정확한 본문\n\n#소희',
  media: [
    { id: '50000000-0000-4000-8000-000000000001', position: 1, mimeType: 'image/jpeg', altText: '전후 결과 사진', src: '/media/first' },
    { id: '50000000-0000-4000-8000-000000000002', position: 2, mimeType: 'image/png', altText: '결 방향 확대 사진', src: '/media/second' },
    { id: '50000000-0000-4000-8000-000000000003', position: 3, mimeType: 'image/jpeg', altText: '관리 안내 사진', src: '/media/third' },
  ],
  issues: [],
}

describe('ChannelPreviewCard', () => {
  it.each([
    ['인스타그램', instagramPreview],
    ['스레드', { ...instagramPreview, channel: 'threads' as const, media: [] }],
    ['네이버 블로그', { ...instagramPreview, channel: 'naver_blog' as const }],
  ])('always frames an approved %s preview as an expected screen without identifiers', (name, preview) => {
    const { container } = render(<ChannelPreviewCard preview={preview} onMediaReadinessChange={vi.fn()} />)
    const frame = screen.getByRole('region', { name: `${name} 예상 화면` })
    expect(frame).toHaveTextContent('예상 화면')
    expect(frame).toHaveTextContent('실제 게시 화면과 다를 수 있어요.')
    expect(container).not.toHaveTextContent(preview.fingerprint)
    expect(container).not.toHaveTextContent(preview.versionId)
  })
  it('renders an Instagram carousel with exact ordered media and page state', async () => {
    const editImage = vi.fn()
    const editCaption = vi.fn()
    render(<ChannelPreviewCard preview={instagramPreview} onEditCaption={editCaption} onEditImage={editImage} onMediaReadinessChange={vi.fn()} />)
    expect(screen.getByRole('region', { name: 'Instagram v3 게시 미리보기' })).toBeInTheDocument()
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    const firstImage = screen.getByRole('img', { name: '전후 결과 사진' })
    const nextButton = screen.getByRole('button', { name: '다음 이미지, 2 / 3' })
    expect(firstImage).toBeInTheDocument()
    expect(nextButton).toBeDisabled()
    fireEvent.load(firstImage)
    await waitFor(() => expect(nextButton).toBeEnabled())
    fireEvent.click(nextButton)
    const secondImage = screen.getByRole('img', { name: '결 방향 확대 사진' })
    expect(secondImage).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다음 이미지, 3 / 3' })).toBeDisabled()
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    expect(screen.getByText(/정확한 본문/)).toHaveTextContent('정확한 본문 #소희')
    expect(screen.queryByText(/좋아요 \d/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '게시 이미지 수정' }))
    fireEvent.click(screen.getByRole('button', { name: '게시 문구 수정' }))
    expect(editImage).toHaveBeenCalledTimes(1)
    expect(editCaption).toHaveBeenCalledTimes(1)
  })

  it('checks every Instagram image without requiring carousel traversal', async () => {
    const ready = vi.fn()
    const status = vi.fn()
    const { container } = render(
      <ChannelPreviewCard
        preview={instagramPreview}
        onMediaReadinessChange={ready}
        onMediaStatusChange={status}
      />,
    )

    const preloads = [...container.querySelectorAll('[data-media-preload]')]
    expect(preloads).toHaveLength(3)
    preloads.forEach((image) => fireEvent.load(image))

    await waitFor(() => expect(ready).toHaveBeenLastCalledWith(true))
    await waitFor(() => expect(status).toHaveBeenLastCalledWith({ total: 3, loaded: 3, failedPositions: [], ready: true }))
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
  })

  it('does not require carousel traversal for approval and blocks only an observed image failure', async () => {
    const ready = vi.fn()
    const status = vi.fn()
    render(
      <ChannelPreviewCard
        preview={instagramPreview}
        onMediaReadinessChange={ready}
        onMediaStatusChange={status}
      />,
    )

    expect(ready).toHaveBeenLastCalledWith(true)
    expect(status).toHaveBeenLastCalledWith({ total: 3, loaded: 0, failedPositions: [], ready: true })

    fireEvent.error(screen.getByRole('img', { name: '전후 결과 사진' }))
    await waitFor(() => expect(ready).toHaveBeenLastCalledWith(false))
    expect(status).toHaveBeenLastCalledWith({ total: 3, loaded: 0, failedPositions: [1], ready: false })
  })

  it('renders Threads as a text-first article without Instagram reaction chrome', () => {
    const threads: ApprovalPreviewSnapshot = {
      ...instagramPreview,
      channel: 'threads',
      versionNumber: 2,
      text: 'Threads에 실제로 전달될 문구',
      media: [instagramPreview.media[0]!],
    }
    render(<ChannelPreviewCard preview={threads} onMediaReadinessChange={vi.fn()} />)
    expect(screen.getByRole('article', { name: 'Threads v2 게시 미리보기' })).toHaveTextContent(threads.text)
    expect(screen.queryByLabelText('Instagram 반응 동작')).not.toBeInTheDocument()
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  it('renders every Naver image at once and becomes ready without carousel traversal', async () => {
    const ready = vi.fn()
    const status = vi.fn()
    const naver: ApprovalPreviewSnapshot = {
      ...instagramPreview,
      channel: 'naver_blog',
      versionNumber: 1,
      account: { ...instagramPreview.account, label: 'findk3' },
      text: '반영구 눈썹 상담 전 확인 기준\n\n상담 전에 확인할 내용입니다.',
      media: instagramPreview.media,
    }
    render(<ChannelPreviewCard preview={naver} onMediaReadinessChange={ready} onMediaStatusChange={status} />)

    expect(screen.getByRole('article', { name: '네이버 블로그 v1 비공개 게시 미리보기' })).toHaveTextContent('반영구 눈썹 상담 전 확인 기준')
    expect(screen.getByRole('article', { name: '네이버 블로그 v1 비공개 게시 미리보기' })).toHaveTextContent('상담 전에 확인할 내용입니다.')
    expect(screen.getByText('findk3')).toBeInTheDocument()
    expect(screen.getByText('네이버 블로그 · 비공개 · v1')).toBeInTheDocument()
    expect(screen.queryByLabelText('Instagram 반응 동작')).not.toBeInTheDocument()
    const images = screen.getAllByRole('img')
    expect(images.map((image) => image.getAttribute('alt'))).toEqual([
      '전후 결과 사진', '결 방향 확대 사진', '관리 안내 사진',
    ])
    expect(images.every((image) => image.getAttribute('loading') === 'eager')).toBe(true)
    expect(screen.queryByRole('button', { name: /다음 이미지/u })).not.toBeInTheDocument()
    images.forEach((image) => fireEvent.load(image))
    await waitFor(() => expect(ready).toHaveBeenLastCalledWith(true))
    await waitFor(() => expect(status).toHaveBeenLastCalledWith({ total: 3, loaded: 3, failedPositions: [], ready: true }))
  })

  it('reports a failed Naver position and retries failed media as one request', async () => {
    const ready = vi.fn()
    const status = vi.fn()
    const naver: ApprovalPreviewSnapshot = {
      ...instagramPreview,
      channel: 'naver_blog',
      account: { ...instagramPreview.account, label: 'findk3' },
      media: instagramPreview.media.slice(0, 2),
    }
    const view = render(
      <ChannelPreviewCard
        preview={naver}
        onMediaReadinessChange={ready}
        onMediaStatusChange={status}
        retryRequest={0}
      />,
    )
    fireEvent.load(screen.getByRole('img', { name: '전후 결과 사진' }))
    fireEvent.error(screen.getByRole('img', { name: '결 방향 확대 사진' }))
    await waitFor(() => expect(status).toHaveBeenLastCalledWith({
      total: 2, loaded: 1, failedPositions: [2], ready: false,
    }))

    view.rerender(
      <ChannelPreviewCard
        preview={naver}
        onMediaReadinessChange={ready}
        onMediaStatusChange={status}
        retryRequest={1}
      />,
    )

    const retried = await screen.findByRole('img', { name: '결 방향 확대 사진' })
    expect(retried.getAttribute('src')).toContain('previewRetry=1')
  })

  it('renders Naver text and images in the exact saved editor block order', () => {
    const naver: ApprovalPreviewSnapshot = {
      ...instagramPreview,
      channel: 'naver_blog',
      visibility: 'public',
      naverBlocks: [
        { kind: 'paragraph', text: '도입 문단' },
        { kind: 'image', mediaId: instagramPreview.media[0]!.id, altText: '표지' },
        { kind: 'heading', text: '상담 기준' },
        { kind: 'image', mediaId: instagramPreview.media[1]!.id, altText: '상세' },
        { kind: 'cta', text: '문의해 보세요.' },
      ],
    }
    const { container } = render(<ChannelPreviewCard preview={naver} onMediaReadinessChange={vi.fn()} />)

    expect([...container.querySelectorAll('[data-naver-block]')].map((node) => node.getAttribute('data-naver-block')))
      .toEqual(['paragraph', 'image', 'heading', 'image', 'cta'])
  })

  it('renders the exact public Naver visibility instead of a hard-coded private label', () => {
    const naver: ApprovalPreviewSnapshot = {
      ...instagramPreview,
      channel: 'naver_blog',
      visibility: 'public',
      account: { ...instagramPreview.account, label: 'findk3' },
    }
    render(<ChannelPreviewCard preview={naver} onMediaReadinessChange={vi.fn()} />)
    expect(screen.getByLabelText('네이버 블로그 v3 공개 게시 미리보기')).toBeInTheDocument()
    expect(screen.getByText('네이버 블로그 · 공개 · v3')).toBeInTheDocument()
    expect(screen.getByText(/공개 범위가 승인된 버전에서 그대로 전송됩니다/)).toBeInTheDocument()
  })

  it('allows a valid text-only Threads preview', () => {
    const ready = vi.fn()
    render(<ChannelPreviewCard preview={{ ...instagramPreview, channel: 'threads', media: [] }} onMediaReadinessChange={ready} />)
    expect(screen.getByRole('article', { name: 'Threads v3 게시 미리보기' })).toBeInTheDocument()
    expect(screen.queryAllByRole('img')).toHaveLength(0)
    expect(ready).toHaveBeenLastCalledWith(true)
  })

  it('blocks readiness and offers a retry when an approved image cannot load', () => {
    const ready = vi.fn()
    render(<ChannelPreviewCard preview={instagramPreview} onMediaReadinessChange={ready} />)
    fireEvent.error(screen.getByRole('img', { name: '전후 결과 사진' }))
    expect(screen.getByRole('status')).toHaveTextContent('이미지를 불러오지 못했어요')
    expect(screen.getByRole('button', { name: '1번 이미지 다시 불러오기' })).toBeInTheDocument()
    expect(ready).toHaveBeenLastCalledWith(false)
  })

  it('accepts an already decoded private image even when a cached load event is missed', async () => {
    const width = vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(1024)
    const ready = vi.fn()
    render(<ChannelPreviewCard preview={{ ...instagramPreview, media: [instagramPreview.media[0]!] }} onMediaReadinessChange={ready} />)

    await waitFor(() => expect(ready).toHaveBeenLastCalledWith(true))
    width.mockRestore()
  })

  it('resets carousel and media readiness state when the exact version changes', async () => {
    const ready = vi.fn()
    const view = render(<ChannelPreviewCard preview={instagramPreview} onMediaReadinessChange={ready} />)
    const firstImage = screen.getByRole('img', { name: '전후 결과 사진' })
    const nextButton = screen.getByRole('button', { name: '다음 이미지, 2 / 3' })
    fireEvent.load(firstImage)
    await waitFor(() => expect(nextButton).toBeEnabled())
    fireEvent.click(nextButton)
    fireEvent.error(screen.getByRole('img', { name: '결 방향 확대 사진' }))

    view.rerender(
      <ChannelPreviewCard
        preview={{
          ...instagramPreview,
          versionId: '30000000-0000-4000-8000-000000000002',
          versionNumber: 4,
          fingerprint: 'b'.repeat(64),
        }}
        onMediaReadinessChange={ready}
      />,
    )

    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '전후 결과 사진' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
