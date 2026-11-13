import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ServiceUnavailablePage from './page'

describe('ServiceUnavailablePage', () => {
  it('내부 설정이나 스택을 노출하지 않고 재시도 경로를 제공한다', () => {
    render(<ServiceUnavailablePage />)

    expect(screen.getByRole('heading', { name: '소희 연결을 잠시 준비하고 있어요' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '다시 연결하기' })).toHaveAttribute('href', '/app')
    expect(document.body.textContent).not.toContain('NEXT_PUBLIC_SUPABASE_URL')
    expect(document.body.textContent).not.toContain('ZodError')
  })
})
