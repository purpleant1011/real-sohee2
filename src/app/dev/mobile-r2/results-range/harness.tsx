'use client'

import { WorkspaceProvider } from '@/components/workspace/workspace-provider'
import { R2Results } from '@/features/mobile-results/r2-results'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'

/** 예시 워크스페이스. 실제 테넌트가 아니다. */
const PREVIEW_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const GENERATED_AT = '2026-10-24T03:00:00.000Z'

/** 구간을 고르지 않았을 때 돌려주는 고정 7일 구간(끝은 배타). */
const FALLBACK_PERIOD = { start: '2026-10-17T00:00:00.000Z', end: '2026-10-24T00:00:00.000Z' }

/**
 * 근거 출처. 서버 어댑터(`@/features/mobile-results/server/results-snapshot`)는 출처를 댈 수 있는
 * 관측만 숫자로 옮기므로, 예시 응답도 실제 원장 이름을 쓴다. 실제 기록 id 가 아니며 화면에는 노출되지 않는다.
 */
const READBACK_SOURCE = 'external_action_receipts.independent_publish_readback'
const RESERVATION_SOURCE = 'reservations.created_at/current_status'

const DAY_MS = 24 * 60 * 60 * 1000
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

type Period = { start: string; end: string }

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

/** 요청의 `start`·`end`(YYYY-MM-DD)를 반개구간으로 옮긴다. 값이 없거나 깨졌으면 고정 구간을 쓴다. */
function periodFromUrl(url: string): Period {
  const parsed = new URL(url, 'http://dev-harness.local')
  const start = parsed.searchParams.get('start')
  const end = parsed.searchParams.get('end')
  if (!start || !end || !DATE_ONLY.test(start) || !DATE_ONLY.test(end)) return FALLBACK_PERIOD
  const endMs = Date.parse(`${end}T00:00:00.000Z`)
  if (!Number.isFinite(endMs)) return FALLBACK_PERIOD
  return { start: `${start}T00:00:00.000Z`, end: new Date(endMs + DAY_MS).toISOString() }
}

function observed(value: number, source: string, period: Period) {
  return {
    value,
    state: 'OBSERVED' as const,
    source,
    period,
    observedAt: GENERATED_AT,
    evidenceIds: ['example-evidence'],
  }
}

/**
 * 주간 리포트 응답과 같은 모양의 예시 본문.
 * 실제 집계가 아니므로 운영 증거로 쓸 수 없다 — 화면 배치·상태 확인용이다.
 */
function weeklyPayload(url: string) {
  const period = periodFromUrl(url)
  return {
    workspaceId: PREVIEW_WORKSPACE_ID,
    datasetMode: 'ACTUAL',
    period,
    metrics: {
      verifiedPublishedPosts: observed(3, READBACK_SOURCE, period),
      storedComments: observed(9, READBACK_SOURCE, period),
      bookingConfirmed: observed(2, RESERVATION_SOURCE, period),
      paymentCapturedVerified: observed(2, RESERVATION_SOURCE, period),
      revenue: observed(1_000_000, READBACK_SOURCE, period),
    },
    generatedAt: GENERATED_AT,
  }
}

const originalFetch = globalThis.fetch

/**
 * 성과 화면은 주간 리포트 읽기(`/reports/weekly`) 하나만 서버에 묻는다.
 * 그 요청만 예시 응답으로 바꾸고 나머지 요청은 원래 fetch 로 그대로 넘긴다.
 * 모듈 스코프에서 한 번 설치하며 브라우저에서만 동작한다(서버 렌더 시 전역 fetch 를 건드리지 않는다).
 */
export const resultsRangeFetchStub = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = requestUrl(input)
  if (!url.includes('/reports/weekly')) return originalFetch(input, init)
  const payload = weeklyPayload(url)
  return Promise.resolve({ status: 200, ok: true, json: async () => payload })
}) as unknown as typeof fetch

if (typeof window !== 'undefined') globalThis.fetch = resultsRangeFetchStub

/**
 * 테스트가 다른 전역 stub 을 정리한 뒤에도 이 하네스 응답이 유지되게 다시 설치한다.
 * (설치가 모듈 스코프 1회뿐이라, 테스트마다 원복하지 않으면 앞 테스트의 stub 이 다음 테스트로 샌다.)
 */
export function restoreResultsRangeFetchStub() {
  globalThis.fetch = resultsRangeFetchStub
}

/**
 * M20 성과 화면 '직접 선택' 기간 UI 육안 검수용 하네스(ANI-1782).
 *
 * 실라우트 진입점과 같은 `R2Results` 를 게이트 폭 조건 없이 그대로 마운트하고, 로그인·서버 조회 대신
 * 위 fetch 스텁이 예시 주간 리포트를 돌려준다. 폭은 부모(검수 화면)가 정한다 — 여기서 강제하지 않는다.
 */
export function ResultsRangeHarness() {
  return (
    <div className="w-full">
      <p className="px-4 py-3 text-sm leading-relaxed text-muted-foreground">
        성과 화면의 &lsquo;직접 선택&rsquo; 버튼과 기간 고르기 창의 배치·상태를 확인하는 예시 화면입니다.
      </p>
      <WorkspaceProvider
        value={{
          workspaceId: PREVIEW_WORKSPACE_ID,
          workspaceName: '예시 가게',
          workspaceKind: null,
          membershipRole: 'owner',
          actorId: 'dev-harness',
          resolutionSource: 'membership',
        }}
      >
        <MobileR2Provider enabled>
          <R2Results workspaceId={PREVIEW_WORKSPACE_ID} />
        </MobileR2Provider>
      </WorkspaceProvider>
    </div>
  )
}
