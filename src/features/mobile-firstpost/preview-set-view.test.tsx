// @vitest-environment jsdom
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DEMO_PLACEHOLDER_IMAGE } from './demo-placeholder'
import { PreviewSetView } from './preview-set-view'
import { seedPreviewSet, type ChannelCapability, type PreviewAsset } from './preview-set'

const asset: PreviewAsset = { assetId: 'a1', imageUrl: 'https://example.com/a.jpg', width: 800, height: 1000, rights: 'CONFIRMED' }
const state = seedPreviewSet({
  channels: [
    { channel: 'instagram', copy: { text: '신메뉴 출시', cta: '예약하기' } },
    { channel: 'threads', copy: { text: '짧은 글', cta: '문의' } },
  ],
})
const caps: ChannelCapability[] = [{ channel: 'instagram', connection: 'NOT_CONNECTED', canPublish: false }]

describe('PreviewSetView', () => {
  it('사진 사용 권리 미확인이면 미리보기 대신 안내를 보여준다', () => {
    render(<PreviewSetView asset={{ ...asset, rights: 'UNCONFIRMED' }} datasetMode="ACTUAL" state={state} capabilities={caps} onChange={vi.fn()} />)
    expect(screen.getByRole('alert').textContent).toContain('사진 사용 확인이 필요해요')
    expect(screen.queryByAltText('올릴 사진')).toBeNull()
  })

  it('게시 권한이 없으면 게시하기 없이 저장·복사·다운로드를 노출한다', () => {
    render(<PreviewSetView asset={asset} datasetMode="ACTUAL" state={state} capabilities={caps} onChange={vi.fn()} />)
    expect(screen.queryByText('게시하기')).toBeNull()
    expect(screen.getByText('복사')).toBeTruthy()
    expect(screen.getByText('저장됨')).toBeTruthy()
    expect(document.body.textContent).not.toContain('게시완료')
  })

  it('문구 수정은 저장 안 됨으로 바꾸고 콜백으로 전달한다', () => {
    const onChange = vi.fn()
    render(<PreviewSetView asset={asset} datasetMode="ACTUAL" state={state} capabilities={caps} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('인스타그램 문구'), { target: { value: '바뀐 문구' } })
    expect(onChange.mock.calls[0][0].save).toBe('DIRTY')
  })

  it('조회 실패는 빈 화면이 아니라 오류 상태로 보인다', () => {
    render(<PreviewSetView asset={asset} datasetMode="ACTUAL" state={state} capabilities={caps} load="error" onChange={vi.fn()} />)
    expect(screen.queryByLabelText('인스타그램 문구')).toBeNull()
  })

  it('초안이 없는 채널 탭도 비활성(저대비)으로 만들지 않고 안내 문구를 보여준다', () => {
    const one = seedPreviewSet({ channels: [{ channel: 'instagram', copy: { text: '글', cta: '예약' } }] })
    render(<PreviewSetView asset={asset} datasetMode="ACTUAL" state={one} capabilities={caps} onChange={vi.fn()} />)
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios.every((r) => !r.disabled)).toBe(true)
  })

  it('미리보기 사진은 지연 로딩·비동기 디코딩을 쓴다', () => {
    render(<PreviewSetView asset={asset} datasetMode="ACTUAL" state={state} capabilities={caps} onChange={vi.fn()} />)
    const img = screen.getByAltText('올릴 사진') as HTMLImageElement
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(img.getAttribute('decoding')).toBe('async')
  })

  it('사진은 채널 세로형 틀 안에서 원본 비율 그대로 보인다(자르지 않음)', () => {
    // 가로로 찍은 사진도 세로형 틀에 넣되, 잘라내지 않고 여백으로 둔다.
    const landscape: PreviewAsset = { ...asset, width: 1600, height: 1200 }
    render(<PreviewSetView asset={landscape} datasetMode="ACTUAL" state={state} capabilities={caps} onChange={vi.fn()} />)
    const figure = document.querySelector('[data-first-post-preview] figure') as HTMLElement
    expect(figure.getAttribute('data-preview-channel')).toBe('instagram')
    expect(Number(figure.getAttribute('data-frame-aspect'))).toBeLessThan(1)
    expect(figure.getAttribute('data-frame-evidence')).toBe('UNVERIFIED')
    expect((screen.getByAltText('올릴 사진') as HTMLImageElement).className).toContain('object-contain')
    expect(figure.textContent).toContain('화면 비율은 아직 확인 전이에요')
  })

  it('채널을 바꾸면 미리보기 틀도 그 채널로 바뀐다', () => {
    function Harness() {
      const [current, setCurrent] = useState(state)
      return <PreviewSetView asset={asset} datasetMode="ACTUAL" state={current} capabilities={caps} onChange={setCurrent} />
    }
    render(<Harness />)
    expect(document.querySelector('[data-first-post-preview] figure')?.getAttribute('data-preview-channel')).toBe('instagram')
    fireEvent.click(screen.getByRole('radio', { name: '스레드' }))
    expect(document.querySelector('[data-first-post-preview] figure')?.getAttribute('data-preview-channel')).toBe('threads')
  })

  it('실사진이 없으면 샘플로 채우지 않고 정직한 빈 상태를 보여준다', () => {
    render(<PreviewSetView asset={null} datasetMode="ACTUAL" state={state} capabilities={caps} onChange={vi.fn()} />)
    expect(screen.getByRole('alert').textContent).toContain('사진이 아직 없어요')
    expect(screen.queryByAltText('올릴 사진')).toBeNull()
    expect(document.querySelector('[data-first-post-preview]')?.getAttribute('data-dataset-mode')).toBe('ACTUAL')
  })

  it('실제 데이터에서는 인라인 자리표시자도 사진으로 그리지 않는다', () => {
    const demoAsset: PreviewAsset = { ...asset, imageUrl: DEMO_PLACEHOLDER_IMAGE }
    render(<PreviewSetView asset={demoAsset} datasetMode="ACTUAL" state={state} capabilities={caps} onChange={vi.fn()} />)
    expect(screen.queryByAltText('올릴 사진')).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('사진을 불러오지 못했어요')
  })

  it('예시 화면은 데이터셋 모드 라벨과 함께 보인다', () => {
    const demoAsset: PreviewAsset = { ...asset, imageUrl: DEMO_PLACEHOLDER_IMAGE }
    render(<PreviewSetView asset={demoAsset} datasetMode="SHOWCASE_DEMO" state={state} capabilities={caps} onChange={vi.fn()} />)
    expect(screen.getByRole('note').textContent).toContain('예시 화면이에요')
    expect(document.querySelector('[data-dataset-mode-label="SHOWCASE_DEMO"]')).toBeTruthy()
    expect(screen.getByAltText('올릴 사진')).toBeTruthy()
  })

  it('실행 경로가 없는 화면은 게시 권한이 있어도 저장·복사·다운로드를 남긴다', () => {
    // 게시 가능한 채널이면 previewActions 의 manualFallback 이 비므로, 그대로 쓰면 하단이 빈다.
    const publishable: ChannelCapability[] = [{ channel: 'instagram', connection: 'CONNECTED', canPublish: true }]
    const demoAsset: PreviewAsset = { ...asset, imageUrl: DEMO_PLACEHOLDER_IMAGE }
    render(<PreviewSetView asset={demoAsset} datasetMode="SHOWCASE_DEMO" state={state} capabilities={publishable} onChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '이 내용 검토' })).toBeNull()
    expect(screen.getByRole('button', { name: '저장' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '복사' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '다운로드' })).toBeTruthy()
    // 예시 데이터셋에서는 세 동작 모두 막고 이유를 보여 준다.
    for (const name of ['저장', '복사', '다운로드']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    }
    expect(screen.getAllByText(/예시 화면에서는 쓸 수 없어요/).length).toBe(3)
  })

  it('실제 데이터에서는 복사가 현재 채널의 본문+CTA를 클립보드에 넣는다', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<PreviewSetView asset={asset} datasetMode="ACTUAL" state={state} capabilities={caps} onChange={vi.fn()} />)
    const copy = screen.getByRole('button', { name: '복사' }) as HTMLButtonElement
    expect(copy.disabled).toBe(false)
    fireEvent.click(copy)
    expect(writeText).toHaveBeenCalledWith('신메뉴 출시\n\n예약하기')
    expect(await screen.findByText('문구를 복사했어요. 게시된 것은 아니에요.')).toBeTruthy()
  })

  it('실제 데이터에서도 저장은 API가 없으므로 비활성 + 사유, 다운로드는 실제 사진으로 열린다', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Blob(['x']))))
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() })
    render(<PreviewSetView asset={asset} datasetMode="ACTUAL" state={state} capabilities={caps} onChange={vi.fn()} />)
    expect((screen.getByRole('button', { name: '저장' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/원고 저장은 아직 준비 중이에요/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '다운로드' }))
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    click.mockRestore()
    vi.unstubAllGlobals()
  })

  it('문구가 비면 복사 버튼은 자기 사유에 연결된다', () => {
    const empty = seedPreviewSet({ channels: [{ channel: 'instagram', copy: { text: '', cta: '예약' } }] })
    render(<PreviewSetView asset={asset} datasetMode="ACTUAL" state={empty} capabilities={caps} onChange={vi.fn()} />)
    const copy = screen.getByRole('button', { name: '복사' })
    expect(document.getElementById(copy.getAttribute('aria-describedby')!)?.textContent).toContain('복사할 문구가 없어요')
  })

  it('사진 권리 미확인이면 복사·다운로드도 막는다', () => {
    render(<PreviewSetView asset={{ ...asset, rights: 'UNCONFIRMED' }} datasetMode="ACTUAL" state={state} capabilities={caps} onChange={vi.fn()} />)
    expect((screen.getByRole('button', { name: '복사' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '다운로드' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('실제 데이터 화면에는 데이터셋 모드 라벨을 붙이지 않는다', () => {
    render(<PreviewSetView asset={asset} datasetMode="ACTUAL" state={state} capabilities={caps} onChange={vi.fn()} />)
    expect(screen.queryByRole('note')).toBeNull()
  })
  it('readOnly=true 일 때 기본 안내 문구를 렌더링하고, readOnlyMessage 전달 시 커스텀 안내로 대체된다', () => {
    // 1. 기본 readOnly 안내 문구 (기존 소비자 호환)
    const { unmount } = render(
      <PreviewSetView asset={asset} datasetMode="ACTUAL" state={state} capabilities={caps} onChange={vi.fn()} readOnly />
    )
    expect(screen.getByText('문구 고치기는 편집 화면에서 할 수 있어요.')).toBeInTheDocument()
    unmount()

    // 2. readOnlyMessage 지정 시 커스텀 정직한 안내 문구 표시
    render(
      <PreviewSetView
        asset={asset}
        datasetMode="ACTUAL"
        state={state}
        capabilities={caps}
        onChange={vi.fn()}
        readOnly
        readOnlyMessage="현재 문구 수정·저장 기능을 준비 중이에요. 지금은 원문을 확인할 수 있어요."
      />
    )
    expect(screen.getByText('현재 문구 수정·저장 기능을 준비 중이에요. 지금은 원문을 확인할 수 있어요.')).toBeInTheDocument()
    expect(screen.queryByText('문구 고치기는 편집 화면에서 할 수 있어요.')).toBeNull()
  })
})
