import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MobileHomeDto, MobileMetric } from '../mobile-decision/contracts'
import { TodayActivityCard, getActivityHref } from './today-activity-card'

function mockView(overrides?: Partial<Pick<MobileHomeDto, 'activity' | 'results'>>): Pick<MobileHomeDto, 'activity' | 'results'> {
  return {
    activity: {
      state: 'ready',
      data: [
        { id: 'act-1', title: '인스타그램 피드 발행', statusLabel: '발행 완료', observedAt: '2026-11-06T09:00:00Z', evidenceRef: 'ev-1' },
        { id: 'act-2', title: '댓글 문의 답변', statusLabel: '답변 완료', observedAt: '2026-11-06T08:30:00Z', evidenceRef: 'ev-2' },
        { id: 'act-3', title: '예약 안내 알림톡', statusLabel: '발송 완료', observedAt: '2026-11-06T08:00:00Z', evidenceRef: 'ev-3' },
        { id: 'act-4', title: '초과 업무', statusLabel: '숨겨져야 함', observedAt: '2026-11-06T07:00:00Z', evidenceRef: 'ev-4' },
      ],
      observedAt: '2026-11-06T09:05:00Z',
      validUntil: null,
    },
    results: {
      state: 'ready',
      data: [
        {
          id: 'published',
          label: '발행한 글',
          value: 12,
          unit: '건',
          state: 'ready',
          evidenceRef: 'ev-res-1',
          source: 'Instagram Graph API',
          datasetMode: 'ACTUAL',
          period: { start: '2026-11-01', end: '2026-11-06', timeZone: 'Asia/Seoul' },
        },
        {
          id: 'bookings',
          label: '예약 확정',
          value: 5,
          unit: '건',
          state: 'ready',
          evidenceRef: 'ev-res-2',
          source: '네이버 예약 연동',
          datasetMode: 'ACTUAL',
          period: { start: '2026-11-01', end: '2026-11-06', timeZone: 'Asia/Seoul' },
        },
      ],
      observedAt: '2026-11-06T09:05:00Z',
      validUntil: null,
    },
    ...overrides,
  }
}

describe('TodayActivityCard', () => {
  it('소희가 한 일 제목과 최근 3개 활동, 확인된 결과 칩, 성과 보기 링크를 렌더링한다', () => {
    const onRefresh = vi.fn()
    const view = mockView()

    render(<TodayActivityCard view={view} onRefresh={onRefresh} />)

    // 카드 제목
    expect(screen.getByRole('heading', { level: 3, name: '소희가 한 일' })).toBeInTheDocument()

    // 최근 업무 최대 3개 노출 (4번째는 제외)
    expect(screen.getByText('인스타그램 피드 발행')).toBeInTheDocument()
    expect(screen.getByText('댓글 문의 답변')).toBeInTheDocument()
    expect(screen.getByText('예약 안내 알림톡')).toBeInTheDocument()
    expect(screen.queryByText('초과 업무')).toBeNull()

    // 확인된 결과 숫자 칩 (metricText 활용)
    expect(screen.getByText('발행한 글')).toBeInTheDocument()
    expect(screen.getByText('12건')).toBeInTheDocument()
    expect(screen.getByText('예약 확정')).toBeInTheDocument()
    expect(screen.getByText('5건')).toBeInTheDocument()

    // 성과 보기 링크
    const resultsLink = screen.getByRole('link', { name: /성과 보기/ })
    expect(resultsLink).toHaveAttribute('href', '/app/results')

    // 소희가 한 일 개별 항목 링크 확인
    const postLink = screen.getByRole('link', { name: /인스타그램 피드 발행/ })
    expect(postLink).toHaveAttribute('href', '/app/content')

    const commentLink = screen.getByRole('link', { name: /댓글 문의 답변/ })
    expect(commentLink).toHaveAttribute('href', '/app/engagement')
  })

  it('승인 대기 상태의 활동 항목은 /app/approvals?item=... 링크로 연결된다', () => {
    const view = mockView({
      activity: {
        state: 'ready',
        data: [
          { id: 'approval-1', title: '고객 답글 초안', statusLabel: '승인 대기', observedAt: '2026-11-06T09:00:00Z', evidenceRef: null },
        ],
        observedAt: '2026-11-06T09:05:00Z',
        validUntil: null,
      },
    })
    render(<TodayActivityCard view={view} onRefresh={vi.fn()} />)
    const link = screen.getByRole('link', { name: /고객 답글 초안/ })
    expect(link).toHaveAttribute('href', '/app/approvals?item=approval-1')
  })

  it('실제 UUID content 항목은 status가 승인 대기라도 /app/work/<uuid>로 연결된다', () => {
    const uuid = '2bf00000-0000-4000-8000-000000000001'
    const view = mockView({
      activity: {
        state: 'ready',
        data: [
          { id: `content:${uuid}`, title: '블로그 포스팅 초안', statusLabel: '승인 대기', observedAt: '2026-11-06T09:00:00Z', evidenceRef: null },
        ],
        observedAt: '2026-11-06T09:05:00Z',
        validUntil: null,
      },
    })
    render(<TodayActivityCard view={view} onRefresh={vi.fn()} />)
    const link = screen.getByRole('link', { name: /블로그 포스팅 초안/ })
    expect(link).toHaveAttribute('href', `/app/work/${uuid}`)
  })

  it('getActivityHref: non-uuid content는 /app/content fallback으로 안전하게 연결된다', () => {
    expect(getActivityHref({ id: 'content:not-a-uuid', statusLabel: '승인 대기' })).toBe('/app/content')
    expect(getActivityHref({ id: 'content:invalid-123', statusLabel: '작성 완료' })).toBe('/app/content')
  })

  it('getActivityHref: comment/dm/post 승인키는 승인 대기 시 기존 승인 링크를 유지한다', () => {
    const uuid = 'e12a4ff2-9bfe-408c-9912-55184b8756a2'
    expect(getActivityHref({ id: `comment:${uuid}`, statusLabel: '승인 대기' })).toBe(`/app/approvals?item=${encodeURIComponent(`comment:${uuid}`)}`)
    expect(getActivityHref({ id: `dm:${uuid}`, statusLabel: '검토 필요' })).toBe(`/app/approvals?item=${encodeURIComponent(`dm:${uuid}`)}`)
    expect(getActivityHref({ id: `post:${uuid}`, statusLabel: '승인 대기' })).toBe(`/app/approvals?item=${encodeURIComponent(`post:${uuid}`)}`)
  })

  it('activity가 로딩 중일 때 로딩 안내 문구를 노출하고 없음으로 치환하지 않는다', () => {
    const onRefresh = vi.fn()
    const view = mockView({
      activity: { state: 'loading', data: null, observedAt: null, validUntil: null },
    })

    render(<TodayActivityCard view={view} onRefresh={onRefresh} />)
    expect(screen.getByText('업무 기록을 확인하고 있어요.')).toBeInTheDocument()
    expect(screen.queryByText(/아직 최근 작업 기록이 없어요/)).toBeNull()
  })

  it('activity가 unknown일 때 확인 중 안내 문구를 노출한다', () => {
    const onRefresh = vi.fn()
    const view = mockView({
      activity: { state: 'unknown', data: null, observedAt: null, validUntil: null },
    })

    render(<TodayActivityCard view={view} onRefresh={onRefresh} />)
    expect(screen.getByText(/업무 기록 연결을 확인하고 있어요/)).toBeInTheDocument()
  })

  it('activity가 error일 때 에러 안내와 다시 확인하기 버튼을 누르면 onRefresh를 호출한다', () => {
    const onRefresh = vi.fn()
    const view = mockView({
      activity: { state: 'error', data: null, observedAt: null, validUntil: null },
    })

    render(<TodayActivityCard view={view} onRefresh={onRefresh} />)
    expect(screen.getByText('업무 기록을 불러오지 못했어요')).toBeInTheDocument()
    expect(screen.getByText(/잠시 후 다시 확인해 주세요. 기록이 없다는 뜻은 아니에요/)).toBeInTheDocument()

    const retryBtn = screen.getByRole('button', { name: '다시 확인하기' })
    expect(retryBtn).toHaveClass('min-h-11')
    const status = screen.getByRole('status')
    expect(status).not.toContainElement(retryBtn)
    fireEvent.click(retryBtn)
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('activity가 ready이고 빈 배열이면 기록 없음 안내를 표시한다', () => {
    const onRefresh = vi.fn()
    const view = mockView({
      activity: { state: 'ready', data: [], observedAt: '2026-11-06T09:05:00Z', validUntil: null },
    })

    render(<TodayActivityCard view={view} onRefresh={onRefresh} />)
    expect(screen.getByText('아직 최근 작업 기록이 없어요. 첫 소식을 맡기면 여기에 기록돼요.')).toBeInTheDocument()
  })

  it('activity가 stale 상태일 때 stale 안내 문구를 표시한다', () => {
    const onRefresh = vi.fn()
    const view = mockView({
      activity: {
        state: 'stale',
        data: [{ id: 'act-1', title: '과거 업무', statusLabel: '발행 완료', observedAt: '2026-11-05T09:00:00Z', evidenceRef: 'ev-1' }],
        observedAt: '2026-11-05T09:05:00Z',
        validUntil: null,
      },
    })

    render(<TodayActivityCard view={view} onRefresh={onRefresh} />)
    expect(screen.getByText('과거 업무')).toBeInTheDocument()
    expect(screen.getByText('다시 확인이 필요해요 · 마지막으로 확인한 기록이에요.')).toBeInTheDocument()
  })

  it.each([
    ['loading', '성과를 확인하고 있어요.'],
    ['error', '성과를 불러오지 못했어요. 다시 확인해 주세요.'],
    ['stale', '성과를 다시 확인해 주세요. 이전에 확인한 정보예요.'],
    ['unknown', '성과 정보를 아직 확인하지 못했어요.'],
  ] as const)('results가 %s이면 빈 결과와 구분한다', (state, message) => {
    const view = mockView({
      results: { ...mockView().results, state },
    })

    render(<TodayActivityCard view={view} onRefresh={vi.fn()} />)
    expect(screen.getByText(message)).toBeInTheDocument()
    expect(screen.queryByText('확인된 결과가 생기면 여기에 보여드려요.')).toBeNull()
    expect(screen.queryByText('12건')).toBeNull()
  })

  it('성과 조회 실패를 다시 확인할 수 있고 터치 높이는 44px 이상이다', () => {
    const onRefresh = vi.fn()
    render(<TodayActivityCard view={mockView({ results: { state: 'error', data: null, observedAt: null, validUntil: null } })} onRefresh={onRefresh} />)
    const retry = screen.getByRole('button', { name: '성과 다시 확인' })
    expect(retry).toHaveClass('min-h-11')
    fireEvent.click(retry)
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('확인된 빈 성과에만 결과가 생기면 보여준다고 안내한다', () => {
    render(<TodayActivityCard view={mockView({ results: { state: 'ready', data: [], observedAt: '2026-11-06T09:05:00Z', validUntil: null } })} onRefresh={vi.fn()} />)
    expect(screen.getByText('확인된 결과가 생기면 여기에 보여드려요.')).toBeInTheDocument()
  })

  it('results에 데이터가 4개 이상 있어도 최대 3개까지만 노출한다', () => {
    const onRefresh = vi.fn()
    const fourthMetric: MobileMetric = {
      id: 'revenue',
      label: '매출 성과',
      value: 100000,
      unit: '원',
      state: 'ready',
      evidenceRef: 'ev-4',
      source: 'POS API',
      datasetMode: 'ACTUAL',
      period: { start: '2026-11-01', end: '2026-11-06', timeZone: 'Asia/Seoul' },
    }
    const view = mockView({
      results: {
        state: 'ready',
        data: [
          ...mockView().results.data!,
          { ...fourthMetric, id: 'revenue', label: '세 번째 성과' },
          { ...fourthMetric, id: 'revenue', label: '네 번째 성과(초과)' },
        ],
        observedAt: '2026-11-06T09:05:00Z',
        validUntil: null,
      },
    })

    render(<TodayActivityCard view={view} onRefresh={onRefresh} />)
    expect(screen.getByText('세 번째 성과')).toBeInTheDocument()
    expect(screen.queryByText('네 번째 성과(초과)')).toBeNull()
  })

  it('동일 기간이면 칩 라벨을 짧게 유지하고 공통 집계 기간을 1회만 표시한다 (종료 미포함 및 연결 필요 문구 보존)', () => {
    const onRefresh = vi.fn()
    const view = mockView({
      results: {
        state: 'ready',
        data: [
          {
            id: 'published',
            label: '게시 확인 · 2026-10-31 ~ 2026-11-07 (UTC)',
            value: 12,
            unit: '건',
            state: 'ready',
            evidenceRef: 'ev-res-1',
            source: 'Instagram Graph API',
            datasetMode: 'ACTUAL',
            period: { start: '2026-10-31T00:00:00.000Z', end: '2026-11-07T00:00:00.000Z', timeZone: 'UTC' },
          },
          {
            id: 'bookings',
            label: '현재 확정 예약 · 2026-10-31 ~ 2026-11-07 (UTC)',
            value: null,
            unit: '건',
            state: 'ready',
            evidenceRef: null,
            source: null,
            datasetMode: 'ACTUAL',
            period: { start: '2026-10-31T00:00:00.000Z', end: '2026-11-07T00:00:00.000Z', timeZone: 'UTC' },
          },
          {
            id: 'revenue',
            label: '확인된 매출 · 채널 연결 필요 · 2026-10-31 ~ 2026-11-07 (UTC)',
            value: null,
            unit: '원',
            state: 'error',
            evidenceRef: null,
            source: null,
            datasetMode: 'ACTUAL',
            period: { start: '2026-10-31T00:00:00.000Z', end: '2026-11-07T00:00:00.000Z', timeZone: 'UTC' },
          },
        ],
        observedAt: '2026-11-06T09:05:00Z',
        validUntil: null,
      },
    })

    render(<TodayActivityCard view={view} onRefresh={onRefresh} />)

    // 칩 라벨은 짧게 유지되면서 채널 연결 필요 문구는 보존
    expect(screen.getByText('게시 확인')).toBeInTheDocument()
    expect(screen.getByText('12건')).toBeInTheDocument()

    expect(screen.getByText('현재 확정 예약')).toBeInTheDocument()
    expect(screen.getByText('아직 확인되지 않았어요')).toBeInTheDocument()

    expect(screen.getByText('확인된 매출 · 채널 연결 필요')).toBeInTheDocument()
    expect(screen.getByText('불러오지 못했어요')).toBeInTheDocument()

    // 칩 아래에 종료 미포함(~전까지) 공통 집계 기간 1회 노출
    expect(
      screen.getByText('집계 기간 · 10월31일 오전9시부터 11월7일 오전9시 전까지 (한국 시간)'),
    ).toBeInTheDocument()
  })

  it('기간이 서로 다르거나 null인 경우 한 기간으로 합치지 않고 개별 표기하거나 추정하지 않는다', () => {
    const onRefresh = vi.fn()
    const view = mockView({
      results: {
        state: 'ready',
        data: [
          {
            id: 'published',
            label: '게시 확인 · 2026-10-20 ~ 2026-10-27 (UTC)',
            value: 8,
            unit: '건',
            state: 'ready',
            evidenceRef: 'ev-res-1',
            source: 'Instagram Graph API',
            datasetMode: 'ACTUAL',
            period: { start: '2026-10-20T00:00:00.000Z', end: '2026-10-27T00:00:00.000Z', timeZone: 'UTC' },
          },
          {
            id: 'bookings',
            label: '현재 확정 예약 · 2026-10-31 ~ 2026-11-07 (UTC)',
            value: null,
            unit: '건',
            state: 'ready',
            evidenceRef: null,
            source: null,
            datasetMode: 'ACTUAL',
            period: null, // null period: 추정 금지
          },
        ],
        observedAt: '2026-11-06T09:05:00Z',
        validUntil: null,
      },
    })

    render(<TodayActivityCard view={view} onRefresh={onRefresh} />)

    // 기간이 일치하지 않으므로 공통 집계 기간 라인은 노출되지 않음
    expect(screen.queryByText(/집계 기간 ·/)).toBeNull()

    // period가 유효한 칩에는 개별 기간 표기
    expect(
      screen.getByText('게시 확인 · 10월20일 오전9시부터 10월27일 오전9시 전까지 (한국 시간)'),
    ).toBeInTheDocument()
    expect(screen.getByText('8건')).toBeInTheDocument()

    // period가 null인 칩에는 추정 기간 없이 라벨만 표기
    expect(screen.getByText('현재 확정 예약')).toBeInTheDocument()
    expect(screen.getByText('아직 확인되지 않았어요')).toBeInTheDocument()
  })

  it('40자가 넘는 긴 제목은 40자에서 말줄임표(…) 처리하고 상태는 StatusPill로 렌더링한다', () => {
    const longTitle = '매일 아침 거울을 보며 피부 고민을 하시는 고객님들을 위해 준비한 특별한 스킨케어 팁과 관리법을 소개합니다.'
    const view = mockView({
      activity: {
        state: 'ready',
        data: [
          { id: 'act-long', title: longTitle, statusLabel: '승인 대기', observedAt: '2026-11-06T09:00:00Z', evidenceRef: null },
        ],
        observedAt: '2026-11-06T09:05:00Z',
        validUntil: null,
      },
    })

    render(<TodayActivityCard view={view} onRefresh={vi.fn()} />)

    const expectedTruncated = longTitle.slice(0, 40) + '…'
    expect(screen.getByText(expectedTruncated)).toBeInTheDocument()
    expect(screen.queryByText(longTitle)).toBeNull()

    // 상태는 StatusPill로 렌더링되어 StatusPill의 텍스트가 표시됨
    const pill = screen.getByText('승인 대기')
    expect(pill.closest('span')).toHaveClass('rounded-full')
  })

  it('성과 요약은 최대 3개가 한 줄(그리드)로 정돈되어 표시된다', () => {
    const period = { start: '2026-11-01T00:00:00.000Z', end: '2026-11-06T00:00:00.000Z', timeZone: 'Asia/Seoul' }
    const view = mockView({
      results: {
        state: 'ready',
        data: [
          { id: 'published', label: '발행 글', value: 3, unit: '건', state: 'ready', evidenceRef: 'ev-1', source: 'Instagram', datasetMode: 'ACTUAL', period },
          { id: 'bookings', label: '예약 문의', value: 7, unit: '건', state: 'ready', evidenceRef: 'ev-2', source: 'Naver', datasetMode: 'ACTUAL', period },
          { id: 'revenue', label: '확인된 매출', value: 15, unit: '원', state: 'ready', evidenceRef: 'ev-3', source: 'Channel', datasetMode: 'ACTUAL', period },
        ],
        observedAt: '2026-11-06T09:05:00Z',
        validUntil: null,
      },
    })

    const { container } = render(<TodayActivityCard view={view} onRefresh={vi.fn()} />)
    const grid = container.querySelector('.grid-cols-3')
    expect(grid).toBeInTheDocument()
    expect(screen.getByText('발행 글')).toBeInTheDocument()
    expect(screen.getByText('3건')).toBeInTheDocument()
    expect(screen.getByText('예약 문의')).toBeInTheDocument()
    expect(screen.getByText('7건')).toBeInTheDocument()
    expect(screen.getByText('확인된 매출')).toBeInTheDocument()
    expect(screen.getByText('15원')).toBeInTheDocument()
  })

  it('게시 확인 전 활동 항목은 checking_external로 매핑되고 StatusPill에 확인 전으로 축약 렌더링된다', () => {
    const view = mockView({
      activity: {
        state: 'ready',
        data: [
          { id: 'content:0ab74cd0-5b88-4234-b9d0-eef3ba25b6ed', title: '가을 신메뉴 소개', statusLabel: '게시 확인 전', observedAt: '2026-11-06T09:00:00Z', evidenceRef: null },
        ],
        observedAt: '2026-11-06T09:05:00Z',
        validUntil: null,
      },
    })
    render(<TodayActivityCard view={view} onRefresh={vi.fn()} />)
    expect(screen.getByText('가을 신메뉴 소개')).toBeInTheDocument()
    // StatusPill은 '게시 확인 전' 라벨을 '확인 전'으로 축약하고 aria-label을 '게시 확인 전'으로 유지
    expect(screen.getByText('확인 전')).toBeInTheDocument()
    const pill = screen.getByLabelText('게시 확인 전')
    expect(pill).toBeInTheDocument()
  })
})
