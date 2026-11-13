// @vitest-environment jsdom
import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/features/auth/actions', () => ({ signOutAction: vi.fn() }))
vi.mock('@/features/pwa/sw-client', () => ({ clearPwaCaches: vi.fn() }))
import { render, screen } from '@testing-library/react'
import { MobileMoreView } from './more-view'
import { MORE_GROUP_LABEL, MORE_MENU_ITEMS } from './more-model'

const NOW = '2026-10-23T09:00:00.000Z'
const snapshot = {
  loadState: 'ready' as const,
  workspaceId: 'a',
  now: NOW,
  checkedAt: NOW,
  lastReauthAt: NOW,
  workspaces: [{ id: 'a', name: '바이름 청라', role: 'owner' as const }],
  sections: [
    { id: 'channels' as const, status: 'ok' as const, summary: null },
    { id: 'billing' as const, status: 'attention' as const, summary: null },
  ],
  privacy: { export: 'none' as const, withdraw: 'none' as const },
}

describe('더보기 메뉴 그룹 재편 (S2-W4)', () => {
  it('5개 그룹([우리 가게], [연결], [요금·결제], [알림·계정], [도움]) 1줄 제목이 모두 노출된다', () => {
    render(<MobileMoreView snapshot={snapshot} />)
    const headings = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)
    expect(headings).toContain(MORE_GROUP_LABEL.store)
    expect(headings).toContain(MORE_GROUP_LABEL.channels)
    expect(headings).toContain(MORE_GROUP_LABEL.billing)
    expect(headings).toContain(MORE_GROUP_LABEL.account)
    expect(headings).toContain(MORE_GROUP_LABEL.help)
  })

  it('각 항목은 아이콘+한 줄 이름으로 노출되고, 항목 설명 문장은 제거된다', () => {
    render(<MobileMoreView snapshot={snapshot} />)
    // 항목 이름 확인
    expect(screen.getByText('가게 정보')).toBeInTheDocument()
    expect(screen.getByText('사진/말투')).toBeInTheDocument()
    expect(screen.getByText('채널 연결')).toBeInTheDocument()
    expect(screen.getByText('이용 요금')).toBeInTheDocument()
    expect(screen.getByText('알림 설정')).toBeInTheDocument()
    expect(screen.getByText('개인정보 관리')).toBeInTheDocument()
    expect(screen.getByText('도움말')).toBeInTheDocument()
    expect(screen.getByText('약관')).toBeInTheDocument()
    expect(screen.getByText('개인정보처리방침')).toBeInTheDocument()

    // 이전 설명 문장들이 없어야 함
    expect(screen.queryByText('가르치고 목표 정하기')).toBeNull()
    expect(screen.queryByText('댓글·메시지 문의 답하기')).toBeNull()
    expect(screen.queryByText('브랜드와 말투 기준')).toBeNull()
  })

  it('이미 존재하는 라우트만 연결하고 없는 것은 항목을 만들지 않는다 (결제 내역, 문의하기 미생성)', () => {
    render(<MobileMoreView snapshot={snapshot} />)
    // 메뉴 목록 섹션 안에 라우트 없는 결제 내역, 문의하기는 항목으로 존재하지 않음
    const helpSection = screen.getByRole('region', { name: MORE_GROUP_LABEL.help })
    const billingSection = screen.getByRole('region', { name: MORE_GROUP_LABEL.billing })

    expect(screen.queryByText('결제 내역')).toBeNull()
    expect(billingSection.textContent).not.toContain('결제 내역')
    expect(helpSection.textContent).not.toContain('문의하기')

    // 모든 정의된 메뉴 항목의 라우트가 실제로 파일시스템에 존재하는지 확인
    for (const item of MORE_MENU_ITEMS) {
      const routePath = item.href.replace(/^\//, '').split('?')[0]
      const dir = path.resolve(process.cwd(), 'src/app', routePath)
      const isPublicRoute = existsSync(path.resolve(process.cwd(), 'src/app/(public)', routePath))
      const isAppRoute = existsSync(dir)
      expect(isAppRoute || isPublicRoute, `${item.href} 페이지가 존재해야 함`).toBe(true)
    }
  })

  it('도움말 항목이 /app/help로 연결된다', () => {
    render(<MobileMoreView snapshot={snapshot} />)
    const helpItem = screen.getByRole('link', { name: /도움말/ })
    expect(helpItem).toHaveAttribute('href', '/app/help')
  })
})
