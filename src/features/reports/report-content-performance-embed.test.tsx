import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ReportContentPerformance } from './report-content-performance'
import { ReportInsightDetail } from './report-insight-detail'
import type { ContentPerformanceRow, ReportInsight } from './types'

describe('Report Content Performance & Insight Detail Social Embed', () => {
  const mockInsight: ReportInsight = {
    id: 'insight-test',
    title: '테스트 인사이트',
    observedFacts: ['사실 1'],
    interpretations: ['해석 1'],
    unknowns: ['미지 1'],
    confidence: 'strong',
    evidence: [
      {
        contentItemId: 'item-1',
        contentVersionId: 'ver-1',
        versionNumber: 1,
        publishAttemptId: 'attempt-1',
        providerPostReference: 'ref-1',
        title: '스레드 테스트 글',
        channel: 'threads',
        collectionState: 'available',
        collectedAt: '2026-08-20T10:00:00.000Z',
        permalink: 'https://threads.net/@sohee/post/THREAD_ABC',
      },
    ],
  }

  const mockRows: readonly ContentPerformanceRow[] = [
    {
      contentItemId: 'item-1',
      contentVersionId: 'ver-1',
      versionNumber: 1,
      publishAttemptId: 'attempt-1',
      providerPostReference: 'ref-1',
      title: '인스타 테스트 글',
      channel: 'instagram',
      saved: 120,
      visits: 200,
      inquiries: 10,
      collectionState: 'available',
      permalink: 'https://www.instagram.com/p/INSTA_XYZ/',
    },
  ]

  it('renders PostEmbed toggle beside performance numbers in ReportContentPerformance and expands iframe', () => {
    render(<ReportContentPerformance insight={mockInsight} rows={mockRows} />)

    const toggle = screen.getByRole('button', { name: '게시물 미리 보기' })
    expect(toggle).toBeInTheDocument()

    fireEvent.click(toggle)
    const iframe = screen.getByTitle('인스타 테스트 글 게시물')
    expect(iframe).toBeInTheDocument()
    expect(iframe).toHaveAttribute('src', 'https://www.instagram.com/p/INSTA_XYZ/embed')
  })

  it('renders PostEmbed toggle in ReportInsightDetail evidence list and expands iframe', () => {
    render(<ReportInsightDetail insight={mockInsight} />)

    const toggle = screen.getByRole('button', { name: '게시물 미리 보기' })
    expect(toggle).toBeInTheDocument()

    fireEvent.click(toggle)
    const iframe = screen.getByTitle('스레드 테스트 글 게시물')
    expect(iframe).toBeInTheDocument()
    expect(iframe).toHaveAttribute('src', 'https://www.threads.com/@sohee/post/THREAD_ABC/embed')
  })
})
