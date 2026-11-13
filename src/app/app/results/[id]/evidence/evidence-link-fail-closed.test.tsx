import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { R2ResultsDrilldown } from '@/features/mobile-results/r2-results-drilldown'

/**
 * 근거 기록 보기 링크의 fail-closed 계약(ANI-1783 AC-3).
 *
 * 목록 라우트(`/app/results/:id/evidence`)로 가는 링크는 숫자를 확인한 뒤에만 열린다.
 * 세션 없음(401)·권한 없음(403)에는 링크를 숨긴다 — 빈 목록으로 위장하지 않는다.
 * 이 파일은 링크의 도착지(근거 기록 페이지) 옆에서 그 진입 조건을 고정한다.
 */
vi.mock('@/features/mobile-shell', () => ({
  MobileAppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ShellScreen: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const WS = '11111111-1111-4111-8111-111111111111'
const PERIOD = { start: '2026-10-01T00:00:00.000Z', end: '2026-10-08T00:00:00.000Z' }

function weeklyReport() {
  return {
    workspaceId: WS,
    datasetMode: 'ACTUAL',
    period: PERIOD,
    metrics: {
      verifiedPublishedPosts: {
        value: 3,
        state: 'OBSERVED',
        source: 'external_action_receipts.independent_publish_readback',
        period: PERIOD,
        observedAt: new Date().toISOString(),
        evidenceIds: ['ev-1'],
      },
    },
    generatedAt: new Date().toISOString(),
  }
}

function response(status: number, payload: unknown) {
  return { status, ok: status >= 200 && status < 300, json: async () => payload }
}

function renderDrilldown() {
  return render(<R2ResultsDrilldown workspaceId={WS} metricId="published" />)
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.NEXT_PUBLIC_MOBILE_R2_EVIDENCE_LIST
})

describe('근거 기록 보기 링크 — fail-closed', () => {
  it('확인된 숫자와 연결된 기록이 있으면 목록 라우트로 보낸다(대조군)', async () => {
    process.env.NEXT_PUBLIC_MOBILE_R2_EVIDENCE_LIST = 'on'
    vi.stubGlobal('fetch', vi.fn(async () => response(200, weeklyReport())))
    renderDrilldown()

    const link = await screen.findByRole('link', { name: '근거 기록 보기' })
    expect(link).toHaveAttribute('href', '/app/results/published/evidence')
    expect(link.className).toContain('min-h-11')
  })

  it('세션이 없으면(401) 링크를 숨긴다 — 없는 페이지로 보내지 않는다', async () => {
    process.env.NEXT_PUBLIC_MOBILE_R2_EVIDENCE_LIST = 'on'
    vi.stubGlobal('fetch', vi.fn(async () => response(401, null)))
    renderDrilldown()

    await screen.findByText('이 내용을 볼 권한이 없어요')
    expect(screen.queryByRole('link', { name: '근거 기록 보기' })).toBeNull()
  })

  it('권한이 없으면(403) 링크를 숨긴다', async () => {
    process.env.NEXT_PUBLIC_MOBILE_R2_EVIDENCE_LIST = 'on'
    vi.stubGlobal('fetch', vi.fn(async () => response(403, null)))
    renderDrilldown()

    await screen.findByText('이 내용을 볼 권한이 없어요')
    expect(screen.queryByRole('link', { name: '근거 기록 보기' })).toBeNull()
  })
})
