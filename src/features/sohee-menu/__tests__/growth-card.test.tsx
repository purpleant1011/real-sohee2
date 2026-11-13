import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildGrowthSnapshot } from '@/features/sohee-growth/snapshot'
import { EMPTY, FULL, PARTIAL } from '@/features/sohee-growth/__tests__/fixtures'
import { GrowthCard } from '../components/growth-card'
import { LevelLadder } from '../components/level-ladder'

vi.mock('next/image', () => ({ default: (props: any) => <img alt={props.alt} src={props.src} /> }))

describe('LevelLadder', () => {
  it('5단계를 순서대로 보여주고 현재 단계를 표시한다', () => {
    const snap = buildGrowthSnapshot({ ...PARTIAL, tier: 'FORMAL' })
    render(<LevelLadder ladder={snap.level.ladder} />)
    const items = screen.getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual(['신입', '사원', '주임', '대리', '상담원(준비 중)'])
    expect(items[0]).toHaveAttribute('aria-current', 'step')
  })
})

describe('GrowthCard', () => {
  it('이해도·레벨·가르친 개수·회원 상태를 보여준다', () => {
    const snap = buildGrowthSnapshot(PARTIAL)
    render(<GrowthCard snapshot={snap} onGoToTab={vi.fn()} />)
    expect(screen.getByText('소희가 우리 가게를 42% 이해했어요')).toBeInTheDocument()
    expect(screen.getByText('Lv.1 신입')).toBeInTheDocument()
    expect(screen.getByText(/가르친 지식 3개/)).toBeInTheDocument()
    expect(screen.getByText(/자료 0개/)).toBeInTheDocument()
    expect(screen.getByText('정식회원')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '소희의 이해도' })).toHaveAttribute('aria-valuenow', '42')
  })

  it('체험회원·승인 대기는 구분해서 보여준다', () => {
    const { rerender } = render(<GrowthCard snapshot={buildGrowthSnapshot({ ...EMPTY, tier: 'TRIAL' })} onGoToTab={vi.fn()} />)
    expect(screen.getByText('체험회원')).toBeInTheDocument()
    rerender(<GrowthCard snapshot={buildGrowthSnapshot({ ...EMPTY, tier: 'PENDING_REVIEW' })} onGoToTab={vi.fn()} />)
    expect(screen.getByText('승인 대기 · 체험회원')).toBeInTheDocument()
    rerender(<GrowthCard snapshot={buildGrowthSnapshot({ ...EMPTY, tier: 'REJECTED' })} onGoToTab={vi.fn()} />)
    expect(screen.getByText('인증 다시 신청 필요')).toBeInTheDocument()
  })

  it('다음에 가르칠 것을 보여주고 버튼으로 해당 탭에 보낸다', () => {
    const onGoToTab = vi.fn()
    render(<GrowthCard snapshot={buildGrowthSnapshot(PARTIAL)} onGoToTab={onGoToTab} />)
    expect(screen.getByText('다음으로 가르칠 것')).toBeInTheDocument()
    expect(screen.getByText('이미지 스타일 정하기')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '가르치러 가기' }))
    expect(onGoToTab).toHaveBeenCalledWith('work')
  })

  it('기본 교육을 모두 마치면 완료 안내를 보여준다', () => {
    render(<GrowthCard snapshot={buildGrowthSnapshot(FULL)} onGoToTab={vi.fn()} />)
    expect(screen.getByText('기본 교육을 모두 마쳤어요')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '가르치러 가기' })).not.toBeInTheDocument()
  })

  it('상태 줄(children)을 카드 안에 보여준다', () => {
    render(
      <GrowthCard snapshot={buildGrowthSnapshot(EMPTY)} onGoToTab={vi.fn()}>
        <p>소희의 업무가 잠시 멈췄어요.</p>
      </GrowthCard>,
    )
    expect(screen.getByText('소희의 업무가 잠시 멈췄어요.')).toBeInTheDocument()
  })
})
