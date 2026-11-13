import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FirstWowFlow } from '../first-wow-flow'
import { ChannelAuthModal } from '../components/channel-auth-modal'

describe('First Wow 5-Step Conversational Onboarding Flow', () => {
  it('renders Free Taste 50 Energy banner and conversational greeting', () => {
    render(<FirstWowFlow initialStep={1} />)

    // 소희 대화형 배너 및 무료체험 확인
    expect(screen.getByText(/소희와의 첫 대면: 매장 전담 AI 사원 셋업/i)).toBeInTheDocument()
    expect(screen.getByText(/사업자 전용 무료 맛보기 \(Free Taste 50 Energy 지원\)/i)).toBeInTheDocument()

    // 5단계 스텝 레일 확인
    expect(screen.getByText('Step 1. 사원 인사기록부 셋업')).toBeInTheDocument()
    expect(screen.getByText('사장님의 매장 기본 정보를 알려주세요')).toBeInTheDocument()
  })

  it('navigates through all 5 steps smoothly', async () => {
    render(<FirstWowFlow initialStep={1} />)

    // Fill Step 1 required fields
    fireEvent.change(screen.getByPlaceholderText(/우리 매장/i), { target: { value: '소희 뷰티살롱' } })
    fireEvent.change(screen.getByPlaceholderText(/이지은 원장/i), { target: { value: '소희' } })
    fireEvent.change(screen.getByPlaceholderText(/010-8765-4321/i), { target: { value: '010-1234-5678' } })

    // Step 1 -> Step 2
    fireEvent.click(screen.getByRole('button', { name: /다음: 비법 스타일 학습/i }))
    expect(await screen.findByText(/Step 2. 매장 맞춤 비법 교육 \(소희 업무 기준 셋업\)/i)).toBeInTheDocument()

    // Fill Step 2 required fields
    fireEvent.change(screen.getByPlaceholderText(/1:1 맞춤 프라이빗 케어/i), { target: { value: '퍼스널 두피케어' } })

    // Step 2 -> Step 3
    fireEvent.click(screen.getByRole('button', { name: /다음: 4대 채널 계정 연결/i }))
    expect(await screen.findByText(/Step 3. 4대 마케팅 채널 URL 및 계정 등록/i)).toBeInTheDocument()

    // Step 3 -> Step 4
    fireEvent.click(screen.getByRole('button', { name: /다음: 자율 운영 규정/i }))
    expect(await screen.findByText(/Step 4. 소희 사원의 업무 승인 및 자율성 범위/i)).toBeInTheDocument()
    expect(screen.queryByText(/R0 무검수/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/1초 만에 자동 게시/i)).not.toBeInTheDocument()

    // Step 4 -> Step 5
    fireEvent.click(screen.getByRole('button', { name: /다음: 첫 AI 실발행 체험하기/i }))
    expect(await screen.findByText(/Step 5. 소희 AI 첫 실전 마케팅 가동 & 실발행 체험/i)).toBeInTheDocument()
  })

  it('executes First Wow live publish to verified state', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        executionState: 'VERIFIED',
        receipt: {
          actionRequestId: 'req-test-1',
          externalUrl: 'https://instagram.com/p/test',
          status: 'VERIFIED',
        },
      }),
    }) as any

    const onCompleteMock = vi.fn()
    render(<FirstWowFlow initialStep={5} onComplete={onCompleteMock} />)

    // 소희에게 첫 마케팅 업무 맡기기 클릭
    fireEvent.click(screen.getByRole('button', { name: /소희에게 첫 마케팅 업무 맡기기/i }))

    // 시안 생성 후 미리보기 대기
    await waitFor(
      () => {
        expect(screen.getByText(/인스타그램 & 스레드 동시 기획안/i)).toBeInTheDocument()
      },
      { timeout: 3000 }
    )

    // 첫 마케팅 시안 승인 및 저장 클릭
    fireEvent.click(screen.getByRole('button', { name: /첫 마케팅 시안 승인 및 저장/i }))

    // 실증빙 확인 완료 대기
    await waitFor(
      () => {
        expect(screen.getByText(/공식 인스타그램 실발행이 확인되었습니다/i)).toBeInTheDocument()
      },
      { timeout: 4000 }
    )

    // onComplete 콜백 호출 확인
    expect(onCompleteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        missionId: 'mission-first-wow-01',
        usedCredits: 350,
      })
    )
  })

  it('handles server failure with fail-closed OFFLINE_UNSAVED state', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as any

    render(<FirstWowFlow initialStep={5} />)
    fireEvent.click(screen.getByRole('button', { name: /소희에게 첫 마케팅 업무 맡기기/i }))

    await waitFor(() => {
      expect(screen.getByText(/인스타그램 & 스레드 동시 기획안/i)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /첫 마케팅 시안 승인 및 저장/i }))

    await waitFor(() => {
      expect(screen.getByText(/저장되지 않았습니다/i)).toBeInTheDocument()
    })
  })

  it('handles QUEUED execution state when external publish is queued (ANI-750)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        executionState: 'QUEUED',
        receipt: {
          actionRequestId: 'req-queued-1',
          status: 'QUEUED',
        },
        message: '소희 첫 맞춤 시안 승인 완료 · 실제 발행 대기 큐 등록 (QUEUED)',
      }),
    }) as any

    const onCompleteMock = vi.fn()
    render(<FirstWowFlow initialStep={5} onComplete={onCompleteMock} />)

    fireEvent.click(screen.getByRole('button', { name: /소희에게 첫 마케팅 업무 맡기기/i }))

    await waitFor(() => {
      expect(screen.getByText(/인스타그램 & 스레드 동시 기획안/i)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /첫 마케팅 시안 승인 및 저장/i }))

    await waitFor(() => {
      expect(screen.getByText(/첫 마케팅 시안 승인 완료 · 사령부 보관/i)).toBeInTheDocument()
    })

    expect(onCompleteMock).toHaveBeenCalled()
  })

  it('renders generic store and channel placeholders without specific business account branding', () => {
    const { unmount } = render(<FirstWowFlow initialStep={1} />)

    // Step 1: placeholder and example modal must use generic names
    expect(screen.getByPlaceholderText('예: 우리 매장')).toBeInTheDocument()

    // Example guide toggle
    fireEvent.click(screen.getByText('💡 01단계 작성 예시 보기'))
    expect(screen.getByText(/우리 매장/i)).toBeInTheDocument()
    expect(screen.queryByText(/바이름/i)).not.toBeInTheDocument()
    unmount()

    // Step 3: generic channel placeholders & guide
    render(<FirstWowFlow initialStep={3} />)
    expect(screen.getByPlaceholderText('예: https://instagram.com/my_store_official 또는 @my_store_official')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('예: https://threads.net/@my_store_official 또는 @my_store_official')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('예: https://blog.naver.com/my_store 또는 네이버 아이디')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('예: https://town.daangn.com/bp/12345 또는 매장 상호명')).toBeInTheDocument()
    expect(screen.queryByText(/byreum/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/바이름/i)).not.toBeInTheDocument()
  })

  it('renders generic channel placeholders in ChannelAuthModal', () => {
    const { rerender } = render(
      <ChannelAuthModal
        isOpen={true}
        channelType="instagram"
        channelName="인스타그램"
        onClose={() => {}}
        onSave={() => {}}
      />
    )
    expect(screen.getByPlaceholderText('예: https://instagram.com/my_store_official 또는 @my_store_official')).toBeInTheDocument()
    expect(screen.queryByText(/byreum/i)).not.toBeInTheDocument()

    rerender(
      <ChannelAuthModal
        isOpen={true}
        channelType="threads"
        channelName="스레드"
        onClose={() => {}}
        onSave={() => {}}
      />
    )
    expect(screen.getByPlaceholderText('예: https://threads.net/@my_store_official 또는 @my_store_official')).toBeInTheDocument()
    expect(screen.queryByText(/byreum/i)).not.toBeInTheDocument()

    rerender(
      <ChannelAuthModal
        isOpen={true}
        channelType="naver"
        channelName="네이버 블로그"
        onClose={() => {}}
        onSave={() => {}}
      />
    )
    expect(screen.getByPlaceholderText('예: https://blog.naver.com/my_store 또는 네이버 아이디')).toBeInTheDocument()
    expect(screen.queryByText(/byreum/i)).not.toBeInTheDocument()
  })
})
