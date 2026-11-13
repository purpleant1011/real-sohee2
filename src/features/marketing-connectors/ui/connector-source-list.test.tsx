// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { ConnectorSourceList } from './connector-source-list'

describe('ConnectorSourceList', () => {
  it('sources 목록이 비어있을 때 빈 상태(Empty state) 메시지를 표시한다', () => {
    render(
      <ConnectorSourceList
        connectorId="google_calendar"
        sources={[]}
      />
    )

    expect(screen.getByText(/연결된 소스가 없습니다|등록된 소스가 없습니다/i)).toBeInTheDocument()
  })

  it('각 source의 이름, 마지막 동기화 시각, 근거 건수 뱃지를 정상 표시한다', () => {
    const sources = [
      {
        id: 'cal-1',
        name: '영업점 예약 캘린더',
        lastSyncAt: '2026-11-10T10:00:00Z',
        evidenceCount: 15,
      },
      {
        id: 'cal-2',
        name: '프로모션 일정',
        lastSyncAt: '2026-11-11T08:30:00Z',
        evidenceCount: 3,
      },
      {
        id: 'cal-3',
        name: '미동기화 소스',
        evidenceCount: 0,
      },
    ]

    render(
      <ConnectorSourceList
        connectorId="google_calendar"
        sources={sources}
      />
    )

    expect(screen.getByText('영업점 예약 캘린더')).toBeInTheDocument()
    expect(screen.getByText('프로모션 일정')).toBeInTheDocument()
    expect(screen.getByText('미동기화 소스')).toBeInTheDocument()

    // 근거 건수 뱃지
    expect(screen.getByText(/15건/)).toBeInTheDocument()
    expect(screen.getByText(/3건/)).toBeInTheDocument()
    expect(screen.getByText(/0건/)).toBeInTheDocument()
  })

  it('새로고침 버튼 클릭 시 onRefresh 콜백에 해당 sourceId가 전달된다', () => {
    const onRefresh = vi.fn()
    const sources = [
      {
        id: 'src-100',
        name: '매장 공지 시트',
        lastSyncAt: '2026-11-10T12:00:00Z',
        evidenceCount: 42,
      },
    ]

    render(
      <ConnectorSourceList
        connectorId="google_sheets"
        sources={sources}
        onRefresh={onRefresh}
      />
    )

    const refreshButton = screen.getByRole('button', { name: /새로고침|동기화|갱신/i })
    expect(refreshButton).toBeInTheDocument()

    fireEvent.click(refreshButton)
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(onRefresh).toHaveBeenCalledWith('src-100')
  })

  it('연동 해제/제거 버튼 클릭 시 onRemove 콜백에 해당 sourceId가 전달된다', () => {
    const onRemove = vi.fn()
    const sources = [
      {
        id: 'src-100',
        name: '매장 공지 시트',
      },
    ]

    render(
      <ConnectorSourceList
        connectorId="google_sheets"
        sources={sources}
        onRemove={onRemove}
      />
    )

    const removeButton = screen.getByRole('button', { name: /해제|삭제|제거/i })
    expect(removeButton).toBeInTheDocument()

    fireEvent.click(removeButton)
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onRemove).toHaveBeenCalledWith('src-100')
  })
})
