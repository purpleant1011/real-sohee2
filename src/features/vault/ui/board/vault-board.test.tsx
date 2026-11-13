import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VaultBoard } from './vault-board'
import type { VaultBoardData } from './vault-board'
import { sampleFixtures, samples } from '@/app/dev/vault-board/samples'
import { createStaticVaultFetch } from './static-vault-api'

const fixture: VaultBoardData = {
  items: { items: [
    { item_ref: 'private-reference', channel: 'instagram', channel_label: '인스타그램', status_label: '발행 준비 완료 · 외부 게시 전', hold_reason_label: '사용자 보류', target_date: '2026-10-08', held_at: '2026-10-07', created_at: '2026-10-07', updated_at: '2026-10-07' },
    { item_ref: 'another-reference', channel: 'naver_blog', channel_label: '네이버 블로그', status_label: '재확인 필요', hold_reason_label: '재승인 필요', target_date: null, held_at: null, created_at: '2026-10-07', updated_at: '2026-10-07' },
  ], nextCursor: null, hasMore: false },
  calendar: { ym: '2026-10', days: { '2026-10-08': { total: 2, channels: { instagram: 1, naver_blog: 1 } } }, unscheduled_count: 1 },
  summary: { stored_count: 1, needs_reapproval_count: 1, invalidated_count: 0, total_count: 2, external_action_count: 0, external_action_warning: null },
}

function respond(data: unknown) {
  return { ok: true, json: async () => ({ success: true, data }) } as Response
}

function mockApi(data: VaultBoardData = fixture) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/items')) return respond(data.items)
    if (url.includes('/calendar')) return respond(data.calendar)
    if (url.includes('/summary')) return respond(data.summary)
    throw new Error('unexpected URL')
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-08T12:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('보관함 화면', () => {
  it('조회 중에는 스켈레톤을 보여주고 서버 값이 도착하면 실집계 및 사용자용 문구만 표시한다', async () => {
    let release!: (value: Response) => void
    const pending = new Promise<Response>((resolve) => { release = resolve })
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => String(input).includes('/items') ? pending : mockApi()(input)))
    render(<VaultBoard workspaceId="workspace-id" />)
    expect(screen.getByRole('status', { name: '보관함 불러오는 중' })).toBeInTheDocument()
    release(respond(fixture.items))
    expect(await screen.findByText('발행 준비 완료 · 외부 게시 전')).toBeInTheDocument()
    expect(screen.getByText('외부 게시 0건')).toBeInTheDocument()
    expect(screen.getByText('보관 1건')).toBeInTheDocument()
    expect(screen.getByText('재확인 필요 1건')).toBeInTheDocument()
    expect(screen.getByText('사용자 보류')).toBeInTheDocument()
    expect(screen.getByText('2026년 10월 8일')).toBeInTheDocument()
    expect(screen.queryByText('private-reference')).not.toBeInTheDocument()
    expect(screen.queryByText('예약됨')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '미리보기 스튜디오' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /미리보기 스튜디오로 이동/ })).not.toBeInTheDocument()
  })

  it('조회 실패는 빈 상태로 오인하지 않고 재시도하여 복구한다', async () => {
    const success = mockApi()
    let fail = true
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => fail ? Promise.resolve({ ok: false, status: 500 } as Response) : success(input)))
    render(<VaultBoard workspaceId="workspace-id" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('보관함을 불러오지 못했어요')
    expect(screen.queryByText('보관한 콘텐츠가 아직 없어요')).not.toBeInTheDocument()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByText('발행 준비 완료 · 외부 게시 전')).toBeInTheDocument()
  })

  it('정상적인 0건 응답에는 빈 상태 안내와 실제 외부 게시 0건을 표시한다', async () => {
    vi.stubGlobal('fetch', mockApi({ ...fixture, items: { items: [], nextCursor: null, hasMore: false }, summary: { ...fixture.summary, stored_count: 0, needs_reapproval_count: 0, total_count: 0 } }))
    render(<VaultBoard workspaceId="workspace-id" />)
    expect(await screen.findByText('보관한 콘텐츠가 아직 없어요')).toBeInTheDocument()
    expect(screen.getByText('외부 게시 0건')).toBeInTheDocument()
  })

  it('기간 전환 시 API 기간 파라미터를 바꾸고, 월간 달력에 날짜 건수와 채널 분포를 표시한다', async () => {
    const api = mockApi()
    vi.stubGlobal('fetch', api)
    render(<VaultBoard workspaceId="workspace-id" />)
    await screen.findByText('발행 준비 완료 · 외부 게시 전')
    fireEvent.click(screen.getByRole('button', { name: '이번 주' }))
    await waitFor(() => expect(api.mock.calls.some(([url]) => String(url).includes('period=this_week'))).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: '월간' }))
    const calendar = await screen.findByRole('region', { name: '월간 보관 달력' })
    expect(within(calendar).getByText('8')).toBeInTheDocument()
    expect(within(calendar).getByText('2건')).toBeInTheDocument()
    expect(within(calendar).getAllByText('인스타그램 1건 · 네이버 블로그 1건')).toHaveLength(2)
    expect(within(calendar).getByRole('list', { name: '모바일 월간 일정' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다음 달' }))
    await waitFor(() => expect(api.mock.calls.some(([url]) => String(url).includes('ym=2026-11'))).toBe(true))
  })

  it('외부 게시 값이 0이 아니면 서버 값 그대로 표시하고 내부 문구 대신 안전한 경고를 알린다', async () => {
    vi.stubGlobal('fetch', mockApi({ ...fixture, summary: { ...fixture.summary, external_action_count: 3, external_action_warning: 'internal_action UUID exposed' } }))
    render(<VaultBoard workspaceId="workspace-id" />)
    expect(await screen.findByText('외부 게시 3건')).toBeInTheDocument()
    // The release panel can also report a connection error while the vault warning is visible.
    expect(await screen.findByText('연결 상태를 가져오지 못했어요. 다시 시도해 주세요')).toHaveAttribute('role', 'alert')
    expect(screen.getByText('보관 중 외부 게시 기록이 감지됐어요. 관리자에게 확인해 주세요.')).toHaveAttribute('role', 'alert')
    expect(screen.queryByText(/internal_action/)).not.toBeInTheDocument()
  })

  it('상류 보안 개입 상태가 차단이면 서버 안내를 보관함에 표시한다', () => {
    render(<VaultBoard initialData={{ ...fixture, summary: { ...fixture.summary, intervention: { blocked: true, label: '발행이 잠시 멈췄어요', detail: '관리자 확인 후 다시 이용할 수 있어요.' } } }} />)
    expect(screen.getByRole('status')).toHaveTextContent('발행이 잠시 멈췄어요')
    expect(screen.getByText('관리자 확인 후 다시 이용할 수 있어요.')).toBeInTheDocument()
  })

  it('카드에서 저장된 variant 상세를 열고 닫으면 키보드 초점이 미리보기 버튼으로 돌아간다', async () => {
    render(<VaultBoard initialData={samples} fetchFn={createStaticVaultFetch(sampleFixtures)} />)
    const opener = screen.getByRole('button', { name: '네이버 블로그 시간 미정 미리보기' })
    opener.focus()
    fireEvent.click(opener)
    const dialog = await screen.findByRole('dialog', { name: '네이버 블로그 보관 글' })
    expect(within(dialog).getByRole('heading', { name: '미리보기' })).toBeInTheDocument()
    await waitFor(() => expect(within(dialog).getByLabelText('본문 블록')).toHaveTextContent('밤 라떼와 고구마 케이크를 가장 먼저 만나 보세요.'))
    fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('페이지네이션으로 추가 항목을 불러와 합치고 기존 카드를 유지한다', async () => {
    const first = { ...fixture, items: { items: [fixture.items.items[0]], nextCursor: 'secret-cursor', hasMore: true } }
    const api = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/items')) return Promise.resolve(respond(url.includes('cursor=') ? { items: [fixture.items.items[1]], nextCursor: null, hasMore: false } : first.items))
      return mockApi()(input)
    })
    vi.stubGlobal('fetch', api)
    render(<VaultBoard workspaceId="workspace-id" />)
    await screen.findByText('발행 준비 완료 · 외부 게시 전')
    fireEvent.click(screen.getByRole('button', { name: '더 보기' }))
    expect(await screen.findByText('재확인 필요', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('발행 준비 완료 · 외부 게시 전')).toBeInTheDocument()
    expect(screen.queryByText('secret-cursor')).not.toBeInTheDocument()
  })
})
