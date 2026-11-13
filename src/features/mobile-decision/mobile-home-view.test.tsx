import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { MobileHomeView } from './mobile-home-view'
import { ready } from './contracts'
import { makeMobileHome, fixtureItemKey, fixtureTime } from './test-fixtures'

function autonomyPayload(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: 'fixture-ws', desiredMode: 'RUNNING', actualMode: 'RUNNING',
    activeActionRunCount: 0, killSwitchActive: false, version: 4, updated_at: fixtureTime,
    ...overrides,
  }
}

describe('decision-first mobile home', () => {
  let calls: string[]

  beforeEach(() => {
    calls = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return { ok: true, status: 200, json: async () => autonomyPayload() }
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows all-clear only on a complete successful empty query', () => {
    const view = makeMobileHome()
    const result = render(<MobileHomeView view={view} onRefresh={() => {}} onDelegate={() => {}} />)
    expect(screen.getByText('지금 확인하실 일은 없어요')).toBeVisible()
    result.rerender(<MobileHomeView view={{ ...view, decisions: { ...view.decisions, state: 'error', data: null } }} onRefresh={() => {}} onDelegate={() => {}} />)
    expect(screen.queryByText('지금 확인하실 일은 없어요')).not.toBeInTheDocument()
    expect(screen.getByText('확인할 일을 불러오지 못했어요')).toBeVisible()
    expect(screen.getByText('잠시 후 다시 확인해 주세요. 없는 것으로 보지는 않아요.')).toBeVisible()
  })
  it('핵심 카드(lead)가 있고 확인할 일이 1건 이하면 같은 항목을 목록으로 다시 그리지 않는다', () => {
    const view = makeMobileHome()
    render(<MobileHomeView view={view} onRefresh={() => {}} onDelegate={() => {}} lead={<p>핵심 카드</p>} afterStatus={<p>바로가기 자리</p>} />)
    expect(screen.getByText('핵심 카드')).toBeVisible()
    expect(screen.getByText('바로가기 자리')).toBeVisible()
    expect(screen.queryByRole('region', { name: '필요한 결정' })).not.toBeInTheDocument()
  })
  it('opens a read-only detail, not direct dispatch, and clearly disables photo generation', () => {
    const view = makeMobileHome()
    view.decisions.data = { total: 1, complete: true, items: [{ id: fixtureItemKey, kind: 'dm_reply', title: '예약 문의를 확인해 주세요', targetLabel: '테스트 고객', createdAt: view.generatedAt, expiresAt: null }] }
    let delegated = false
    render(<MobileHomeView view={view} onRefresh={() => {}} onDelegate={() => { delegated = true }} />)
    expect(screen.getByRole('link', { name: /예약 문의를 확인해 주세요/ })).toHaveAttribute('href', `/app/approvals?item=${encodeURIComponent(fixtureItemKey)}`)
    expect(screen.queryByRole('button', { name: '사진 업로드 연결 준비 중' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '소희에게 소식 맡기기' }))
    expect(delegated).toBe(true)
    expect(screen.queryByText(/790,000/)).not.toBeInTheDocument()
  })
  it('mounts autonomy control in the real home and renders only the server readback', async () => {
    render(<MobileHomeView view={makeMobileHome()} onRefresh={() => {}} onDelegate={() => {}} />)
    expect(screen.getByRole('region', { name: '소희 일하기' })).toBeVisible()
    expect(await screen.findByRole('button', { name: '잠시 멈추기' })).toBeVisible()
    expect(calls).toEqual(['/api/workspaces/fixture-ws/agent/control'])
  })
  it('keeps recent-work empty, unknown and failed states distinct', () => {
    const view = makeMobileHome()
    const props = { onRefresh: () => {}, onDelegate: () => {} }
    const result = render(<MobileHomeView view={view} {...props} />)
    expect(screen.getByText(/업무 기록 연결을 확인하고 있어요/)).toBeVisible()

    result.rerender(<MobileHomeView view={{ ...view, activity: ready([], fixtureTime) }} {...props} />)
    expect(screen.getByText('아직 최근 작업 기록이 없어요. 첫 소식을 맡기면 여기에 기록돼요.')).toBeVisible()
    expect(screen.queryByText(/업무 기록 연결을 확인하고 있어요/)).not.toBeInTheDocument()

    result.rerender(<MobileHomeView view={{ ...view, activity: { state: 'error', data: null, observedAt: null, validUntil: null } }} {...props} />)
    expect(screen.getByText('업무 기록을 불러오지 못했어요')).toBeVisible()
    expect(screen.getByRole('button', { name: '다시 확인하기' })).toBeVisible()
    expect(screen.queryByText('아직 최근 작업 기록이 없어요. 첫 소식을 맡기면 여기에 기록돼요.')).not.toBeInTheDocument()
  })
  it('renders real recent work with its stored status and keeps only the newest three', () => {
    const view = makeMobileHome()
    view.activity = ready([
      { id: 'content:1', title: '가을 홍보 문안', statusLabel: '승인 대기', observedAt: fixtureTime, evidenceRef: null },
      { id: 'content:2', title: '주말 예약 안내', statusLabel: '게시 완료', observedAt: fixtureTime, evidenceRef: null },
      { id: 'content:3', title: '신메뉴 소개', statusLabel: '초안 준비', observedAt: fixtureTime, evidenceRef: null },
      { id: 'content:4', title: '네 번째 작업', statusLabel: '승인 완료', observedAt: fixtureTime, evidenceRef: null },
    ], fixtureTime)
    render(<MobileHomeView view={view} onRefresh={() => {}} onDelegate={() => {}} />)
    expect(screen.getByText('가을 홍보 문안')).toBeVisible()
    expect(screen.getByText('승인 대기')).toBeVisible()
    expect(screen.queryByText('네 번째 작업')).not.toBeInTheDocument()
  })
  it('hides unconfirmed current state and offers a server recheck instead of guessing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
    render(<MobileHomeView view={makeMobileHome()} onRefresh={() => {}} onDelegate={() => {}} />)
    expect(await screen.findByText('소희 일하기 상태를 확인하지 못했어요. 최신 상태를 다시 확인해 주세요.')).toBeVisible()
    expect(screen.getByRole('button', { name: '최신 상태 다시 확인' })).toBeVisible()
  })
})

/**
 * ANI-1770 잔여 — R2 홈의 '일하는 방식 보기' CTA.
 * R2(플래그 ON·767px 이하)에서만 M24 자율근무 화면으로 가고, PC·플래그 OFF 는 기존 경로 그대로다.
 */
describe('업무 제어 CTA 는 R2 에서만 자율근무 화면으로 간다', () => {
  const props = { onRefresh: () => {}, onDelegate: () => {} }

  /** 이 화면이 쓰는 질의(`max-width`)만 실제 px 로 판정한다. */
  function stubWidth(px: number) {
    vi.stubGlobal('matchMedia', (query: string) => {
      const max = /\(max-width:\s*(\d+)px\)/.exec(query)
      return {
        matches: max !== null && px <= Number(max[1]),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }
    })
  }

  const cta = () => screen.getByRole('link', { name: /일하는 방식 보기/ })

  it('플래그 OFF 면 기존 경로 그대로다', () => {
    render(<MobileHomeView view={makeMobileHome()} {...props} />)
    expect(cta()).toHaveAttribute('href', '/app/sohee?tab=work&section=autonomy')
  })

  it('플래그 ON 이어도 넓은 화면(1440)은 기존 경로다', () => {
    stubWidth(1440)
    render(<MobileR2Provider enabled><MobileHomeView view={makeMobileHome()} {...props} /></MobileR2Provider>)
    expect(cta()).toHaveAttribute('href', '/app/sohee?tab=work&section=autonomy')
  })

  it('플래그 ON + 390px 은 M24 자율근무 화면으로 간다', () => {
    stubWidth(390)
    render(<MobileR2Provider enabled><MobileHomeView view={makeMobileHome()} {...props} /></MobileR2Provider>)
    expect(cta()).toHaveAttribute('href', '/app/account/automation')
  })
})
