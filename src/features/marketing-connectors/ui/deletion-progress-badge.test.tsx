// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { DeletionProgressBadge } from './deletion-progress-badge'

describe('DeletionProgressBadge', () => {
  it('pending 상태일 때 "삭제 대기 중" 배지와 기본 안내 문구를 렌더링한다', () => {
    render(
      <DeletionProgressBadge
        status="pending"
        requestedAt="2026-11-11T09:00:00Z"
      />
    )

    expect(screen.getByText('삭제 대기 중')).toBeInTheDocument()
    expect(
      screen.getByText(/공급자 계정 자체는 삭제되지 않으며, 소희에 저장된 연동 토큰과 임시 근거 데이터만 안전하게 영구 파기됩니다\./)
    ).toBeInTheDocument()
  })

  it('running 상태일 때 "데이터 파기 진행 중" 배지를 렌더링한다', () => {
    render(
      <DeletionProgressBadge
        status="running"
        requestedAt="2026-11-11T09:00:00Z"
      />
    )

    expect(screen.getByText('데이터 파기 진행 중')).toBeInTheDocument()
  })

  it('completed 상태일 때 "완전 삭제됨" 배지를 렌더링한다', () => {
    render(
      <DeletionProgressBadge
        status="completed"
        requestedAt="2026-11-11T09:00:00Z"
      />
    )

    expect(screen.getByText('완전 삭제됨')).toBeInTheDocument()
  })

  it('failed 상태일 때 "삭제 재시도 중" 배지와 에러 메시지를 렌더링한다', () => {
    render(
      <DeletionProgressBadge
        status="failed"
        requestedAt="2026-11-11T09:00:00Z"
        error="연동 토큰 만료로 인한 비동기 파기 지연"
      />
    )

    expect(screen.getByText('삭제 재시도 중')).toBeInTheDocument()
    expect(screen.getByText(/연동 토큰 만료로 인한 비동기 파기 지연/)).toBeInTheDocument()
  })
})
