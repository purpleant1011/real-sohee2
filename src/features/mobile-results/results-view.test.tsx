// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MobileResultsView, resultsScreenConfig, type ResultsViewSnapshot } from './results-view'
import type { MobileKpi } from './results-model'

const PERIOD = { start: '2026-10-01', end: '2026-10-22', timeZone: 'Asia/Seoul' }

function makeKpi(overrides: Partial<MobileKpi> = {}): MobileKpi {
  return {
    id: 'published',
    value: 12,
    state: 'ready',
    datasetMode: 'ACTUAL',
    period: PERIOD,
    evidenceRef: 'ev-2026-10-22',
    observedAt: '2026-10-22T07:40:00Z',
    ...overrides,
  }
}

function makeSnapshot(overrides: Partial<ResultsViewSnapshot> = {}): ResultsViewSnapshot {
  return {
    loadState: 'ready',
    kpis: [makeKpi()],
    datasetMode: 'ACTUAL',
    estimatedBookedKrw: 790000,
    confirmedPaidKrw: 230000,
    timeSavedBaselineMinutes: 300,
    timeSavedMeasuredMinutes: 90,
    timeSavedMethod: 'before_after_manual',
    checkedAt: '2026-10-22T07:40:00Z',
    ...overrides,
  }
}

describe('M20 성과 화면', () => {
  it('조회 실패면 숫자 대신 실패를 알리고 KPI·금액을 그리지 않는다', () => {
    const { container } = render(<MobileResultsView snapshot={makeSnapshot({ loadState: 'error' })} />)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByText('12건')).toBeNull()
    expect(screen.queryByText(/790,000/)).toBeNull()
    expect(container.textContent).not.toContain('12건')
  })

  it('ACTUAL 이 아닌 데이터셋은 숫자 대신 이유를 보여준다', () => {
    render(<MobileResultsView snapshot={makeSnapshot({ kpis: [makeKpi({ datasetMode: 'DEMO' })] })} />)
    expect(screen.getByText('실제 기록이 아니라 숫자를 보여드리지 않아요')).toBeTruthy()
    expect(screen.queryByText('12건')).toBeNull()
  })

  it('화면 데이터셋이 ACTUAL 이 아니면 금액·시간 절감 숫자도 그리지 않는다', () => {
    const { container } = render(<MobileResultsView snapshot={makeSnapshot({ datasetMode: 'DEMO' })} />)
    expect(container.textContent).not.toContain('790,000')
    expect(container.textContent).not.toContain('230,000')
    expect(container.textContent).not.toContain('210분')
    expect(screen.getByText(/실제 기록이 아니라서 숫자를 보여드리지 않아요/)).toBeTruthy()
  })

  it('예상 금액과 입금 확인 금액을 합산하지 않는다', () => {
    const { container } = render(<MobileResultsView snapshot={makeSnapshot()} />)
    expect(screen.getByText('예약 기준 예상 금액')).toBeTruthy()
    expect(screen.getByText('790,000원')).toBeTruthy()
    expect(screen.getByText('입금 확인된 금액')).toBeTruthy()
    expect(screen.getByText('230,000원')).toBeTruthy()
    // 합산값(1,020,000)을 만들지 않는다.
    expect(container.textContent).not.toContain('1,020,000')
    expect(screen.getByText(/합산하지 않아요/)).toBeTruthy()
  })

  it('KPI 기간이 서로 다르면 비교할 수 없다고 알린다', () => {
    render(<MobileResultsView snapshot={makeSnapshot({
      kpis: [
        makeKpi(),
        makeKpi({ id: 'inquiries', period: { start: '2026-09-01', end: '2026-09-30', timeZone: 'Asia/Seoul' } }),
      ],
    })} />)
    expect(screen.getByText('지표마다 기간이 달라 서로 비교할 수 없어요')).toBeTruthy()
  })

  it('시간 절감은 측정 방법이 없으면 숫자를 만들지 않는다', () => {
    render(<MobileResultsView snapshot={makeSnapshot({ timeSavedMethod: null })} />)
    expect(screen.getByText(/아직 측정하지 않았어요/)).toBeTruthy()
    expect(screen.queryByText(/분을 아꼈어요/)).toBeNull()
  })

  it('기준선과 측정값이 있으면 절감 시간을 보여준다', () => {
    render(<MobileResultsView snapshot={makeSnapshot()} />)
    expect(screen.getByText(/210분을 아꼈어요/)).toBeTruthy()
  })

  it('값·근거가 없는 지표는 0이 아니라 미확인으로 보여준다', () => {
    const { container } = render(<MobileResultsView snapshot={makeSnapshot({ kpis: [makeKpi({ value: null })] })} />)
    expect(screen.getByText('근거가 확인되면 보여드려요')).toBeTruthy()
    expect(container.textContent).not.toContain('0건')
  })

  it('불러오는 중에는 스켈레톤만 그리고 숫자를 그리지 않는다', () => {
    const { container } = render(<MobileResultsView snapshot={makeSnapshot({ loadState: 'loading' })} />)
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(container.textContent).not.toContain('12건')
  })

  it('EXAMPLE 화면은 예시 숫자를 그리되 카드마다 예시 표시를 붙인다', () => {
    const { container } = render(<MobileResultsView snapshot={makeSnapshot({
      datasetMode: 'EXAMPLE',
      kpis: [makeKpi({ datasetMode: 'EXAMPLE' }), makeKpi({ id: 'inquiries', value: 3, datasetMode: 'EXAMPLE' })],
    })} />)

    expect(screen.getByText('12건')).toBeTruthy()
    expect(screen.getByText('790,000원')).toBeTruthy()
    expect(screen.getByText(/예시 화면이에요/)).toBeTruthy()
    // 지표 2 + 금액 2 + 시간 절감 1
    expect(container.querySelectorAll('[data-example-badge]')).toHaveLength(5)
    expect(container.textContent).not.toContain('EXAMPLE')
    // 예시 값을 근거 확인으로 표시하지 않는다.
    expect(screen.queryByText('근거 확인')).toBeNull()
  })

  it('ACTUAL 화면에 EXAMPLE 지표가 섞이면 그 지표는 숫자를 그리지 않는다', () => {
    // 실라우트는 EXAMPLE 스냅샷을 만들 수 없고, 만들어 넣어도 지표 단위로 막힌다(fail-closed).
    const { container } = render(<MobileResultsView snapshot={makeSnapshot({
      datasetMode: 'ACTUAL',
      kpis: [makeKpi(), makeKpi({ id: 'inquiries', datasetMode: 'EXAMPLE' })],
    })} />)

    expect(screen.getByText('12건')).toBeTruthy()
    expect(screen.getByText('실제 기록이 아니라 숫자를 보여드리지 않아요')).toBeTruthy()
    expect(container.textContent).not.toContain('예시 화면이에요')
    expect(container.querySelectorAll('[data-example-badge]')).toHaveLength(0)
  })

  it('내부 상태 코드(ACTUAL/DEMO)를 사장님 화면에 노출하지 않는다', () => {
    const { container } = render(<MobileResultsView snapshot={makeSnapshot({ kpis: [makeKpi({ datasetMode: 'TEST' })] })} />)
    expect(container.textContent).not.toContain('ACTUAL')
    expect(container.textContent).not.toContain('TEST')
  })

  it('성과 화면은 BROWSE 모드 단일 화면 계약을 따른다', () => {
    const config = resultsScreenConfig()
    expect(config.mode).toBe('BROWSE')
    expect(config.title).toBe('성과')
  })
})

describe('M20 지표 카드 → 근거 드릴다운', () => {
  const KPI_IDS = ['published', 'inquiries', 'bookings', 'deposits'] as const
  const kpis = KPI_IDS.map((id, index) => makeKpi({ id, value: index + 1, evidenceRef: `ev-${id}` }))
  const href = (id: (typeof KPI_IDS)[number]) => `/app/results/${id}`

  it('kpiHref 가 있으면 카드마다 그 지표의 드릴다운 링크가 된다', () => {
    render(<MobileResultsView snapshot={makeSnapshot({ kpis })} kpiHref={href} />)
    expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
      '/app/results/published',
      '/app/results/inquiries',
      '/app/results/bookings',
      '/app/results/deposits',
    ])
    expect(screen.getByRole('link', { name: '게시 확인 어디서 확인했는지 보기' })).toBeVisible()
  })

  it('kpiHref 가 없으면(예시 화면) 누를 수 없는 근거 링크를 만들지 않는다', () => {
    render(<MobileResultsView snapshot={makeSnapshot({ kpis })} />)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('조회 실패 화면에는 근거 링크가 생기지 않는다', () => {
    render(<MobileResultsView snapshot={makeSnapshot({ loadState: 'error' })} kpiHref={href} />)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })
})

// axe serious `scrollable-region-focusable`: 셸의 스크롤 영역 안에 탭으로 도달할 곳이 없으면
// 키보드만으로 화면 아래 내용에 접근할 수 없다. 성과·드릴다운 본문에 포커스 가능한 영역을 둔다.
describe('M20 성과 화면 키보드 스크롤(axe scrollable-region-focusable)', () => {
  it('성과 본문이 이름 있는 포커스 가능 영역이다', () => {
    render(<MobileResultsView snapshot={makeSnapshot()} />)
    const region = screen.getByRole('region', { name: '성과 화면 내용' })
    expect(region.tabIndex).toBe(0)
  })

  it('조회 실패·불러오는 중에도 영역은 그대로 포커스를 받는다', () => {
    const { unmount } = render(<MobileResultsView snapshot={makeSnapshot({ loadState: 'error' })} />)
    expect(screen.getByRole('region', { name: '성과 화면 내용' }).tabIndex).toBe(0)
    unmount()

    render(<MobileResultsView snapshot={makeSnapshot({ loadState: 'loading' })} />)
    expect(screen.getByRole('region', { name: '성과 화면 내용' }).tabIndex).toBe(0)
  })

  it('키보드 포커스에만 보이는 링을 그린다(2.4.7)', () => {
    render(<MobileResultsView snapshot={makeSnapshot()} />)
    const region = screen.getByRole('region', { name: '성과 화면 내용' })

    // `outline-none` + `outline-2` 조합은 Tailwind v4 에서 outline-style:none 이 남아 보이지 않는다.
    // box-shadow 로 그리는 링을 focus-visible 에만 건다.
    expect(region.className).toContain('focus-visible:ring-2')
    expect(region.className).toContain('focus-visible:ring-ring')
    expect(region.className).not.toMatch(/(^|\s)outline-none(\s|$)/)
  })
})

// '다음에 할 일' — 측정된 사실에서만 만들고, 근거가 없으면 카드 자체를 그리지 않는다.
describe('M20 다음에 할 일 제안(ANI-1706 잔여 C)', () => {
  const withKpis = (...kpis: MobileKpi[]) => makeSnapshot({ kpis })

  it('예약은 확인됐는데 입금 확인이 0건이면 그 사실로 할 일을 제안한다', () => {
    render(<MobileResultsView snapshot={withKpis(
      makeKpi({ id: 'bookings', value: 2 }),
      makeKpi({ id: 'deposits', value: 0 }),
    )} />)

    const card = screen.getByRole('region', { name: '다음에 할 일' })
    expect(card.textContent).toContain('예약 확정 2건')
    expect(card.textContent).toContain('0건')
  })

  it('근거가 없는 지표만 있으면 제안 카드를 그리지 않는다', () => {
    render(<MobileResultsView snapshot={withKpis(
      makeKpi({ id: 'bookings', value: 2 }),
      makeKpi({ id: 'deposits', value: null }),
    )} />)

    expect(screen.queryByRole('region', { name: '다음에 할 일' })).toBeNull()
  })

  it('예시 화면에서는 측정되지 않은 일을 시키지 않는다', () => {
    render(<MobileResultsView snapshot={makeSnapshot({
      datasetMode: 'EXAMPLE',
      kpis: [makeKpi({ id: 'published', value: 0, datasetMode: 'EXAMPLE' })],
    })} />)

    expect(screen.queryByRole('region', { name: '다음에 할 일' })).toBeNull()
  })

  it('조회 실패 화면에서는 제안도 그리지 않는다', () => {
    render(<MobileResultsView snapshot={makeSnapshot({ loadState: 'error' })} />)
    expect(screen.queryByRole('region', { name: '다음에 할 일' })).toBeNull()
  })

  it('게시 확인이 0건일 때 게시 확인 화면 링크 버튼을 포함한다', () => {
    render(<MobileResultsView snapshot={withKpis(
      makeKpi({ id: 'published', value: 0 }),
    )} />)

    const card = screen.getByRole('region', { name: '다음에 할 일' })
    expect(card.textContent).toContain('게시가 확인된 홍보가 없어요')
    const linkBtn = within(card).getByRole('link', { name: '게시 확인하러 가기' })
    expect(linkBtn).toHaveAttribute('href', '/app/content')
    expect(linkBtn.className).toContain('min-h-11')
  })
})

describe('M20 기간 선택(ANI-1706)', () => {
  it('period·onPeriodChange 를 주면 이번 주/지난주 선택이 붙는다', () => {
    render(<MobileResultsView snapshot={makeSnapshot()} period="current" onPeriodChange={() => {}} />)
    const group = screen.getByRole('group', { name: '성과 기간' })
    expect(group).toBeTruthy()
    expect(screen.getByRole('button', { name: '이번 주' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '지난주' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('누른 기간을 그대로 알린다(화면이 기간을 스스로 바꾸지 않는다)', () => {
    const onPeriodChange = vi.fn()
    render(<MobileResultsView snapshot={makeSnapshot()} period="current" onPeriodChange={onPeriodChange} />)
    fireEvent.click(screen.getByRole('button', { name: '지난주' }))
    expect(onPeriodChange).toHaveBeenCalledWith('previous')
  })

  it('기간 선택을 주지 않으면(예시 화면) 기간을 바꾸는 컨트롤을 만들지 않는다', () => {
    render(<MobileResultsView snapshot={makeSnapshot()} />)
    expect(screen.queryByRole('group', { name: '성과 기간' })).toBeNull()
  })

  it('조회가 실패한 상태에서도 다른 기간으로 넘어갈 수 있다', () => {
    const onPeriodChange = vi.fn()
    render(<MobileResultsView snapshot={makeSnapshot({ loadState: 'error' })} period="previous" onPeriodChange={onPeriodChange} />)
    fireEvent.click(screen.getByRole('button', { name: '이번 주' }))
    expect(onPeriodChange).toHaveBeenCalledWith('current')
  })

  // ANI-1782 직접 선택 — onRangeChange 를 받는 실라우트에만 세 번째 버튼이 붙는다.
  it('onRangeChange 를 넘기면 직접 선택 버튼이 붙는다', () => {
    render(<MobileResultsView snapshot={makeSnapshot()} period="current" onPeriodChange={() => {}} onRangeChange={() => {}} />)

    expect(screen.getByRole('button', { name: '직접 선택' })).toBeVisible()
    expect(screen.getByRole('button', { name: '직접 선택' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('적용 중인 구간이 있으면 직접 선택이 켜진 것으로 보인다', () => {
    render(
      <MobileResultsView
        snapshot={makeSnapshot()}
        period="current"
        onPeriodChange={() => {}}
        range={{ start: '2026-10-01', end: '2026-10-07' }}
        onRangeChange={() => {}}
      />,
    )

    expect(screen.getByRole('button', { name: '직접 선택' }).getAttribute('aria-pressed')).toBe('true')
    // 프리셋까지 눌린 것처럼 보이면 '이번 주' 라벨 아래 다른 기간 숫자를 읽게 된다.
    expect(screen.getByRole('button', { name: '이번 주' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: '지난주' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('onRangeChange 를 넘기지 않으면(예시 화면) 직접 선택 버튼이 없다', () => {
    render(<MobileResultsView snapshot={makeSnapshot()} period="current" onPeriodChange={() => {}} />)

    expect(screen.queryByRole('button', { name: '직접 선택' })).toBeNull()
  })

  it('ISO period 의 배타 끝은 하루 빼서 마지막으로 포함된 날을 보여준다', () => {
    render(<MobileResultsView snapshot={makeSnapshot({
      kpis: [makeKpi({ period: { start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z', timeZone: 'UTC' } })],
    })} />)

    expect(screen.getByText('2026-09-01 ~ 2026-09-30 기준')).toBeTruthy()
  })
})
