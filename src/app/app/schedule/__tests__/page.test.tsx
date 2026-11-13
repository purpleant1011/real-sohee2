import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const getCurrentWorkspaceContext = vi.fn()
const getScheduleBoard = vi.fn()
const getSocialPostPreviews = vi.fn()
const readWorkspaceDataset = vi.fn()

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT' })
  }),
}))

vi.mock('@/features/auth/current-workspace', () => ({
  getCurrentWorkspaceContext: () => getCurrentWorkspaceContext(),
}))

vi.mock('@/features/schedule/repository', () => ({
  getScheduleBoard: (...args: unknown[]) => getScheduleBoard(...args),
}))

vi.mock('@/features/social-post-preview/repository', () => ({
  getSocialPostPreviews: (...args: unknown[]) => getSocialPostPreviews(...args),
}))

vi.mock('@/features/reports/report-decision-repository', () => ({
  createProductionReportDecisionRepository: async () => null,
}))

vi.mock('@/features/reporting/dataset', () => ({
  readWorkspaceDataset: (...args: unknown[]) => readWorkspaceDataset(...args),
}))

// workspace_registry 는 service_role 전용이다. admin 클라이언트가 실제로 쓰이는지 식별하기 위해 sentinel 을 둔다.
const ADMIN_SENTINEL = { kind: 'service-role-admin' }
const createAdminSupabaseClient = vi.fn(() => ADMIN_SENTINEL)
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => createAdminSupabaseClient(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    from: (table: string) => {
      const q: any = {
        select: () => q,
        eq: () => q,
        in: () => q,
        order: () => q,
        limit: async () => ({ data: [], error: null }),
        maybeSingle: async () => (table === 'workspaces' ? { data: { timezone: 'Asia/Seoul' }, error: null } : { data: null, error: null }),
      }
      return q
    },
  }),
}))

vi.mock('../schedule-entry', () => ({
  ScheduleEntry: ({ ledger }: { ledger: { loadState: string; entries: unknown[] } | null }) => (
    <div data-testid="schedule-entry">{`${ledger?.loadState ?? 'null'}:${ledger?.entries.length ?? 0}`}</div>
  ),
}))

import SchedulePage from '../page'

const WS = '11111111-1111-4111-8111-111111111111'

const EMPTY_BOARD = {
  source: 'actual',
  partialData: false,
  unavailableSources: [],
  ready: [],
  plans: [],
  schedules: [],
  attempts: [],
  customerReservations: [],
  localPublishes: [],
  internalTasks: [],
}

describe('/app/schedule — datasetMode fail-closed 연결', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('MOBILE_R2_UI_ENABLED', '1')
    vi.stubEnv('MOBILE_R2_UI_WORKSPACE_ALLOWLIST', WS)
    getCurrentWorkspaceContext.mockResolvedValue({ workspaceId: WS, role: 'owner' })
    getScheduleBoard.mockResolvedValue({ data: EMPTY_BOARD })
    getSocialPostPreviews.mockResolvedValue([])
    readWorkspaceDataset.mockResolvedValue({ mode: 'ACTUAL', state: 'OBSERVED' })
  })
  afterEach(() => vi.unstubAllEnvs())

  it('registry 가 ACTUAL 이면 장부가 ready 로 그려진다', async () => {
    render(await SchedulePage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByTestId('schedule-entry')).toHaveTextContent('ready:0')
  })

  it('F1 회귀: registry 분류는 사용자 RLS 클라이언트가 아니라 service_role admin 으로 읽는다', async () => {
    render(await SchedulePage({ searchParams: Promise.resolve({}) }))
    expect(createAdminSupabaseClient).toHaveBeenCalled()
    const usedClient = readWorkspaceDataset.mock.calls.at(-1)?.[0]
    expect(usedClient).toBe(ADMIN_SENTINEL)
    // RLS 사용자 클라이언트로 registry 를 읽지 않는다(= 전 매장 error 회귀 방지).
    expect(usedClient).not.toBeUndefined()
    expect(screen.getByTestId('schedule-entry')).toHaveTextContent('ready:0')
  })

  it('admin 클라이언트 생성이 실패하면(키 없음) ACTUAL 로 추정하지 않고 error 로 닫는다', async () => {
    createAdminSupabaseClient.mockImplementationOnce(() => {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY missing')
    })
    render(await SchedulePage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByTestId('schedule-entry')).toHaveTextContent('error:0')
  })

  it('readWorkspaceDataset 이 null 을 반환하면(불명) 장부를 error 로 닫는다', async () => {
    readWorkspaceDataset.mockResolvedValue(null)
    render(await SchedulePage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByTestId('schedule-entry')).toHaveTextContent('error:0')
  })

  it('readWorkspaceDataset 이 ERROR 를 반환하면 장부를 error 로 닫는다', async () => {
    readWorkspaceDataset.mockResolvedValue({ mode: 'UNKNOWN', state: 'ERROR' })
    render(await SchedulePage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByTestId('schedule-entry')).toHaveTextContent('error:0')
  })

  it('readWorkspaceDataset 이 비-ACTUAL(EXCLUDED) 이면 장부를 error 로 닫는다', async () => {
    readWorkspaceDataset.mockResolvedValue({ mode: 'EXCLUDED', state: 'NOT_OBSERVED' })
    render(await SchedulePage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByTestId('schedule-entry')).toHaveTextContent('error:0')
  })
})
