import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SoheeChannelWizard } from '../sohee-channel-wizard'

describe('SoheeChannelWizard Policy Copy Audit', () => {
  it('does not claim Instagram story auto publishing or Naver blog auto posting', () => {
    render(<SoheeChannelWizard workspaceId="ws-test" />)

    // Step 1: Agree terms and proceed
    const check1 = screen.getByLabelText(/소희 서비스 이용약관/i)
    const check2 = screen.getByLabelText(/콘텐츠 생성 및 게시 권한 위임/i)
    fireEvent.click(check1)
    fireEvent.click(check2)
    fireEvent.click(screen.getByRole('button', { name: /다음: 채널 연결하기/i }))

    // Step 2: Check channel descriptions
    expect(screen.queryByText(/스토리 자동 게시/)).not.toBeInTheDocument()
    expect(screen.queryByText(/블로그 포스팅 자율 대행/)).not.toBeInTheDocument()
    expect(screen.getByText(/비즈니스 계정 피드 및 릴스 게시/)).toBeInTheDocument()
    expect(screen.getByText(/블로그 원고·사진 준비/)).toBeInTheDocument()
  })

  it('in Step 3, offers draft preparation for comments and DMs instead of unapproved auto replies', async () => {
    render(<SoheeChannelWizard workspaceId="ws-test" />)

    const check1 = screen.getByLabelText(/소희 서비스 이용약관/i)
    const check2 = screen.getByLabelText(/콘텐츠 생성 및 게시 권한 위임/i)
    fireEvent.click(check1)
    fireEvent.click(check2)
    fireEvent.click(screen.getByRole('button', { name: /다음: 채널 연결하기/i }))

    // Fast-forward step 2
    fireEvent.click(screen.getByRole('button', { name: /Meta 공식 로그인 연동/i }))

    // Step 3
    expect(await screen.findByText(/소희의 실행 권한/i)).toBeInTheDocument()
    expect(screen.queryByText(/스토리\(Story\) 일상 마케팅 발행/)).not.toBeInTheDocument()
    expect(screen.queryByText(/댓글 및 DM 자동 응답/)).not.toBeInTheDocument()
    expect(screen.getByText(/댓글 및 DM 답변 초안 준비/)).toBeInTheDocument()
  })
})
