import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MINUTES_SAVED_PER_POST, TRIAL_END_POLICY } from '../config'
import { CANONICAL_NUMBERS } from '../canonical-numbers'
import { extractPublishedLinks } from '../published-links'
import { buildTrialSummary, type TrialSummaryInput } from '../summary-model'
import { daysLeft, isTrialSummaryWindow } from '../trial-end'
import { TrialSummaryView } from '../trial-summary-view'

const now = new Date('2026-10-10T00:00:00Z')
const base: TrialSummaryInput = {
  now,
  endsAt: '2026-10-13T00:00:00Z',
  posts: { status: 'ok', value: 0 },
  vault: { status: 'ok', value: { stored: 0, needsReapproval: 0, externalActions: 0 } },
  links: { status: 'ok', value: [] },
  policy: { kind: 'UNDECIDED', keepDays: null },
}
const render_ = (input: Partial<TrialSummaryInput> = {}) =>
  render(<TrialSummaryView model={buildTrialSummary({ ...base, ...input })} />)

describe('체험 종료 판정', () => {
  it('종료 3일 전부터 종료 전까지만 요약 구간', () => {
    expect(isTrialSummaryWindow('2026-10-13T00:00:00Z', now)).toBe(true)
    expect(isTrialSummaryWindow('2026-10-14T00:00:00Z', now)).toBe(false)
    expect(isTrialSummaryWindow('2026-10-09T00:00:00Z', now)).toBe(false)
  })
  it('종료일을 모르면 확인 전(null)이고 구간도 아니다', () => {
    expect(daysLeft(null, now)).toBeNull()
    expect(daysLeft('엉터리', now)).toBeNull()
    expect(isTrialSummaryWindow(null, now)).toBe(false)
  })
})

describe('실게시 링크', () => {
  it('게시 확인된 기록의 https 주소만 쓴다', () => {
    const links = extractPublishedLinks([
      { status: 'VERIFIED', external_url: 'https://www.instagram.com/p/abc/' },
      { status: 'ACCEPTED_BY_PROVIDER', external_url: 'https://www.instagram.com/p/pending/' },
      { status: 'QUEUED', external_url: 'https://blog.naver.com/x' },
      { status: 'VERIFIED', external_url: 'http://insecure.example/x' },
      { receipt_kind: 'LIVE_PUBLISH', result_url: 'https://blog.naver.com/PostView.naver?logNo=1' },
      { status: 'VERIFIED', external_url: 'https://www.instagram.com/p/abc/' },
    ])
    expect(links.map((l) => l.channelLabel)).toEqual(['인스타그램', '네이버 블로그'])
  })
})

describe('요약 화면', () => {
  it('데이터가 없으면 가짜 수치 대신 "아직 없어요"', () => {
    render_()
    expect(screen.getAllByText('아직 없어요')).toHaveLength(4)
    expect(screen.queryByText('추정')).toBeNull()
  })

  it('조회 실패는 빈 상태가 아니라 오류로 보인다', () => {
    render_({ posts: { status: 'error' }, links: { status: 'error' } })
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(3)
    expect(screen.getAllByText('아직 없어요').length).toBeLessThan(4)
  })

  it('아낀 시간은 항상 "추정"과 산식을 함께 보여 준다', () => {
    render_({ posts: { status: 'ok', value: 3 } })
    expect(screen.getByText('추정')).toBeTruthy()
    expect(screen.getByText(`약 ${3 * MINUTES_SAVED_PER_POST}분`)).toBeTruthy()
    expect(screen.getByText(new RegExp(`글 3건 × 글 1건당 ${MINUTES_SAVED_PER_POST}분`))).toBeTruthy()
  })

  it('보관 글은 외부 게시 전임을 정직하게 밝힌다', () => {
    render_({ vault: { status: 'ok', value: { stored: 2, needsReapproval: 1, externalActions: 0 } } })
    expect(screen.getByText(/아직 외부에 올라가지 않았어요/)).toBeTruthy()
    expect(screen.getByText(/심사를 기다리는 글도 포함/)).toBeTruthy()
  })

  it('게시 링크가 있으면 새 창 안내와 함께 보여 준다', () => {
    render_({ links: { status: 'ok', value: [{ url: 'https://www.instagram.com/p/abc/', channelLabel: '인스타그램' }] } })
    const link = screen.getByRole('link', { name: /인스타그램에서 보기/ })
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('다음 30일 계획에는 예시 배지가 있다', () => {
    render_()
    expect(screen.getByText('예시')).toBeTruthy()
  })

  it('정책 미확정이면 "곧 안내드릴게요"를 보이고 숫자 섹션은 그리지 않는다', () => {
    expect(TRIAL_END_POLICY.kind).toBe('UNDECIDED')
    render_({ numbers: { monthlyPriceWon: 1000, includedCredits: 10, trialDays: 14 } })
    expect(screen.getByTestId('end-policy').textContent).toBe('곧 안내드릴게요')
    expect(screen.queryByTestId('numbers-section')).toBeNull()
  })

  it('정본 숫자가 비어 있으면 정책이 확정돼도 숫자 섹션은 없다', () => {
    expect(Object.values(CANONICAL_NUMBERS).every((v) => v === null)).toBe(true)
    render_({ policy: { kind: 'KEEP_N_DAYS', keepDays: 30 } })
    expect(screen.getByTestId('end-policy').textContent).toContain('30일')
    expect(screen.queryByTestId('numbers-section')).toBeNull()
  })

  it('정책과 정본이 모두 있을 때만 숫자 섹션이 마지막에 나온다', () => {
    render_({ policy: { kind: 'KEEP_ALL', keepDays: null }, numbers: { monthlyPriceWon: 1000, includedCredits: 10, trialDays: 14 } })
    expect(screen.getByTestId('numbers-section')).toBeTruthy()
  })

  it('종료일을 모르면 "확인 전"', () => {
    render_({ endsAt: null })
    expect(screen.getByTestId('days-left').textContent).toBe('확인 전')
  })
})
