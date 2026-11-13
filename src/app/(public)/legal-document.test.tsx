import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LegalDocument, OperatorNote } from './legal-document'
import { LegalDraft } from './legal-draft'

describe('LegalDocument', () => {
  it('상단에 "초안 — 법률 검토 전" 배너를 렌더링한다', () => {
    render(
      <LegalDocument
        title="테스트 문서"
        articles={[
          {
            id: 'art-1',
            title: '테스트 조항',
            content: '테스트 내용입니다.',
          },
        ]}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('초안 — 법률 검토 전')
  })

  it('시행일이 지정되지 않으면 "시행일: 확정 전"을 표시하고, 지정되면 해당 일자를 표시한다', () => {
    const { rerender } = render(
      <LegalDocument
        title="시행일 테스트"
        articles={[{ id: 'art-1', title: '조항', content: '내용' }]}
      />,
    )
    expect(screen.getByText(/시행일:\s*확정 전/)).toBeInTheDocument()

    rerender(
      <LegalDocument
        title="시행일 테스트"
        effectiveDate="2026년 11월 10일"
        articles={[{ id: 'art-1', title: '조항', content: '내용' }]}
      />,
    )
    expect(screen.getByText(/시행일:\s*2026년 11월 10일/)).toBeInTheDocument()
  })

  it('목차(TOC)를 렌더링하고 각 조항 앵커 링크를 제공한다', () => {
    render(
      <LegalDocument
        title="목차 테스트"
        articles={[
          { id: 'purpose', title: '목적', content: '목적 내용' },
          { id: 'definitions', title: '정의', content: '정의 내용' },
        ]}
      />,
    )

    const toc = screen.getByRole('navigation', { name: /목차/ })
    expect(toc).toBeInTheDocument()

    const purposeLink = screen.getByRole('link', { name: /목적/ })
    expect(purposeLink).toHaveAttribute('href', '#purpose')

    const definitionsLink = screen.getByRole('link', { name: /정의/ })
    expect(definitionsLink).toHaveAttribute('href', '#definitions')
  })

  it('조항 번호(제1조…)를 자동으로 매기거나 직접 지정된 조항 번호를 렌더링한다', () => {
    render(
      <LegalDocument
        title="조항 번호 테스트"
        articles={[
          { id: 'art-1', title: '목적', content: '제1조 내용' },
          { id: 'art-2', articleNumber: '제2조의2', title: '특별 규정', content: '특별 내용' },
        ]}
      />,
    )

    expect(screen.getByRole('heading', { level: 2, name: /제1조\s*\(목적\)/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /제2조의2\s*\(특별 규정\)/ })).toBeInTheDocument()
  })

  it('OperatorNote를 렌더링하여 "[운영자 확정 필요: ...]" 박스를 표시한다', () => {
    render(
      <LegalDocument
        title="확정 필요 테스트"
        articles={[
          {
            id: 'art-1',
            title: '요금 조항',
            content: (
              <div>
                <p>기본 요금은 0원입니다.</p>
                <OperatorNote item="정기결제 자동 갱신 사전 고지 기간" />
              </div>
            ),
          },
        ]}
      />,
    )

    const note = screen.getByRole('note', { name: /운영자 확정 필요/ })
    expect(note).toBeInTheDocument()
    expect(note).toHaveTextContent('[운영자 확정 필요: 정기결제 자동 갱신 사전 고지 기간]')
  })

  it('하단에 support@example.com 문의 경로를 렌더링한다', () => {
    render(
      <LegalDocument
        title="문의처 테스트"
        articles={[{ id: 'art-1', title: '조항', content: '내용' }]}
      />,
    )

    const mailto = screen.getByRole('link', { name: 'support@example.com' })
    expect(mailto).toHaveAttribute('href', 'mailto:support@example.com')
  })

  it('기존 LegalDraft props(sections, title, description)와 호환된다', () => {
    render(
      <LegalDraft
        title="기존 약관 호환"
        description="호환성 설명"
        sections={[
          ['서비스의 범위', '서비스 범위 설명입니다.'],
          ['이용자의 책임', '이용자 책임 설명입니다.'],
        ]}
      />,
    )

    expect(screen.getByRole('heading', { level: 1, name: '기존 약관 호환' })).toBeInTheDocument()
    expect(screen.getByText('호환성 설명')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /제1조\s*\(서비스의 범위\)/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'support@example.com' })).toBeInTheDocument()
  })
})
