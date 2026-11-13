import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { SettingsMasterLayout, SETTINGS_GROUPS } from '../settings-master-layout'

let currentPathname = '/app/settings/business'
let currentSearch = ''

vi.mock('next/navigation', () => ({
  usePathname: () => currentPathname,
  useSearchParams: () => new URLSearchParams(currentSearch),
}))

describe('SettingsMasterLayout (설정 상세 전체폭 레이아웃 및 설정 홈 복귀)', () => {
  beforeEach(() => {
    currentPathname = '/app/settings/business'
    currentSearch = ''
  })

  it('상세 화면에서 360px 세로 설정 메뉴(중복 사이드바)를 렌더링하지 않는다', () => {
    render(
      <SettingsMasterLayout>
        <div data-testid="settings-content">매장 정보 본문</div>
      </SettingsMasterLayout>
    )

    // 기존의 세로 설정 메뉴 navigation이 상세 레이아웃 안에 중복으로 나타나면 안 된다
    expect(screen.queryByRole('navigation', { name: '설정 메뉴' })).toBeNull()
  })

  it('설정 홈(/app/system)으로 복귀하는 링크를 44px 이상 터치 타깃으로 제공한다', () => {
    render(
      <SettingsMasterLayout>
        <div>상세 콘텐츠</div>
      </SettingsMasterLayout>
    )

    const backLink = screen.getByRole('link', { name: /설정 홈/ })
    expect(backLink).toBeInTheDocument()
    expect(backLink).toHaveAttribute('href', '/app/system')
    expect(backLink.className).toContain('min-h-11')
  })

  it('상세 영역에 전달된 children을 전체폭으로 정상 렌더링한다', () => {
    render(
      <SettingsMasterLayout>
        <div data-testid="my-detail">상세 콘텐츠 본문</div>
      </SettingsMasterLayout>
    )

    expect(screen.getByTestId('my-detail')).toBeInTheDocument()
    expect(screen.getByText('상세 콘텐츠 본문')).toBeInTheDocument()
  })

  it('forceMobile 환경(넓은 viewport에서도) PC 설정 사이드바가 노출되지 않는다', () => {
    render(
      <MobileR2Provider enabled forceMobile>
        <SettingsMasterLayout>
          <div>모바일 강제 상세 콘텐츠</div>
        </SettingsMasterLayout>
      </MobileR2Provider>
    )

    expect(screen.queryByRole('navigation', { name: '설정 메뉴' })).toBeNull()
    expect(screen.getByText('모바일 강제 상세 콘텐츠')).toBeInTheDocument()
  })

  it('SETTINGS_GROUPS 상수가 5대 그룹을 온전히 포함하여 외부 export를 유지한다', () => {
    const groupLabels = SETTINGS_GROUPS.map((g) => g.label)
    expect(groupLabels).toEqual(['우리 가게', '연결', '요금·결제', '알림·계정', '도움'])
    expect(SETTINGS_GROUPS.flatMap((g) => g.items).length).toBeGreaterThanOrEqual(15)
  })
})
