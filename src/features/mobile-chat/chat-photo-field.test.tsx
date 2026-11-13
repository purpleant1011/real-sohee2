import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { ChatPhotoField } from './chat-photo-field'

function photo(name = 'dress.jpg', type = 'image/jpeg', bytes = 1024): File {
  return new File([new Uint8Array(bytes)], name, { type })
}

function picker(): HTMLInputElement {
  return screen.getByLabelText('사진 붙이기') as HTMLInputElement
}

function choose(files: File[]) {
  fireEvent.change(picker(), { target: { files } })
}

describe('ChatPhotoField', () => {
  let createObjectURL: ReturnType<typeof vi.fn>
  let revokeObjectURL: ReturnType<typeof vi.fn>

  beforeEach(() => {
    createObjectURL = vi.fn((file: Blob) => `blob:${(file as File).name}`)
    revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: revokeObjectURL,
    })
  })

  afterEach(() => {
    delete (URL as unknown as Record<string, unknown>).createObjectURL
    delete (URL as unknown as Record<string, unknown>).revokeObjectURL
    vi.restoreAllMocks()
  })

  it('처음에는 사진이 없고 보내기가 연결되지 않았다고 적어 둔다', () => {
    render(<ChatPhotoField />)

    expect(screen.getByText('사진 0장 (최대 3장)')).toBeInTheDocument()
    expect(
      screen.getByText('사진은 이 기기에서만 미리 보여요. 보내는 기능은 아직 연결되지 않았어요.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '붙인 사진' })).not.toBeInTheDocument()
  })

  it('고른 사진을 미리보기로 보여 준다', () => {
    render(<ChatPhotoField />)

    choose([photo()])

    expect(screen.getByRole('img', { name: '붙인 사진: dress.jpg' })).toHaveAttribute(
      'src',
      'blob:dress.jpg',
    )
    expect(screen.getByText('사진 1장 (최대 3장)')).toBeInTheDocument()
  })

  it('미리보기 URL 을 만들지 못하면 사진을 그린 척하지 않고 이름만 보여 준다', () => {
    delete (URL as unknown as Record<string, unknown>).createObjectURL

    render(<ChatPhotoField />)
    choose([photo('coat.png', 'image/png')])

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('coat.png')).toBeInTheDocument()
  })

  it('빼기를 누르면 사진이 사라지고 미리보기 URL 을 해제한다', () => {
    render(<ChatPhotoField />)
    choose([photo()])

    fireEvent.click(screen.getByRole('button', { name: 'dress.jpg 빼기' }))

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('사진 0장 (최대 3장)')).toBeInTheDocument()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:dress.jpg')
  })

  it('화면을 닫으면 남은 미리보기 URL 을 해제한다', () => {
    const { unmount } = render(<ChatPhotoField />)
    choose([photo()])

    unmount()

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:dress.jpg')
  })

  it('알림 영역은 내용이 생기기 전부터 마운트되어 있다', () => {
    // 내용과 함께 새로 삽입한 라이브 영역은 스크린리더가 읽지 않을 수 있다.
    render(<ChatPhotoField />)

    expect(screen.getByRole('alert')).toBeEmptyDOMElement()
  })

  it('HEIC 사진은 거절 사유를 알림으로 보여 준다', () => {
    render(<ChatPhotoField />)

    choose([photo('IMG_2.heic', 'image/heic')])

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('IMG_2.heic')
    expect(alert).toHaveTextContent('아이폰 HEIC 사진은 아직 올릴 수 없어요.')
    expect(screen.getByText('사진 0장 (최대 3장)')).toBeInTheDocument()
  })

  it('상한을 넘으면 남은 사진은 붙이지 않고 선택기를 잠근다', () => {
    render(<ChatPhotoField />)

    choose([photo('a.jpg'), photo('b.jpg'), photo('c.jpg'), photo('d.jpg')])

    expect(screen.getAllByRole('img')).toHaveLength(3)
    expect(screen.getByRole('alert')).toHaveTextContent('사진은 최대 3장까지 붙일 수 있어요.')
    expect(picker()).toBeDisabled()
  })

  it('같은 사진을 두 번 고르면 중복이라고 알린다', () => {
    render(<ChatPhotoField />)

    choose([photo()])
    choose([photo()])

    expect(screen.getAllByRole('img')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent('이미 붙인 사진이에요.')
  })

  it('사진을 빼면 다시 고를 수 있다', () => {
    render(<ChatPhotoField />)
    choose([photo('a.jpg'), photo('b.jpg'), photo('c.jpg')])
    expect(picker()).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'b.jpg 빼기' }))

    expect(picker()).not.toBeDisabled()
  })

  it('붙인 사진 목록을 호출부에 넘긴다', () => {
    const onChange = vi.fn()
    render(<ChatPhotoField onChange={onChange} />)

    choose([photo()])

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toEqual([
      { id: expect.any(String), name: 'dress.jpg', size: 1024, previewUrl: 'blob:dress.jpg' },
    ])
  })

  it('disabled 면 사진을 고를 수 없다', () => {
    render(<ChatPhotoField disabled />)

    expect(picker()).toBeDisabled()
  })

  it('빼기 버튼은 어떤 사진인지 이름으로 알려 준다', () => {
    render(<ChatPhotoField />)
    choose([photo('outer.jpg')])

    expect(screen.getByRole('button', { name: 'outer.jpg 빼기' })).toBeInTheDocument()
  })
})
