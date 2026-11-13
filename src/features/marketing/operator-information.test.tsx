import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  OPERATOR_FIELDS,
  OPERATOR_INFO,
} from './operator-information'
import { OperatorInformation } from './operator-information-view'
import BusinessInfoPage from '@/app/(public)/business-info/page'
import { PublicShell } from '@/app/(public)/public-shell'
import { MobileLandingView } from '@/features/mobile-landing/landing-view'
import { LANDING_EXAMPLES } from '@/features/mobile-landing/landing-model'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/pricing',
}))

vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  }),
}))

vi.mock('@/features/mobile-shell/r2-gate', () => ({
  useMobileR2Active: () => false,
}))

describe('OPERATOR_INFO 상수', () => {
  it('정부 공인 통신판매업신고증 및 사업자 정보, 고객센터 연락처를 정확히 보관한다', () => {
    expect(OPERATOR_INFO.companyName).toBe('예시회사')
    expect(OPERATOR_INFO.representative).toBe('홍길동')
    expect(OPERATOR_INFO.businessRegistrationNumber).toBe('000-00-00000')
    expect(OPERATOR_INFO.telecomRegistrationNumber).toBe('제 0000-지역-0000 호')
    expect(OPERATOR_INFO.address).toBe('서울특별시 예시구 예시로 1')
    expect(OPERATOR_INFO.phone).toBe('010-0000-0000')
    expect(OPERATOR_INFO.supportEmail).toBe('support@example.com')
  })

  it('OPERATOR_FIELDS는 등록증 표시용 6개 필드를 정의한다', () => {
    expect(OPERATOR_FIELDS).toEqual([
      ['상호', '예시회사'],
      ['대표자', '홍길동'],
      ['사업자등록번호', '000-00-00000'],
      ['통신판매업신고번호', '제 0000-지역-0000 호'],
      ['사업장 주소', '서울특별시 예시구 예시로 1'],
      ['고객센터', '010-0000-0000'],
    ])
  })
})

describe('OperatorInformation 공통 컴포넌트', () => {
  it('운영 주체 정보와 고객센터 전화, 통신판매업신고번호, 이메일 링크를 렌더링한다', () => {
    render(<OperatorInformation />)

    expect(screen.getByText(/예시회사/)).toBeInTheDocument()
    expect(screen.getByText(/홍길동/)).toBeInTheDocument()
    expect(screen.getByText(/000-00-00000/)).toBeInTheDocument()
    expect(screen.getByText(/0000-지역-0000/)).toBeInTheDocument()
    expect(screen.getByText(/010-0000-0000/)).toBeInTheDocument()
    expect(screen.getByText(/서울특별시 예시구 예시로 1/)).toBeInTheDocument()

    const mailLink = screen.getByRole('link', { name: 'support@example.com' })
    expect(mailLink).toHaveAttribute('href', 'mailto:support@example.com')
  })
})

describe('BusinessInfoPage 단일 소스 재사용', () => {
  it('공통 운영사 정보 상수를 활용해 사업자 정보를 올바르게 렌더링한다', () => {
    render(<BusinessInfoPage />)

    expect(screen.getByRole('heading', { name: '사업자 정보' })).toBeInTheDocument()
    expect(screen.getByText('예시회사')).toBeInTheDocument()
    expect(screen.getByText('홍길동')).toBeInTheDocument()
    expect(screen.getByText('000-00-00000')).toBeInTheDocument()
    expect(screen.getByText(/서울특별시 예시구 예시로 1/)).toBeInTheDocument()

    const mailLink = screen.getByRole('link', { name: 'support@example.com' })
    expect(mailLink).toHaveAttribute('href', 'mailto:support@example.com')
  })
})

describe('PublicShell PC 푸터 운영사 정보 노출', () => {
  it('PC 푸터에 동일 운영사 정보와 고객지원 이메일이 노출되고 정책 링크가 유지된다', () => {
    render(
      <PublicShell>
        <div>본문 내용</div>
      </PublicShell>,
    )

    const footer = screen.getByRole('contentinfo')
    expect(footer).toBeInTheDocument()

    // 운영사 정보 텍스트 확인
    expect(footer.textContent).toContain('예시회사')
    expect(footer.textContent).toContain('홍길동')
    expect(footer.textContent).toContain('000-00-00000')
    expect(footer.textContent).toContain('서울특별시 예시구 예시로 1')
    expect(footer.textContent).toContain('support@example.com')

    // 정책 링크 유지 확인
    for (const label of ['이용약관', '개인정보 처리방침', '사용자 데이터 삭제', '환불 안내', '결제 안내', '사업자 정보']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
    }
  })
})

describe('MobileLandingView 모바일 푸터 운영사 정보 노출', () => {
  it('모바일 랜딩 푸터에 동일 운영사 정보와 고객지원 이메일이 노출되고 정책/요금 링크가 유지된다', () => {
    render(
      <MobileLandingView
        snapshot={{
          loadState: 'ready',
          examples: LANDING_EXAMPLES,
          checkedAt: '2026-10-23T01:00:00.000Z',
        }}
      />,
    )

    // 모바일 랜딩 내 운영사 정보 텍스트 확인
    expect(screen.getByText(/예시회사/)).toBeInTheDocument()
    expect(screen.getByText(/홍길동/)).toBeInTheDocument()
    expect(screen.getByText(/000-00-00000/)).toBeInTheDocument()
    expect(screen.getByText(/서울특별시 예시구 예시로 1/)).toBeInTheDocument()
    expect(screen.getByText(/support@example.com/)).toBeInTheDocument()

    // 모바일 정책 및 요금 링크 유지 확인
    expect(screen.getByRole('link', { name: '요금 자세히 보기' })).toBeInTheDocument()
    for (const label of ['제품 소개', '연결 채널', '요금 안내', '사용자 데이터 삭제', '환불 안내', '결제 안내', '사업자 정보']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
    }
  })
})
