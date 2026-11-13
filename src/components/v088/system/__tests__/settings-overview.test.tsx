import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsOverview } from '../settings-overview'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/system',
  useSearchParams: () => new URLSearchParams(),
}))

describe('SettingsOverview (PC 설정 홈 그룹형 목록)', () => {
  it('5대 그룹(우리 가게, 연결, 요금·결제, 알림·계정, 도움) 레이블을 순서대로 노출한다', () => {
    render(<SettingsOverview />)

    const expectedGroups = ['우리 가게', '연결', '요금·결제', '알림·계정', '도움']
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent?.trim())

    for (const group of expectedGroups) {
      expect(headings).toContain(group)
    }

    const groupIndices = expectedGroups.map((g) => headings.indexOf(g))
    for (let i = 0; i < groupIndices.length - 1; i++) {
      expect(groupIndices[i]).toBeLessThan(groupIndices[i + 1])
    }
  })

  it('SETTINGS_GROUPS의 주요 링크들이 모두 접근 가능하게 렌더링된다', () => {
    render(<SettingsOverview />)

    // 우리 가게
    expect(screen.getByRole('link', { name: /가게 기본 정보/ })).toHaveAttribute('href', '/app/settings/business')
    expect(screen.getByRole('link', { name: /사진\/말투 기준/ })).toHaveAttribute('href', '/app/settings/brand')
    expect(screen.getByRole('link', { name: /이미지 스타일/ })).toHaveAttribute('href', '/app/settings/image-style')
    expect(screen.getByRole('link', { name: /서비스 카탈로그/ })).toHaveAttribute('href', '/app/settings/services')

    // 연결
    expect(screen.getByRole('link', { name: /채널 연결/ })).toHaveAttribute('href', '/app/channels')
    expect(screen.getByRole('link', { name: /업무 도구 연결/ })).toHaveAttribute('href', '/app/connectors')

    // 요금·결제: 단일 '요금제 및 결제' 진입점
    expect(screen.getByRole('link', { name: /^요금제 및 결제$/ })).toHaveAttribute('href', '/app/account/billing')

    // 알림·계정
    expect(screen.getByRole('link', { name: /자동 업무 설정/ })).toHaveAttribute('href', '/app/settings/automation')
    expect(screen.getByRole('link', { name: /알림 설정/ })).toHaveAttribute('href', '/app/notifications')
    expect(screen.getByRole('link', { name: /구성원 및 권한/ })).toHaveAttribute('href', '/app/settings/members')
    expect(screen.getByRole('link', { name: /내 계정/ })).toHaveAttribute('href', '/app/account')

    // 도움
    expect(screen.getByRole('link', { name: /도움말/ })).toHaveAttribute('href', '/app/help')
    expect(screen.getByRole('link', { name: /이용약관/ })).toHaveAttribute('href', '/terms')
    expect(screen.getByRole('link', { name: /개인정보처리방침/ })).toHaveAttribute('href', '/privacy')
  })

  it('명시적인 운영 현황/보안 상세 경로(/app/system?section=status)로 연결되는 진입점이 중립적인 카드로 존재한다', () => {
    render(<SettingsOverview />)

    const statusLinks = screen.getAllByRole('link', { name: /운영 현황/ })
    expect(statusLinks.length).toBeGreaterThanOrEqual(1)
    const hasStatusLink = statusLinks.some(
      (link) => link.getAttribute('href') === '/app/system?section=status'
    )
    expect(hasStatusLink).toBe(true)

    // 서버 근거 없는 가짜 상태 배지('가동 중' 등)가 없어야 함
    expect(screen.queryByText('가동 중')).toBeNull()
  })

  it('모든 설정 링크 항목이 44px 이상 터치 타깃(min-h-11)을 준수한다', () => {
    render(<SettingsOverview />)

    const links = screen.getAllByRole('link')
    for (const link of links) {
      expect(link.className).toContain('min-h-11')
    }
  })

  it('요금제 관련 링크는 중복 카드 없이 단일 진입점 계약(/app/account/billing)을 유지한다', () => {
    render(<SettingsOverview />)

    // 하단 중복 CTA 카드 제거 검증
    expect(screen.queryByRole('link', { name: '요금제와 결제 보기' })).toBeNull()

    // 단일 요금제 링크만 존재
    const billingLinks = screen.getAllByRole('link', { name: /요금제 및 결제/ })
    expect(billingLinks).toHaveLength(1)
    expect(billingLinks[0]).toHaveAttribute('href', '/app/account/billing')
  })
})
