import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UserAvatar } from './user-avatar'
import { UserProfileProvider } from './user-profile-context'

describe('UserAvatar', () => {
  it('renders the one server-resolved private photo shared by the app', () => {
    render(
      <UserProfileProvider avatarUrl="https://signed.example/avatar.png">
        <UserAvatar size="message" />
      </UserProfileProvider>,
    )

    expect(screen.getByRole('img', { name: '내 프로필 사진' })).toHaveAttribute(
      'src',
      'https://signed.example/avatar.png',
    )
  })

  it('renders the stable fallback when no signed URL is available', () => {
    render(
      <UserProfileProvider avatarUrl={null}>
        <UserAvatar size="menu" />
      </UserProfileProvider>,
    )

    expect(screen.getByLabelText('기본 프로필 아이콘')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: '내 프로필 사진' })).not.toBeInTheDocument()
  })
})
