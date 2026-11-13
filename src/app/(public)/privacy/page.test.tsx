import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OPERATOR_INFO } from '@/features/marketing/operator-information'
import PrivacyPage from './page'

describe('PrivacyPage', () => {
  it('개인정보 처리방침 문서 구조와 초안 배너를 렌더링한다', () => {
    render(<PrivacyPage />)

    expect(screen.getByRole('heading', { level: 1, name: '개인정보 처리방침' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('초안 — 법률 검토 전')
    expect(screen.getByRole('navigation', { name: '목차' })).toBeInTheDocument()
  })

  it('제3조 위탁 목록에 코드 의존성 인프라(Supabase, Cloudflare, OpenAI)와 결제 위탁 예정 사실을 명시한다', () => {
    render(<PrivacyPage />)

    const article3 = screen.getByRole('heading', {
      level: 2,
      name: /제3조\s*\(개인정보 처리의 위탁\)/,
    })
    expect(article3).toBeInTheDocument()
    const section = article3.closest('section')
    expect(section).toHaveTextContent('Supabase')
    expect(section).toHaveTextContent('Cloudflare')
    expect(section).toHaveTextContent('OpenAI')
    expect(section).toHaveTextContent('결제')
    expect(section).toHaveTextContent('위탁 예정')
    // 근거 없는 외부 서비스나 PG사 심사 상태 노출 없음
    expect(section).not.toHaveTextContent('KG이니시스 심사')
  })

  it('제5조 개인정보의 국외 이전에 코드/의존성으로 확인된 외부 서비스(Supabase, Cloudflare, OpenAI)를 명시한다', () => {
    render(<PrivacyPage />)

    const article5 = screen.getByRole('heading', {
      level: 2,
      name: /제5조\s*\(개인정보의 국외 이전\)/,
    })
    expect(article5).toBeInTheDocument()

    const section = article5.closest('section')
    expect(section).toHaveTextContent('Supabase')
    expect(section).toHaveTextContent('Cloudflare')
    expect(section).toHaveTextContent('OpenAI')
  })

  it('제6조에 이용자 권리 행사 방법으로 /data-deletion 링크를 제공한다', () => {
    render(<PrivacyPage />)

    const article6 = screen.getByRole('heading', {
      level: 2,
      name: /제6조\s*\(이용자의 권리와 행사 방법\)/,
    })
    expect(article6).toBeInTheDocument()

    const link = screen.getByRole('link', { name: /사용자 데이터 삭제/ })
    expect(link).toHaveAttribute('href', '/data-deletion')
  })

  it('제7조에 확정된 운영사 상호·고객센터 전화·이메일을 명시하고 책임자 성명/직책만 [운영자 확정 필요]로 표기한다', () => {
    render(<PrivacyPage />)

    const article7 = screen.getByRole('heading', {
      level: 2,
      name: /제7조\s*\(개인정보 보호책임자\)/,
    })
    expect(article7).toBeInTheDocument()

    const section = article7.closest('section')
    expect(section).toHaveTextContent(OPERATOR_INFO.companyName)
    expect(section).toHaveTextContent(OPERATOR_INFO.phone)
    expect(section).toHaveTextContent(OPERATOR_INFO.supportEmail)
    expect(section).toHaveTextContent('운영자 확정 필요')
    // 이미 확정된 전화번호를 미정이라 하지 않음
    expect(section).not.toHaveTextContent('유선 전화번호 확정 (현재 미정)')
  })

  it('문의 창구로 support@example.com을 안내한다', () => {
    render(<PrivacyPage />)

    const mailtoLinks = screen.getAllByRole('link', { name: 'support@example.com' })
    expect(mailtoLinks.length).toBeGreaterThanOrEqual(1)
    for (const link of mailtoLinks) {
      expect(link).toHaveAttribute('href', 'mailto:support@example.com')
    }
  })
})
