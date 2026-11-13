import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { JobResult } from '@/features/sohee-growth/types'
import { JobDetailSheet } from '../components/job-detail-sheet'

const mockJob: JobResult = {
  key: 'post_social',
  label: '인스타·스레드 게시',
  status: 'learning',
  note: '이미지 스타일 정하기',
  needed: [
    { key: 'shop_basic', label: '가게 기본 정보', done: true, destination: 'teach' },
    { key: 'voice', label: '말투 정하기', done: true, destination: 'work' },
    { key: 'caution', label: '조심할 표현', done: true, destination: 'work' },
    { key: 'image_style', label: '이미지 스타일 정하기', done: false, remaining: '1개 더', destination: 'teach' },
    { key: 'channel', label: '채널 연결', done: true, destination: 'tools' },
  ],
  missing: [
    { key: 'image_style', label: '이미지 스타일 정하기', done: false, remaining: '1개 더', destination: 'teach' },
  ],
}

describe('JobDetailSheet', () => {
  it('job이 null이면 시트 내용이 렌더되지 않는다', () => {
    const { container } = render(<JobDetailSheet job={null} onClose={vi.fn()} onGoToTab={vi.fn()} />)
    expect(screen.queryByRole('heading', { name: '인스타·스레드 게시' })).not.toBeInTheDocument()
  })

  it('업무명, 상태 칩, summary, approval 문구를 표시한다', () => {
    render(<JobDetailSheet job={mockJob} onClose={vi.fn()} onGoToTab={vi.fn()} />)
    expect(screen.getByRole('heading', { name: '인스타·스레드 게시' })).toBeInTheDocument()
    expect(screen.getByText('준비 중')).toBeInTheDocument()
    expect(screen.getByText('가게 소식과 상품을 인스타그램·스레드 글로 만들어 올려요')).toBeInTheDocument()
    expect(screen.getByText('올리기 전에 사장님이 확인해야 해요')).toBeInTheDocument()
  })

  it('필요한 요건 체크리스트에서 완료된 것은 체크, 미완료는 "가르치러 가기" 버튼을 제공한다', () => {
    const onGoToTab = vi.fn()
    const onClose = vi.fn()
    render(<JobDetailSheet job={mockJob} onClose={onClose} onGoToTab={onGoToTab} />)

    expect(screen.getByText('가게 기본 정보')).toBeInTheDocument()
    expect(screen.getByText('이미지 스타일 정하기')).toBeInTheDocument()

    const teachButton = screen.getByRole('button', { name: /가르치러 가기/ })
    expect(teachButton).toBeInTheDocument()

    fireEvent.click(teachButton)
    expect(onGoToTab).toHaveBeenCalledWith('teach')
    expect(onClose).toHaveBeenCalled()
  })

  it('membership 상태이면 "정식회원이 되면 열려요" 안내를 표시한다', () => {
    const membershipJob: JobResult = {
      ...mockJob,
      key: 'reply_comments',
      label: '댓글 답변',
      status: 'membership',
      note: '정식회원이 되면 열려요',
    }
    render(<JobDetailSheet job={membershipJob} onClose={vi.fn()} onGoToTab={vi.fn()} />)
    expect(screen.getByText('정식회원 전용')).toBeInTheDocument()
    expect(screen.getByText('정식회원이 되면 열려요')).toBeInTheDocument()
  })

  it('coming_soon 상태이면 "곧 열려요" 안내를 표시한다', () => {
    const comingSoonJob: JobResult = {
      key: 'kakao_1on1',
      label: '카카오톡 1:1 상담',
      status: 'coming_soon',
      note: '곧 열려요',
      needed: [],
      missing: [],
    }
    render(<JobDetailSheet job={comingSoonJob} onClose={vi.fn()} onGoToTab={vi.fn()} />)
    expect(screen.getAllByText('곧 열려요').length).toBeGreaterThan(0)
  })
})
