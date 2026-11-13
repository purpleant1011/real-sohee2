import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { OAuthExplainabilityModal } from '@/features/channels/components/oauth-explainability-modal'

describe('ANI-1428: OAuthExplainabilityModal UI Verification', () => {
  it('renders and opens the OAuthExplainabilityModal with human-language permission reasons and zero-password invariant', () => {
    const handleClose = vi.fn()
    render(
      <OAuthExplainabilityModal
        isOpen={true}
        channel="instagram"
        normalizedResult={{
          isValid: true,
          channel: 'instagram',
          handle: 'sohee.ai',
          displayHandle: '@sohee.ai',
          canonicalUrl: 'https://www.instagram.com/sohee.ai/',
        }}
        connectUri="/api/channels/instagram/connect"
        onClose={handleClose}
      />
    )

    // Title and Dialog
    expect(screen.getByText('인스타그램 비즈니스 연동 안내')).toBeDefined()
    expect(screen.getByText('@sohee.ai')).toBeDefined()

    // Permissions explained in plain Korean
    expect(screen.getByText('피드 및 릴스 콘텐츠 자동 게시')).toBeDefined()
    expect(screen.getByText('비즈니스 계정 프로필 식별')).toBeDefined()
    expect(screen.getByText('게시물 도달 및 반응률 분석')).toBeDefined()

    // Zero-Password Invariant Guarantee
    expect(screen.getByText(/소희의 엄격한 보안 및 권한 원칙 \(Zero-Password\)/i)).toBeDefined()
    expect(screen.getByText(/계정 비밀번호를 절대 요구하거나 소희 서버에 저장하지 않습니다/i)).toBeDefined()

    // Close button
    const closeBtn = screen.getByRole('button', { name: '닫기' })
    fireEvent.click(closeBtn)
    expect(handleClose).toHaveBeenCalledTimes(1)
  })
})
