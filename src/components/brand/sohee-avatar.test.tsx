import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SoheeAvatar, SoheeBrandMark } from './sohee-avatar'

describe('Sohee brand imagery', () => {
  it('renders the approved character for conversation messages', () => {
    render(<SoheeAvatar variant="message" />)

    expect(screen.getByRole('img', { name: '소희' })).toHaveAttribute(
      'src',
      expect.stringContaining('sohee-character-v1.png'),
    )
  })

  it('renders the dedicated face-first logo instead of shrinking the full character scene', () => {
    render(<SoheeBrandMark size="small" />)

    expect(screen.getByRole('img', { name: '소희 로고' })).toHaveAttribute(
      'src',
      expect.stringContaining('sohee-logo-mark-v1.png'),
    )
    expect(screen.queryByText('S.')).not.toBeInTheDocument()
  })
})
