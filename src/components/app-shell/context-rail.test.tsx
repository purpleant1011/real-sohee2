import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ContextRail } from './context-rail'

describe('ContextRail', () => {
  it('labels unconnected operational context honestly and links to existing protected routes', () => {
    render(<ContextRail description="계획과 승인 단계를 확인해요" title="현재 대화 문맥" />)

    expect(screen.getByRole('complementary', { name: '업무 문맥' })).toBeInTheDocument()
    expect(screen.getByText('현재 대화 문맥')).toBeInTheDocument()
    expect(screen.getByText('계획과 승인 단계를 확인해요')).toBeInTheDocument()
    expect(screen.getByText('데이터 연결 준비 중')).toBeInTheDocument()
    expect(screen.getByText('외부 데이터 미연결')).toBeInTheDocument()
    expect(screen.queryByText('사용량 확인 필요')).not.toBeInTheDocument()
    expect(screen.queryByText(/크레딧/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: '관련 화면 보기' })).toHaveLength(4)
  })

  it('keeps all context actions in a compact top menu without a fixed complementary rail', () => {
    render(<ContextRail description="계획과 승인 단계를 확인해요" title="현재 대화 문맥" variant="menu" />)

    expect(screen.getByText('업무 문맥')).toBeInTheDocument()
    expect(screen.getByText('현재 대화 문맥')).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: '업무 문맥' })).not.toBeInTheDocument()
    expect(screen.queryByText(/크레딧/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: '관련 화면 보기' })).toHaveLength(4)
  })
})
