import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PcDecisionList } from '../pc-decision-list'
import type { DecisionPage, Remote } from '@/features/mobile-decision/contracts'

const ready = <T,>(data: T): Remote<T> => ({
  state: 'ready',
  data,
  observedAt: '2026-11-07T00:00:00Z',
  validUntil: null,
})

describe('PcDecisionList (PC 3열 관제 화면 — 지금 확인할 일)', () => {
  it('확인할 일이 없으면 친절한 빈 상태 안내를 표시한다', () => {
    const decisions: Remote<DecisionPage> = ready({
      items: [],
      total: 0,
      complete: true,
    })

    render(<PcDecisionList decisions={decisions} />)
    expect(screen.getByText('지금 확인할 일')).toBeInTheDocument()
    expect(screen.getByText('지금 바로 확인할 일이 없어요')).toBeInTheDocument()
  })

  it('최대 5건의 결정 사항을 종류별로 묶어 제목 1줄과 보조 1줄로 표시하며 링크를 제공한다', () => {
    const decisions: Remote<DecisionPage> = ready({
      items: [
        {
          id: 'dec-1',
          kind: 'comment_reply',
          title: '댓글 답변 승인 1',
          targetLabel: 'instagram',
          createdAt: '2026-11-07T01:00:00Z',
          expiresAt: null,
        },
        {
          id: 'dec-2',
          kind: 'comment_reply',
          title: '댓글 답변 승인 2',
          targetLabel: 'instagram',
          createdAt: '2026-11-07T01:30:00Z',
          expiresAt: null,
        },
        {
          id: 'dec-3',
          kind: 'dm_reply',
          title: '예약 문의 답변',
          targetLabel: 'instagram',
          createdAt: '2026-11-07T02:00:00Z',
          expiresAt: null,
        },
        {
          id: 'dec-4',
          kind: 'post_publish',
          title: '가을 신메뉴 소개',
          targetLabel: 'threads',
          createdAt: '2026-11-07T02:30:00Z',
          expiresAt: null,
        },
        {
          id: 'dec-5',
          kind: 'proposal',
          title: '주말 프로모션 제안',
          targetLabel: 'sohee',
          createdAt: '2026-11-07T03:00:00Z',
          expiresAt: null,
        },
        {
          id: 'dec-6',
          kind: 'proposal',
          title: '6번째 제안 (초과)',
          targetLabel: 'sohee',
          createdAt: '2026-11-07T03:30:00Z',
          expiresAt: null,
        },
      ],
      total: 6,
      complete: true,
    })

    render(<PcDecisionList decisions={decisions} />)

    // 댓글은 2건이므로 "고객 댓글 2건"으로 묶임
    expect(screen.getByText('고객 댓글 2건')).toBeInTheDocument()
    // 단일 건은 원래 제목
    expect(screen.getByText('예약 문의 답변')).toBeInTheDocument()
    expect(screen.getByText('가을 신메뉴 소개')).toBeInTheDocument()

    // 최대 5건 제한
    const links = screen.getAllByRole('link')
    expect(links.length).toBeLessThanOrEqual(5)
    expect(links.length).toBeGreaterThan(0)
  })

  it('로딩 중일 때 로딩 안내를 표시한다', () => {
    const decisions: Remote<DecisionPage> = {
      state: 'loading',
      data: null,
      observedAt: null,
      validUntil: null,
    }

    render(<PcDecisionList decisions={decisions} />)
    expect(screen.getByText('확인할 일을 불러오고 있어요')).toBeInTheDocument()
  })
})
