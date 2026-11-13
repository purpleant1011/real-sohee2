import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  AGENT_OS_CHART_THEME,
  ChartContainer,
  ChartContext,
  ChartEmptyState,
  ChartTooltipContent,
  type ChartConfig,
} from './chart'

describe('Chart Component & Semantic Presets (ANI-913)', () => {
  it('defines 7 canonical Agent OS semantic color mappings', () => {
    expect(AGENT_OS_CHART_THEME).toHaveProperty('outcome')
    expect(AGENT_OS_CHART_THEME).toHaveProperty('booking')
    expect(AGENT_OS_CHART_THEME).toHaveProperty('revenue')
    expect(AGENT_OS_CHART_THEME).toHaveProperty('spend')
    expect(AGENT_OS_CHART_THEME).toHaveProperty('organic')
    expect(AGENT_OS_CHART_THEME).toHaveProperty('paid')
    expect(AGENT_OS_CHART_THEME).toHaveProperty('confidence')
  })

  it('renders ChartEmptyState with accessible role and custom messages', () => {
    render(
      <ChartEmptyState
        title="측정된 성과 데이터가 없습니다"
        description="검증된 외부 반응이 수집되면 여기에 추세선이 표시됩니다."
      />
    )

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('측정된 성과 데이터가 없습니다')).toBeInTheDocument()
    expect(
      screen.getByText('검증된 외부 반응이 수집되면 여기에 추세선이 표시됩니다.')
    ).toBeInTheDocument()
  })

  it('renders ChartContainer and injects dynamic CSS style block for config colors', () => {
    const config: ChartConfig = {
      outcome: {
        label: '성과 전환',
        color: 'var(--v088-accent)',
      },
      booking: {
        label: '확정 예약',
        color: 'var(--v088-success)',
      },
    }

    const { container } = render(
      <ChartContainer id="test-chart" config={config}>
        <div data-testid="dummy-chart-child" />
      </ChartContainer>
    )

    const chartWrapper = container.querySelector('[data-chart="chart-test-chart"]')
    expect(chartWrapper).toBeInTheDocument()

    const styleEl = container.querySelector('style')
    expect(styleEl).toBeInTheDocument()
    expect(styleEl?.innerHTML).toContain('--color-outcome: var(--v088-accent);')
    expect(styleEl?.innerHTML).toContain('--color-booking: var(--v088-success);')
  })

  it('renders ChartTooltipContent with freshness and confidence truth metrics', () => {
    const config: ChartConfig = {
      outcome: {
        label: '성과 전환',
        color: '#6366f1',
      },
    }

    render(
      <ChartContext.Provider value={{ config }}>
        <ChartTooltipContent
          active={true}
          payload={[
            {
              name: 'outcome',
              value: 42,
              dataKey: 'outcome',
              color: '#6366f1',
              payload: { outcome: 42 },
            },
          ]}
          label="2026-09-06"
          freshness="1분 전 동기화"
          confidence={98}
        />
      </ChartContext.Provider>
    )

    expect(screen.getByText('성과 전환')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('기준: 1분 전 동기화')).toBeInTheDocument()
    expect(screen.getByText('신뢰도: 98%')).toBeInTheDocument()
  })
})
