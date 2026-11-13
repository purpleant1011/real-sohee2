import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./actions/profile-image-actions', () => ({
  initialProfileImageActionState: { status: 'idle', message: '' },
  saveProfileImageAction: vi.fn(),
  deleteProfileImageAction: vi.fn(),
}))

import { ProfileImageCard } from './profile-image-card'

describe('ProfileImageCard', () => {
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:profile-preview'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(() => undefined),
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it('shows the current private profile photo and replacement controls', () => {
    render(<ProfileImageCard avatarUrl="https://signed.example/avatar.png" />)

    expect(screen.getByRole('img', { name: '내 프로필 사진' })).toHaveAttribute(
      'src',
      'https://signed.example/avatar.png',
    )
    expect(screen.getByLabelText('프로필 사진 선택')).toHaveAttribute(
      'accept',
      'image/jpeg,image/png,image/webp',
    )
    expect(screen.getByText('JPEG, PNG 또는 WebP · 최대 5MB')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '사진 저장' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '사진 삭제' })).toBeInTheDocument()
  })

  it('previews a newly selected image before upload', () => {
    render(<ProfileImageCard avatarUrl={null} />)
    const file = new File(['preview'], 'preview.webp', { type: 'image/webp' })

    fireEvent.change(screen.getByLabelText('프로필 사진 선택'), { target: { files: [file] } })

    expect(screen.getByRole('img', { name: '선택한 프로필 사진 미리보기' })).toHaveAttribute(
      'src',
      'blob:profile-preview',
    )
    expect(URL.createObjectURL).toHaveBeenCalledWith(file)
  })

  it('uses a fallback and hides deletion when no photo exists', () => {
    render(<ProfileImageCard avatarUrl={null} />)

    expect(screen.queryByRole('img', { name: '내 프로필 사진' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('기본 프로필 아이콘')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '사진 삭제' })).not.toBeInTheDocument()
  })
})
