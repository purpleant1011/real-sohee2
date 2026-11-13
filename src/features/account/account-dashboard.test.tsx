import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { AccountDashboard } from './account-dashboard'

describe('AccountDashboard', () => {
  it('renders the single fully loaded readiness value and each source state', () => {
    render(
      <AccountDashboard
        snapshot={{
          percentage: 33,
          input: {
            business: false,
            brand: false,
            channel: true,
            knowledge: false,
            automation: false,
            permissions: true,
          },
        }}
      />,
    )

    expect(screen.getByRole('heading', { name: '나의 소희' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '지금 확인할 한 가지' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '소희가 따르는 운영 기준' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '학습과 자동화' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '내 프로필 사진' })).toBeInTheDocument()
    expect(screen.getByLabelText('소희 준비도 33퍼센트')).toHaveTextContent('33%')
    expect(screen.getByLabelText('나의 소희 운영 상태')).toHaveTextContent('2/6 준비')
    expect(screen.getByLabelText('나의 소희 운영 상태')).toHaveTextContent('다음 설정사업 정보')
    expect(screen.getByRole('link', { name: '사업 정보 설정하기' })).toHaveAttribute('href', '/app/settings/business')
    expect(screen.getByRole('link', { name: '소희와 운영 점검하기' })).toHaveAttribute('href', '/app?resume=account')
    expect(screen.getByText('채널 연결')).toBeInTheDocument()
    expect(screen.getByText('권한 확인')).toBeInTheDocument()
    expect(screen.getAllByText('준비됨')).toHaveLength(2)
    expect(screen.getAllByText('설정 필요')).toHaveLength(4)
    expect(screen.getByRole('link',{name:'자동화 대화로 돌아가기'})).toHaveAttribute('href','/app?resume=automation')
    expect(screen.getByRole('link', { name: /^가입 준비 이어가기/ })).toHaveAttribute('href', '/start')
    expect(screen.getByRole('link', { name: /^크레딧 사용 내역/ })).toHaveAttribute('href', '/app/account/credits')
    expect(screen.getByRole('link', { name: /^요금제와 결제/ })).toHaveAttribute('href', '/app/account/billing')
    expect(screen.getByRole('link', { name: /^대화에서 채널별 결과 확인/ })).toHaveAttribute('href', '/app/work')
    expect(screen.getByRole('link', { name: /^네이버 플레이스 관리/ })).toHaveAttribute('href', '/app/account/place')
    expect(screen.getByRole('link', { name: /^당근 비즈프로필 관리/ })).toHaveAttribute('href', '/app/account/daangn')
    expect(screen.getByRole('link', { name: /^외부 실행 준비도/ })).toHaveAttribute('href', '/app/account/channels/readiness')
  })

  it('shows a completed operating state without inventing another setup task', () => {
    render(<AccountDashboard snapshot={{
      percentage: 100,
      input: {
        business: true,
        brand: true,
        channel: true,
        knowledge: true,
        automation: true,
        permissions: true,
      },
    }} />)

    expect(screen.getByLabelText('나의 소희 운영 상태')).toHaveTextContent('6/6 준비')
    expect(screen.getByLabelText('나의 소희 운영 상태')).toHaveTextContent('운영 기준 준비 완료')
    expect(screen.queryByText('다음 설정')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /설정하기/ })).not.toBeInTheDocument()
  })
})
