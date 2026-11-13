import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RuntimeStateBadge } from '../runtime-state-badge'

describe('RuntimeStateBadge', () => {
  it('기본 상태에서는 freshness가 STALE이어도 불안한 (지연됨) 라벨을 숨긴다', () => {
    render(<RuntimeStateBadge state="RUNNING" freshness="STALE" />)
    expect(screen.getByText('자율근무 중')).toBeInTheDocument()
    expect(screen.queryByText('(지연됨)')).not.toBeInTheDocument()
  })

  it('showFreshnessTag가 true일 때만 STALE 상태에서 (지연됨) 라벨을 명시적으로 표시한다', () => {
    render(<RuntimeStateBadge state="RUNNING" freshness="STALE" showFreshnessTag={true} />)
    expect(screen.getByText('자율근무 중')).toBeInTheDocument()
    expect(screen.getByText('(지연됨)')).toBeInTheDocument()
  })

  it('각 상태별 라벨을 올바르게 렌더링한다', () => {
    const { rerender } = render(<RuntimeStateBadge state="PAUSED" />)
    expect(screen.getByText('일시 정지')).toBeInTheDocument()

    rerender(<RuntimeStateBadge state="IDLE" />)
    expect(screen.getByText('업무 대기')).toBeInTheDocument()

    rerender(<RuntimeStateBadge state="BLOCKED" />)
    expect(screen.getByText('안전 차단')).toBeInTheDocument()
  })
})
