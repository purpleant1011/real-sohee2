import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { notFound, redirect } from 'next/navigation'

const getCurrentWorkspaceContext = vi.fn()
const limit = vi.fn()

// 실제 런타임처럼 제어 흐름을 끊는다(모킹만 하고 계속 진행하면 게이트 뒤 코드가 실행된다).
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw Object.assign(new Error('NEXT_NOT_FOUND'), { digest: 'NEXT_NOT_FOUND' })
  }),
  redirect: vi.fn(() => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT' })
  }),
}))

vi.mock('@/features/auth/current-workspace', () => ({
  getCurrentWorkspaceContext: () => getCurrentWorkspaceContext(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          gt: () => ({
            neq: () => ({
              order: () => ({ limit }),
            }),
          }),
        }),
      }),
    }),
  }),
}))

vi.mock('../deposits-entry', () => ({
  DepositsEntry: ({ snapshot }: { snapshot: { loadState: string; deposits: unknown[] } }) => (
    <div data-testid="deposits-entry">{`${snapshot.loadState}:${snapshot.deposits.length}`}</div>
  ),
}))

const readWorkspaceDataset = vi.fn()
vi.mock('@/features/reporting/dataset', () => ({
  readWorkspaceDataset: (...args: unknown[]) => readWorkspaceDataset(...args),
}))

// workspace_registry 는 service_role 전용이다. admin 클라이언트가 실제로 쓰이는지 식별하기 위해 sentinel 을 둔다.
const ADMIN_SENTINEL = { kind: 'service-role-admin' }
const createAdminSupabaseClient = vi.fn(() => ADMIN_SENTINEL)
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => createAdminSupabaseClient(),
}))

import SchedulePaymentsPage from '../page'

const WS = '11111111-1111-4111-8111-111111111111'

const workspace = { workspaceId: WS, role: 'owner', status: 'active' }

const enable = () => {
  vi.stubEnv('MOBILE_R2_UI_ENABLED', '1')
  vi.stubEnv('MOBILE_R2_UI_WORKSPACE_ALLOWLIST', WS)
}

describe('M16 /app/schedule/payments gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getCurrentWorkspaceContext.mockResolvedValue(workspace)
    readWorkspaceDataset.mockResolvedValue({ mode: 'ACTUAL', state: 'OBSERVED' })
    limit.mockResolvedValue({ data: [{ id: 'res_1', workspace_id: WS, deposit_krw: 30000, status: 'CONFIRMED' }], error: null })
  })
  afterEach(() => vi.unstubAllEnvs())

  it('워크스페이스가 없으면 온보딩으로 보낸다', async () => {
    getCurrentWorkspaceContext.mockResolvedValue(null)
    await expect(SchedulePaymentsPage()).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/app/onboarding')
    expect(limit).not.toHaveBeenCalled()
  })

  it('플래그 OFF(기본)면 이 경로는 존재하지 않는다 — 예약 장부도 읽지 않는다', async () => {
    vi.stubEnv('MOBILE_R2_UI_ENABLED', '0')
    await expect(SchedulePaymentsPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
    expect(limit).not.toHaveBeenCalled()
  })

  it('allowlist 밖 매장도 플래그 ON 이어도 화면을 열지 않는다', async () => {
    vi.stubEnv('MOBILE_R2_UI_ENABLED', '1')
    vi.stubEnv('MOBILE_R2_UI_WORKSPACE_ALLOWLIST', 'other-workspace')
    await expect(SchedulePaymentsPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
    expect(limit).not.toHaveBeenCalled()
  })

  it('플래그 ON + allowlist 매장이면 읽기 스냅샷으로 화면을 그린다', async () => {
    enable()
    render(await SchedulePaymentsPage())
    expect(notFound).not.toHaveBeenCalled()
    expect(screen.getByTestId('deposits-entry')).toHaveTextContent('ready:1')
  })

  it('오류가 없어도 목록이 null 이면 관측된 빈 목록으로 만들지 않는다', async () => {
    enable()
    limit.mockResolvedValue({ data: null, error: null })
    render(await SchedulePaymentsPage())
    expect(screen.getByTestId('deposits-entry')).toHaveTextContent('error:0')
  })

  it('예약 장부 조회가 실패하면 빈 목록이 아니라 실패 스냅샷을 넘긴다', async () => {
    enable()
    limit.mockResolvedValue({ data: null, error: { message: 'boom' } })
    render(await SchedulePaymentsPage())
    expect(screen.getByTestId('deposits-entry')).toHaveTextContent('error:0')
  })

  it('F1 회귀: registry 분류는 사용자 RLS 클라이언트가 아니라 service_role admin 으로 읽는다', async () => {
    enable()
    render(await SchedulePaymentsPage())
    expect(createAdminSupabaseClient).toHaveBeenCalled()
    expect(readWorkspaceDataset.mock.calls.at(-1)?.[0]).toBe(ADMIN_SENTINEL)
    expect(screen.getByTestId('deposits-entry')).toHaveTextContent('ready:1')
  })

  it('admin 클라이언트 생성이 실패하면(키 없음) ACTUAL 로 추정하지 않고 error 로 닫는다', async () => {
    enable()
    createAdminSupabaseClient.mockImplementationOnce(() => {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY missing')
    })
    render(await SchedulePaymentsPage())
    expect(screen.getByTestId('deposits-entry')).toHaveTextContent('error:0')
  })

  it('readWorkspaceDataset 이 null 을 반환하면(불명) 예약금 rows 가 있어도 error 로 닫힌다', async () => {
    enable()
    readWorkspaceDataset.mockResolvedValue(null)
    render(await SchedulePaymentsPage())
    expect(screen.getByTestId('deposits-entry')).toHaveTextContent('error:0')
  })

  it('readWorkspaceDataset 이 ERROR 를 반환하면 error 스냅샷으로 닫힌다', async () => {
    enable()
    readWorkspaceDataset.mockResolvedValue({ mode: 'UNKNOWN', state: 'ERROR' })
    render(await SchedulePaymentsPage())
    expect(screen.getByTestId('deposits-entry')).toHaveTextContent('error:0')
  })

  it('readWorkspaceDataset 이 SHOWCASE_DEMO 를 반환하면 error 스냅샷으로 닫힌다', async () => {
    enable()
    readWorkspaceDataset.mockResolvedValue({ mode: 'EXCLUDED', state: 'NOT_OBSERVED' })
    render(await SchedulePaymentsPage())
    expect(screen.getByTestId('deposits-entry')).toHaveTextContent('error:0')
  })
})
