import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { PcActivityList } from '../pc-activity-list'
import type { MobileActivity, Remote } from '@/features/mobile-decision/contracts'

const ready = <T,>(data: T): Remote<T> => ({
  state: 'ready',
  data,
  observedAt: '2026-11-07T00:00:00Z',
  validUntil: null,
})

describe('PcActivityList (PC 3열 관제 화면 — 소희가 한 일)', () => {
  it('기록이 없으면 빈 상태를 표시한다', () => {
    const activity: Remote<MobileActivity[]> = ready([])

    render(<PcActivityList activity={activity} />)
    expect(screen.getByText('소희가 한 일')).toBeInTheDocument()
    expect(screen.getByText('아직 최근 작업 기록이 없어요')).toBeInTheDocument()
  })

  it('최근 5건의 활동을 제목과 상태 StatusPill로 렌더링한다', () => {
    const activity: Remote<MobileActivity[]> = ready([
      { id: 'act-1', title: '인스타그램 가을 게시물 발행', statusLabel: '게시 완료', observedAt: '2026-11-07T01:00:00Z', evidenceRef: null },
      { id: 'act-2', title: '고객 댓글 답글 초안 작성', statusLabel: '승인 대기', observedAt: '2026-11-07T02:00:00Z', evidenceRef: null },
      { id: 'act-3', title: '스레드 소식 게시', statusLabel: '게시됨', observedAt: '2026-11-07T03:00:00Z', evidenceRef: null },
      { id: 'act-4', title: '매장 정보 지식 보강', statusLabel: '완료', observedAt: '2026-11-07T04:00:00Z', evidenceRef: null },
      { id: 'act-5', title: '주말 예약 슬롯 확인', statusLabel: '확인됨', observedAt: '2026-11-07T05:00:00Z', evidenceRef: null },
      { id: 'act-6', title: '6번째 활동 (초과)', statusLabel: '완료', observedAt: '2026-11-07T06:00:00Z', evidenceRef: null },
    ])

    render(<PcActivityList activity={activity} />)

    expect(screen.getByText('인스타그램 가을 게시물 발행')).toBeInTheDocument()
    expect(screen.getByText('게시 완료')).toBeInTheDocument()
    expect(screen.getByText('고객 댓글 답글 초안 작성')).toBeInTheDocument()
    expect(screen.getByText('승인 대기')).toBeInTheDocument()

    // 6번째 항목은 표시되지 않음 (최대 5건)
    expect(screen.queryByText('6번째 활동 (초과)')).toBeNull()

    const links = within(screen.getByRole('list')).getAllByRole('link')
    expect(links.length).toBe(5)
  })
})
