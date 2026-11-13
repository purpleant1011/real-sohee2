import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ImageProfileSettings } from './image-profile-settings'

describe('ImageProfileSettings', () => {
  it('renders brand visual preferences and handles selection', () => {
    render(<ImageProfileSettings />)

    expect(screen.getByText(/우리 매장 이미지 스타일/i)).toBeInTheDocument()
    expect(screen.getByText(/실제 매장 촬영 느낌/i)).toBeInTheDocument()
    expect(screen.getByText(/손님 얼굴은 가급적 노출하지 않기/i)).toBeInTheDocument()
    expect(screen.getByText(/꼭 유지할 것/i)).toBeInTheDocument()
    expect(screen.getByText(/절대 만들지 말 것/i)).toBeInTheDocument()

    const saveBtn = screen.getByRole('button', { name: /우리 매장 스타일 저장하기/i })
    fireEvent.click(saveBtn)

    expect(screen.getByText(/저장되었습니다/i)).toBeInTheDocument()
  })
})
