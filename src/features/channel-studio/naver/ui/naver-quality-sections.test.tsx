import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NaverReadinessSection } from './naver-quality-sections'
import type { ReadinessEvaluation } from '../editorial-readiness'

const WORKSPACE = '11111111-1111-4111-8111-111111111111'
const CONTENT_ID = '22222222-2222-4222-8222-222222222222'

const mockEvaluation: ReadinessEvaluation = {
  rubricVersion: '1.0',
  evaluatedAt: '2026-11-03T00:00:00Z',
  disclaimer: '네이버 공식 점수나 순위가 아니에요.',
  hardStops: [],
  totalIfComplete: 85,
  eligibility: 'READY',
  dimensions: [
    {
      key: 'FACTUAL_SUPPORT',
      rawScore: 20,
      maxScore: 20,
      status: 'ASSESSED',
      reason: '충분한 사실 근거',
      suggestedFixes: [],
    },
  ],
  actionableFixes: [],
}

describe('NaverReadinessSection', () => {
  it('renders questions textarea with label and re-checks on button click using GET URL with query params', async () => {
    const fetcher = vi.fn().mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockEvaluation),
      })
    })

    render(
      <NaverReadinessSection
        workspaceId={WORKSPACE}
        contentId={CONTENT_ID}
        fetcher={fetcher}
      />,
    )

    // Initial load without query
    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledWith(
        `/api/workspaces/${WORKSPACE}/naver-posts/${CONTENT_ID}/readiness`,
      )
    })

    // Label and textarea
    const textarea = await screen.findByLabelText(
      '독자가 궁금해할 질문 (선택, 한 줄에 하나, 최대 5개)',
    )
    expect(textarea).toBeInTheDocument()
    expect(textarea).toHaveAttribute(
      'placeholder',
      '예: 처음 방문하면 어떻게 이용하나요?\n예약은 어떻게 하나요?',
    )

    // Button with min-h-11
    const recheckBtn = screen.getByRole('button', { name: '다시 점검' })
    expect(recheckBtn).toBeInTheDocument()
    expect(recheckBtn.className).toMatch(/min-h-11|min-h-\[44px\]/)

    // Enter 2 questions
    fireEvent.change(textarea, {
      target: { value: '청라 젤네일 유지기간은 얼마나 되나요?\n손톱 손상 없이 제거하는 방법은?' },
    })

    // Click recheck
    fireEvent.click(recheckBtn)

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledWith(
        expect.stringMatching(
          new RegExp(
            `^/api/workspaces/${WORKSPACE}/naver-posts/${CONTENT_ID}/readiness\\?q=.*&q=.*$`,
          ),
        ),
      )
    })

    const lastCallUrl = fetcher.mock.calls[fetcher.mock.calls.length - 1][0]
    const parsed = new URL(lastCallUrl, 'https://example.com')
    expect(parsed.searchParams.getAll('q')).toEqual([
      '청라 젤네일 유지기간은 얼마나 되나요?',
      '손톱 손상 없이 제거하는 방법은?',
    ])
  })

  it('limits questions to at most 5 even if more lines are provided', async () => {
    const fetcher = vi.fn().mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockEvaluation),
      })
    })

    render(
      <NaverReadinessSection
        workspaceId={WORKSPACE}
        contentId={CONTENT_ID}
        fetcher={fetcher}
      />,
    )

    const textarea = await screen.findByLabelText(
      '독자가 궁금해할 질문 (선택, 한 줄에 하나, 최대 5개)',
    )
    const recheckBtn = screen.getByRole('button', { name: '다시 점검' })

    fireEvent.change(textarea, {
      target: {
        value: '질문 1\n질문 2\n질문 3\n질문 4\n질문 5\n질문 6\n질문 7',
      },
    })

    fireEvent.click(recheckBtn)

    await waitFor(() => {
      expect(fetcher.mock.calls.length).toBeGreaterThan(1)
    })

    const lastCallUrl = fetcher.mock.calls[fetcher.mock.calls.length - 1][0]
    const parsed = new URL(lastCallUrl, 'https://example.com')
    expect(parsed.searchParams.getAll('q')).toEqual([
      '질문 1',
      '질문 2',
      '질문 3',
      '질문 4',
      '질문 5',
    ])
  })
})
