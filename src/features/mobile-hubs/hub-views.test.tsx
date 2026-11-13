// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MobileWorkHub } from './work-hub-view'
import { MobileMoreHub } from './more-hub-view'
import type { HubEntry, MoreHubSnapshot, WorkHubSnapshot } from './hub-model'
import type { WorkRow } from '@/features/mobile-hub/work-items'

function row(overrides: Partial<WorkRow> = {}): WorkRow {
  return {
    id: 'w-1',
    title: '금요일 신메뉴 홍보',
    status: 'review',
    rawState: 'waiting_for_approval',
    statusLabel: '검토 중',
    channelLabel: '인스타그램',
    href: '/app/work/w-1',
    publishedUrl: null,
    isApproved: false,
    createdAt: '2026-10-23T01:00:00.000Z',
    ...overrides,
  }
}

function entry(overrides: Partial<HubEntry> = {}): HubEntry {
  return {
    id: 'content',
    label: '작업 목록',
    description: '초안부터 게시 확인까지 모아 봐요.',
    href: '/app/content',
    count: { value: 3, unit: '건' },
    needsAttention: false,
    ...overrides,
  }
}

function workSnapshot(overrides: Partial<WorkHubSnapshot> = {}): WorkHubSnapshot {
  return {
    loadState: 'ready',
    checkedAt: '2026-10-24T00:00:00.000Z',
    entries: [
      entry(),
      entry({ id: 'notifications', label: '알림함', description: '새 소식과 확인할 일을 봐요.', href: '/app/notifications', count: { value: 2, unit: '건' }, needsAttention: true }),
    ],
    recent: [row()],
    ...overrides,
  }
}

function moreSnapshot(overrides: Partial<MoreHubSnapshot> = {}): MoreHubSnapshot {
  return {
    loadState: 'ready',
    checkedAt: '2026-10-24T00:00:00.000Z',
    entries: [
      entry({ id: 'channels', label: '채널 연결', description: '인스타그램·블로그 연결 상태를 봐요.', href: '/app/channels', count: { value: 1, unit: '곳' }, needsAttention: true }),
      entry({ id: 'credits', label: '크레딧', description: '남은 크레딧과 사용 내역을 봐요.', href: '/app/account/credits', count: { value: 42, unit: '개' } }),
      entry({ id: 'memory', label: '가게 기억', description: '소희가 기억할 내용을 확인해요.', href: '/app/memory', count: { value: 2, unit: '건' } }),
      entry({ id: 'settings', label: '설정', description: '가게 정보와 계정을 관리해요.', href: '/app/account', count: null }),
    ],
    ...overrides,
  }
}

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('M11 작업 탭 허브', () => {
  it('작업 목록·알림함 진입과 소희와의 대화 시작을 한 화면에 보여준다', () => {
    render(<MobileWorkHub snapshot={workSnapshot()} />)

    expect(screen.getByRole('heading', { level: 1, name: '작업' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /대화 열기/ }).getAttribute('href')).toBe('/app/command')
    expect(screen.getByRole('link', { name: /작업 목록/ }).getAttribute('href')).toBe('/app/content')
    expect(screen.getByRole('link', { name: /알림함/ }).getAttribute('href')).toBe('/app/notifications')
  })

  it('개수를 확인하지 못하면 0건이 아니라 확인하지 못했다고 보여준다', () => {
    const { container } = render(<MobileWorkHub snapshot={workSnapshot({
      entries: [entry({ count: { value: null, unit: '건' } })],
    })} />)

    expect(container.textContent).toContain('개수를 확인하지 못했어요')
    expect(container.textContent).not.toContain('0건')
  })

  it('조회에 실패하면 진입 목록을 그리지 않고 실패 상태를 보여준다', () => {
    const { container } = render(<MobileWorkHub snapshot={workSnapshot({ loadState: 'error' })} />)

    expect(container.textContent).toContain('불러오지 못했어요')
    expect(screen.queryByRole('link', { name: /작업 목록/ })).toBeNull()
  })

  it('최근 작업은 3건까지만 보여준다', () => {
    const many = [1, 2, 3, 4, 5].map(n => row({ id: `w-${n}`, title: `작업 ${n}`, href: `/app/work/w-${n}` }))
    render(<MobileWorkHub snapshot={workSnapshot({ recent: many })} />)

    expect(screen.getAllByRole('link', { name: /^작업 \d/ })).toHaveLength(3)
  })

  it('스냅샷만 그린다 — 서버 요청을 보내지 않는다', () => {
    render(<MobileWorkHub snapshot={workSnapshot()} />)

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('M25 더보기 탭 허브', () => {
  it('채널·크레딧·가게 기억·설정 진입을 순서대로 보여준다', () => {
    render(<MobileMoreHub snapshot={moreSnapshot()} />)

    expect(screen.getByRole('heading', { level: 1, name: '더보기' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /채널 연결/ }).getAttribute('href')).toBe('/app/channels')
    expect(screen.getByRole('link', { name: /크레딧/ }).getAttribute('href')).toBe('/app/account/credits')
    expect(screen.getByRole('link', { name: /가게 기억/ }).getAttribute('href')).toBe('/app/memory')
    expect(screen.getByRole('link', { name: /^설정/ }).getAttribute('href')).toBe('/app/account')
  })

  it('개수 개념이 없는 항목에는 개수 문구를 붙이지 않는다', () => {
    const { container } = render(<MobileMoreHub snapshot={moreSnapshot()} />)

    const settings = screen.getByRole('link', { name: /^설정/ })
    expect(settings.textContent).not.toContain('개수를 확인하지 못했어요')
    expect(container.textContent).toContain('42개')
  })

  it('조회에 실패하면 빈 목록 대신 실패 상태를 보여준다', () => {
    const { container } = render(<MobileMoreHub snapshot={moreSnapshot({ loadState: 'unknown' })} />)

    expect(container.textContent).toContain('불러오지 못했어요')
    expect(screen.queryByRole('link', { name: /채널 연결/ })).toBeNull()
  })

  it('스냅샷만 그린다 — 서버 요청을 보내지 않는다', () => {
    render(<MobileMoreHub snapshot={moreSnapshot()} />)

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
