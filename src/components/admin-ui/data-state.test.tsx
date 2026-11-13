import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MfaRequiredNotice } from './data-state'

describe('MfaRequiredNotice', () => {
  it('explains the additional authentication requirement with an accessible setup link', () => {
    render(<MfaRequiredNotice />)
    expect(screen.getByRole('alert')).toHaveTextContent('이 화면은 추가 인증(2단계)을 마친 뒤에 볼 수 있어요. 인증을 완료한 뒤 다시 열어 주세요.')
    const link = screen.getByRole('link', { name: '추가 인증하러 가기' })
    expect(link).toHaveAttribute('href', '/auth/admin-setup')
    expect(link.className).toContain('min-h-11')
    expect(screen.getByRole('alert')).not.toHaveTextContent(/\b0\b/u)
  })
})
