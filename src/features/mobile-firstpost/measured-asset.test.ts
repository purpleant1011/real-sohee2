// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PreviewAsset } from './preview-set'
import { useMeasuredImage } from './measured-asset'

/**
 * 사진 측정은 브라우저의 Image 로딩에 기댄다. jsdom 은 사진을 실제로 받지 않으므로
 * 로딩 결과를 손으로 흉내 내 원본 크기를 확인한다.
 */
class ImageStub {
  static created: ImageStub[] = []
  naturalWidth = 0
  naturalHeight = 0
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  src = ''

  constructor() {
    ImageStub.created.push(this)
  }
}

const asset: PreviewAsset = {
  assetId: 'a1',
  imageUrl: 'https://example.com/api/a.jpg',
  width: 0,
  height: 0,
  rights: 'CONFIRMED',
}

function last(): ImageStub {
  return ImageStub.created[ImageStub.created.length - 1]
}

afterEach(() => {
  vi.unstubAllGlobals()
  ImageStub.created = []
})

describe('사진 원본 크기 측정 (ANI-1678)', () => {
  it('잰 크기는 지어내지 않고 원본에서 온다', () => {
    vi.stubGlobal('Image', ImageStub)
    const { result } = renderHook(() => useMeasuredImage(asset))
    expect(result.current.status).toBe('measuring')

    act(() => {
      last().naturalWidth = 1080
      last().naturalHeight = 1350
      last().onload?.()
    })

    expect(result.current.status).toBe('measured')
    expect(result.current.asset).toMatchObject({ assetId: 'a1', width: 1080, height: 1350 })
  })

  it('실패 뒤 다시 확인하면 같은 사진을 다시 잰다', () => {
    vi.stubGlobal('Image', ImageStub)
    const { result, rerender } = renderHook(({ attempt }) => useMeasuredImage(asset, attempt), {
      initialProps: { attempt: 0 },
    })

    // 크기를 읽지 못한 로딩은 실패로 남는다(0 을 크기로 쓰지 않는다).
    act(() => last().onload?.())
    expect(result.current.status).toBe('failed')
    expect(result.current.asset).toMatchObject({ width: 0, height: 0 })

    // 세대 번호가 바뀌면 실패 기억을 버리고 다시 요청한다.
    rerender({ attempt: 1 })
    expect(result.current.status).toBe('measuring')
    expect(ImageStub.created).toHaveLength(2)

    act(() => {
      last().naturalWidth = 800
      last().naturalHeight = 800
      last().onload?.()
    })
    expect(result.current.status).toBe('measured')
  })

  it('이미 크기가 있는 사진은 다시 요청하지 않는다', () => {
    vi.stubGlobal('Image', ImageStub)
    const { result } = renderHook(() => useMeasuredImage({ ...asset, width: 800, height: 1000 }))

    expect(result.current.status).toBe('measured')
    expect(ImageStub.created).toHaveLength(0)
  })
})
