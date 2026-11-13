// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  draw: vi.fn(),
  fonts: vi.fn(async () => undefined),
  loadSummary: vi.fn(),
  saveDefaults: vi.fn(),
}))
vi.mock('../actions/compose-image', () => ({ saveComposedImageAction: mocks.save }))
vi.mock('./overlay-renderer', () => ({ drawOverlay: mocks.draw, ensureOverlayFonts: mocks.fonts }))
vi.mock('../actions/load-style-summary', () => ({ loadWorkspaceStyleSummaryAction: mocks.loadSummary }))
vi.mock('../actions/overlay-defaults', () => ({ saveOverlayDefaultsAction: mocks.saveDefaults }))

const createObjectURLMock = vi.fn(() => 'blob:http://localhost/mock-blob-url')
const revokeObjectURLMock = vi.fn()
if (typeof URL.createObjectURL === 'undefined') {
  URL.createObjectURL = createObjectURLMock
} else {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURLMock)
}
if (typeof URL.revokeObjectURL === 'undefined') {
  URL.revokeObjectURL = revokeObjectURLMock
} else {
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURLMock)
}

import { OverlayComposer } from './overlay-composer'

const workspaceId = '20000000-0000-4000-8000-000000000001'

class FakeImage {
  width = 1024
  height = 1536
  naturalWidth = 1024
  naturalHeight = 1536
  crossOrigin = ''
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(_value: string) { queueMicrotask(() => this.onload?.()) }
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  vi.stubGlobal('Image', FakeImage)
  HTMLCanvasElement.prototype.getContext = (() => ({})) as never
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) { cb(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })) } as never
  mocks.save.mockResolvedValue({ data: { assetId: '50000000-0000-4000-8000-000000000001', url: '/api/workspaces/w/media/50000000-0000-4000-8000-000000000001' } })
  mocks.loadSummary.mockResolvedValue({ data: null })
  mocks.saveDefaults.mockResolvedValue({ data: { saved: true } })
})

describe('OverlayComposer', () => {
  it('does not carry a previous workspace text into another workspace when props change', async () => {
    const { rerender } = render(<OverlayComposer workspaceId={workspaceId} baseUrl={null} />)
    fireEvent.change(screen.getByLabelText('큰 제목 (흰색)'), { target: { value: 'FIRST BUSINESS ONLY' } })
    const otherWorkspaceId = '20000000-0000-4000-8000-000000000002'
    rerender(<OverlayComposer workspaceId={otherWorkspaceId} baseUrl={null} />)
    await waitFor(() => expect((screen.getByLabelText('큰 제목 (흰색)') as HTMLInputElement).value).toBe(''))
    expect(window.localStorage.getItem(`sohee:overlay:${otherWorkspaceId}`) ?? '').not.toContain('FIRST BUSINESS ONLY')
  })
  it('keeps the editor usable and reports a server defaults load rejection', async () => {
    mocks.loadSummary.mockRejectedValueOnce(new Error('stale action'))
    render(<OverlayComposer workspaceId={workspaceId} baseUrl={null} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('기본 문구를 불러오지 못했어요')
    fireEvent.change(screen.getByLabelText('큰 제목 (흰색)'), { target: { value: 'KEEP EDITING' } })
    expect((screen.getByLabelText('큰 제목 (흰색)') as HTMLInputElement).value).toBe('KEEP EDITING')
  })

  it('reports a rejected defaults save while preserving the typed text', async () => {
    mocks.saveDefaults.mockRejectedValueOnce(new Error('stale action'))
    render(<OverlayComposer workspaceId={workspaceId} baseUrl={null} />)
    fireEvent.change(screen.getByLabelText('큰 제목 (흰색)'), { target: { value: 'KEEP MY TITLE' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '이 문구를 기본값으로 저장' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '이 문구를 기본값으로 저장' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('기본 문구를 저장하지 못했어요')
    expect((screen.getByLabelText('큰 제목 (흰색)') as HTMLInputElement).value).toBe('KEEP MY TITLE')
  })

  it('reports a rejected composed image save without losing editor contents', async () => {
    mocks.save.mockRejectedValueOnce(new Error('network failed'))
    render(<OverlayComposer workspaceId={workspaceId} baseUrl={null} />)
    fireEvent.change(screen.getByLabelText('큰 제목 (흰색)'), { target: { value: 'KEEP IMAGE TITLE' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '이 이미지 저장' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '이 이미지 저장' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('이미지를 저장하지 못했어요')
    expect((screen.getByLabelText('큰 제목 (흰색)') as HTMLInputElement).value).toBe('KEEP IMAGE TITLE')
  })

  it('draws the base photo with the chosen preset and the typed texts', async () => {
    render(<OverlayComposer workspaceId={workspaceId} baseUrl="/api/workspaces/w/media/base" />)
    fireEvent.change(screen.getByLabelText('큰 제목 (흰색)'), { target: { value: 'BY.REUM BROW' } })
    fireEvent.change(screen.getByLabelText('포인트 문구 (보라색)'), { target: { value: "Design. Women's Combo Brow" } })
    await waitFor(() => expect(mocks.draw).toHaveBeenCalled())
    const layout = mocks.draw.mock.calls.at(-1)?.[1] as { texts: Array<{ text: string }> }
    expect(layout.texts.map((t) => t.text)).toEqual(expect.arrayContaining(['BY.REUM BROW', "Design. Women's Combo Brow"]))
    fireEvent.click(screen.getByRole('button', { name: /오른쪽 문구/ }))
    await waitFor(() => {
      const last = mocks.draw.mock.calls.at(-1)?.[1] as { texts: Array<{ align: string }> }
      expect(last.texts[0]?.align).toBe('right')
    })
  })

  it('needs a before photo for the inset and uploads the composed PNG, reporting the new asset', async () => {
    const onSaved = vi.fn()
    render(<OverlayComposer workspaceId={workspaceId} baseUrl="/api/workspaces/w/media/base" onSaved={onSaved} />)
    fireEvent.change(screen.getByLabelText('전(BEFORE) 사진 (선택)'), { target: { files: [new File(['x'], 'before.jpg', { type: 'image/jpeg' })] } })
    await waitFor(() => {
      const last = mocks.draw.mock.calls.at(-1)?.[1] as { inset: unknown }
      expect(last.inset).not.toBeNull()
    })
    fireEvent.click(screen.getByRole('button', { name: '이 이미지 저장' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ assetId: '50000000-0000-4000-8000-000000000001', url: expect.stringContaining('/media/') }))
    const sent = mocks.save.mock.calls[0]?.[0] as FormData
    expect(sent.get('workspaceId')).toBe(workspaceId)
    expect((sent.get('file') as File).type).toBe('image/png')
  })

  it('remembers the texts per workspace and shows save errors', async () => {
    const { unmount } = render(<OverlayComposer workspaceId={workspaceId} baseUrl="/b" />)
    fireEvent.change(screen.getByLabelText('큰 제목 (흰색)'), { target: { value: 'MY STUDIO' } })
    unmount()
    render(<OverlayComposer workspaceId={workspaceId} baseUrl="/b" />)
    expect((screen.getByLabelText('큰 제목 (흰색)') as HTMLInputElement).value).toBe('MY STUDIO')
    mocks.save.mockResolvedValueOnce({ error: { message: '합성한 이미지를 저장하지 못했어요.', requestId: 'x' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '이 이미지 저장' })).toBeEnabled())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '이 이미지 저장' })) })
    expect(await screen.findByRole('alert')).toHaveTextContent('저장하지 못했어요')
  })

  it('downloads the composed PNG on download button click', async () => {
    let clickedDownloadAttr: string | null = null
    let clickedHrefAttr: string | null = null
    const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clickedDownloadAttr = this.getAttribute('download')
      clickedHrefAttr = this.getAttribute('href')
    })
    render(<OverlayComposer workspaceId={workspaceId} baseUrl="/api/workspaces/w/media/base" />)
    const downloadBtn = await screen.findByRole('button', { name: '내려받기' })
    await waitFor(() => expect(downloadBtn).toBeEnabled())
    await act(async () => {
      fireEvent.click(downloadBtn)
    })
    expect(createObjectURLMock).toHaveBeenCalledWith(expect.any(Blob))
    expect(anchorClickSpy).toHaveBeenCalled()
    expect(clickedDownloadAttr).toBe('sohee-composed.png')
    expect(clickedHrefAttr).toBe('blob:http://localhost/mock-blob-url')
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:http://localhost/mock-blob-url')
    anchorClickSpy.mockRestore()
  })

  it('shows tainted canvas error as alert when toBlob throws an exception', async () => {
    HTMLCanvasElement.prototype.toBlob = function () {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    } as never
    render(<OverlayComposer workspaceId={workspaceId} baseUrl="/api/workspaces/w/media/base" />)
    const downloadBtn = await screen.findByRole('button', { name: '내려받기' })
    await waitFor(() => expect(downloadBtn).toBeEnabled())
    await act(async () => {
      fireEvent.click(downloadBtn)
    })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('이 사진은 브라우저에서 합성할 수 없어요. 다른 사진으로 시도해 주세요.')
  })

  it('updates the preset guidance hint when changing presets', async () => {
    render(<OverlayComposer workspaceId={workspaceId} baseUrl="/api/workspaces/w/media/base" />)
    expect(screen.getByText('전 사진이 없으면 삽입컷은 그리지 않아요.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '원형 BEFORE 컷' }))
    expect(screen.getByText('원형 삽입컷에는 핵심 디테일을 가까이 찍은 사진이 잘 어울려요.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '후기 카드' }))
    expect(screen.getByText('후기 문장은 고객 동의를 받은 내용만 넣어 주세요.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '포트레이트 · 오른쪽 문구' }))
    expect(screen.getByText('전 사진이 없으면 삽입컷은 그리지 않아요.')).toBeInTheDocument()
  })

  it('uses generic placeholders and does not expose specific shop branding in empty state', () => {
    render(<OverlayComposer workspaceId={workspaceId} baseUrl="/api/workspaces/w/media/base" />)
    const brandInput = screen.getByLabelText('큰 제목 (흰색)') as HTMLInputElement
    const designInput = screen.getByLabelText('포인트 문구 (보라색)') as HTMLInputElement
    const quoteInput = screen.getByLabelText('작은 본문 (줄바꿈 가능, 4줄까지)') as HTMLTextAreaElement

    expect(brandInput.placeholder).toBe('예: 우리 가게 이름')
    expect(designInput.placeholder).toBe('예: 대표 서비스 이름 또는 한 줄 소개')
    expect(quoteInput.placeholder).toBe('예: 한 줄 소개나 인사말\n줄바꿈으로 나눠 쓸 수 있어요.')

    // 후기 카드 모드 확인
    fireEvent.click(screen.getByRole('button', { name: '후기 카드' }))
    const reviewCardTitle = screen.getByLabelText('카드 제목') as HTMLInputElement
    const reviewCardSubtitle = screen.getByLabelText('작은 소제목') as HTMLInputElement

    expect(reviewCardTitle.placeholder).toBe('예: CUSTOMER REVIEW')
    expect(reviewCardSubtitle.placeholder).toBe('예: 가게 이름')

    // 전체 화면에 눈썹 / BY.REUM 노출 없음
    const matches = screen.queryAllByText(/눈썹|BY\.REUM/)
    expect(matches).toHaveLength(0)
  })

  it('loads server defaults when localStorage is empty and user has not typed yet', async () => {
    mocks.loadSummary.mockResolvedValueOnce({
      data: {
        overlay: {
          preset: 'portrait-right',
          brandLine: '서버 브랜드',
          designLine: '서버 디자인 라인',
          quote: '서버 인용구',
          insetLabel: '전',
        },
      },
    })

    render(<OverlayComposer workspaceId={workspaceId} baseUrl="/api/workspaces/w/media/base" />)

    await waitFor(() => {
      expect((screen.getByLabelText('큰 제목 (흰색)') as HTMLInputElement).value).toBe('서버 브랜드')
    })
    expect((screen.getByLabelText('포인트 문구 (보라색)') as HTMLInputElement).value).toBe('서버 디자인 라인')
    expect((screen.getByLabelText('작은 본문 (줄바꿈 가능, 4줄까지)') as HTMLTextAreaElement).value).toBe('서버 인용구')
    expect((screen.getByLabelText('삽입컷 라벨') as HTMLInputElement).value).toBe('전')
  })

  it('prioritizes localStorage over server defaults when localStorage exists', async () => {
    window.localStorage.setItem(
      `sohee:overlay:${workspaceId}`,
      JSON.stringify({
        preset: 'portrait-left',
        texts: {
          brandLine: '로컬스토리지 브랜드',
          designLine: '로컬 디자인',
          quote: '로컬 본문',
          insetLabel: 'BEFORE',
        },
      }),
    )

    mocks.loadSummary.mockResolvedValueOnce({
      data: {
        overlay: {
          preset: 'review-card',
          brandLine: '서버 브랜드',
          designLine: '서버 디자인',
          quote: '서버 본문',
          insetLabel: '전',
        },
      },
    })

    render(<OverlayComposer workspaceId={workspaceId} baseUrl="/api/workspaces/w/media/base" />)

    expect((screen.getByLabelText('큰 제목 (흰색)') as HTMLInputElement).value).toBe('로컬스토리지 브랜드')
    expect(mocks.loadSummary).not.toHaveBeenCalled()
  })

  it('does not overwrite user input if user starts typing before server response arrives', async () => {
    let resolveServer: (val: unknown) => void = () => undefined
    mocks.loadSummary.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveServer = resolve
      }),
    )

    render(<OverlayComposer workspaceId={workspaceId} baseUrl="/api/workspaces/w/media/base" />)

    fireEvent.change(screen.getByLabelText('큰 제목 (흰색)'), { target: { value: '사용자 직접 입력' } })

    await act(async () => {
      resolveServer({
        data: {
          overlay: {
            preset: 'portrait-right',
            brandLine: '서버 브랜드',
            designLine: '서버 디자인',
            quote: '서버 본문',
            insetLabel: 'BEFORE',
          },
        },
      })
    })

    expect((screen.getByLabelText('큰 제목 (흰색)') as HTMLInputElement).value).toBe('사용자 직접 입력')
  })

  it('saves defaults via saveOverlayDefaultsAction and displays status/alert feedback', async () => {
    render(<OverlayComposer workspaceId={workspaceId} baseUrl="/api/workspaces/w/media/base" />)

    fireEvent.change(screen.getByLabelText('큰 제목 (흰색)'), { target: { value: '기본 브랜드' } })
    fireEvent.change(screen.getByLabelText('포인트 문구 (보라색)'), { target: { value: '기본 디자인' } })

    const saveDefaultsBtn = screen.getByRole('button', { name: '이 문구를 기본값으로 저장' })
    expect(saveDefaultsBtn).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(saveDefaultsBtn)
    })

    expect(mocks.saveDefaults).toHaveBeenCalledWith({
      workspaceId,
      preset: 'portrait-left',
      texts: expect.objectContaining({
        brandLine: '기본 브랜드',
        designLine: '기본 디자인',
      }),
    })

    const statusMsg = await screen.findByRole('status')
    expect(statusMsg).toHaveTextContent('기본 문구로 저장했어요.')

    // 실패 케이스
    mocks.saveDefaults.mockResolvedValueOnce({
      error: { message: '기본 문구를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.', requestId: 'test' },
    })

    await act(async () => {
      fireEvent.click(saveDefaultsBtn)
    })

    const alertMsg = await screen.findByRole('alert')
    expect(alertMsg).toHaveTextContent('기본 문구를 저장하지 못했어요.')
  })
})
