import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResultsDetailEntry } from './results-detail-entry'

const routerReplace = vi.hoisted(() => vi.fn())
const active = vi.hoisted(() => ({ value: true }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: routerReplace, push: vi.fn(), back: vi.fn() }) }))
vi.mock('@/features/mobile-shell/r2-gate', () => ({ useMobileR2Active: () => active.value }))
vi.mock('@/hooks/use-workspace-context', () => ({ useWorkspaceId: () => '11111111-1111-4111-8111-111111111111' }))
vi.mock('@/features/mobile-results/r2-results-drilldown', () => ({
  R2ResultsDrilldown: ({ workspaceId, metricId }: { workspaceId: string; metricId: string }) => (
    <p>{`drilldown:${metricId}:${workspaceId}`}</p>
  ),
}))
vi.mock('../results-view', () => ({
  default: ({ initialMetricId }: { initialMetricId?: string }) => (
    <div data-testid="pc-results-view">{`pc-results:${initialMetricId}`}</div>
  ),
}))

beforeEach(() => {
  routerReplace.mockClear()
  active.value = true
})
afterEach(() => vi.unstubAllGlobals())

describe('/app/results/:id 진입 게이트(ANI-1706)', () => {
  it('플래그 ON + 좁은 화면이면 지표 키를 그대로 드릴다운에 넘긴다', () => {
    render(<ResultsDetailEntry metricId="published" />)
    expect(screen.getByText('drilldown:published:11111111-1111-4111-8111-111111111111')).toBeVisible()
    expect(routerReplace).not.toHaveBeenCalled()
  })

  it('플래그 OFF·넓은 화면(PC)이면 성과 화면으로 리다이렉트하지 않고 PC ResultsView(해당 지표 선택 상태)를 렌더링한다', async () => {
    active.value = false
    render(<ResultsDetailEntry metricId="published" />)
    expect(routerReplace).not.toHaveBeenCalled()
    expect(screen.getByTestId('pc-results-view')).toHaveTextContent('pc-results:published')
  })
})
