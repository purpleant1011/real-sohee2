import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { ConversationTaskTimeline } from './conversation-task-timeline'

const live = { title: '소희의 작업 계획', isLive: true, steps: [
  { id: 'a', title: '가게 정보 확인', status: 'completed' as const },
  { id: 'b', title: '글 초안 만들기', status: 'in_progress' as const },
  { id: 'c', title: '이미지 고르기', status: 'pending' as const },
] }

describe('ConversationTaskTimeline 모바일 진행 화면', () => {
  it('모바일에서 진행 중이면 "소희가 일하고 있어요" 진행 목록으로 보인다', () => {
    render(<MobileR2Provider enabled forceMobile><ConversationTaskTimeline timeline={live as never} /></MobileR2Provider>)
    expect(screen.getByText('소희가 일하고 있어요')).toBeInTheDocument()
    expect(screen.getByText('1/3 완료')).toBeInTheDocument()
    expect(screen.getByText('글 초안 만들기')).toBeInTheDocument()
  })
  it('PC는 기존 타임라인 그대로다', () => {
    render(<ConversationTaskTimeline timeline={live as never} />)
    expect(screen.queryByText('소희가 일하고 있어요')).toBeNull()
    expect(screen.getByLabelText('소희의 작업 진행 계획')).toBeInTheDocument()
  })
})
