import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ApprovalCardDevPage from './page'
import {
  FIXTURE_DECISION_ID,
  FIXTURE_WORKSPACE_ID,
  installFixtureFetch,
  type ApprovalFixtureTarget,
} from './fixture'

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  usePathname: () => '/dev/mobile-r2/approval-card',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}))

afterEach(() => vi.unstubAllEnvs())

describe('승인 카드 개발 fixture — 운영 비노출', () => {
  it('운영(production)에서는 404 로 끝난다', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    await expect(ApprovalCardDevPage()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('개발 환경에서는 고정 응답 안내와 실제 승인 도크를 그린다', async () => {
    vi.stubEnv('NODE_ENV', 'development')

    await act(async () => {
      render(await ApprovalCardDevPage())
    })

    expect(screen.getByTestId('approval-fixture-note')).toHaveTextContent('개발용 고정 응답 · 실제 서버 호출 없음')
    expect(screen.getByRole('complementary', { name: '소희 자율 에이전트 도크' })).toBeInTheDocument()
  })
})

describe('승인 카드 fixture 설치 (멱등·호출 기록)', () => {
  it('두 번 설치해도 한 번만 감싼다', () => {
    const target: ApprovalFixtureTarget = { fetch: vi.fn() as unknown as typeof fetch }

    installFixtureFetch(target)
    const once = target.fetch
    installFixtureFetch(target)

    expect(target.fetch).toBe(once)
    expect(target.__approvalFixture).toBe(true)
  })

  it('승인 POST 본문을 기록하고 고정 응답을 돌려준다', async () => {
    const target: ApprovalFixtureTarget = {}
    installFixtureFetch(target)
    const url = `/api/workspaces/${FIXTURE_WORKSPACE_ID}/agent/approvals`

    const res = await target.fetch!(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposalId: FIXTURE_DECISION_ID, action: 'APPROVE' }),
    })

    expect(res.ok).toBe(true)
    expect(await res.json()).toEqual({ approval: { actionRunId: 'run-fixture' }, executionResult: {} })
    expect(target.__approvalFixtureCalls?.at(-1)).toMatchObject({
      method: 'POST',
      url,
      body: { proposalId: 'dec-fixture-1', action: 'APPROVE' },
    })
  })
})
