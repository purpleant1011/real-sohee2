import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { KnowledgeStudioCTA } from './knowledge-studio-cta'

describe('KnowledgeStudioCTA', () => {
  it('활성 상태: 승인된 지식이 1개 이상이면 4채널 글 만들기 링크가 활성화된다', () => {
    render(
      <KnowledgeStudioCTA
        items={[
          { canUseAsEvidence: false },
          { canUseAsEvidence: true },
        ]}
      />,
    )

    expect(
      screen.getByRole('heading', {
        name: '이 정보로 인스타그램·스레드·네이버·당근 글 만들기',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        '나의 지식에 적어 둔 내용만 사용해서 채널별 예상 화면을 만들어 드려요. 실제로 올라가지는 않아요.',
      ),
    ).toBeInTheDocument()

    const link = screen.getByRole('link', { name: '4채널 글 만들기' })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/app/content?studio=four-channel')
    expect(screen.queryByText(/먼저 가게 정보를 확인해 주세요/)).not.toBeInTheDocument()
  })

  it('비활성 상태: 사용 가능한 지식이 없으면 버튼이 비활성화되고 가게 정보 확인 안내가 표시된다', () => {
    render(
      <KnowledgeStudioCTA
        items={[
          { canUseAsEvidence: false },
        ]}
      />,
    )

    expect(
      screen.getByText('먼저 가게 정보를 확인해 주세요'),
    ).toBeInTheDocument()

    const disabledBtn = screen.getByRole('button', { name: '4채널 글 만들기' })
    expect(disabledBtn).toBeDisabled()

    const registerLink = screen.getByRole('link', { name: /자료 등록/ })
    expect(registerLink).toHaveAttribute('href', '#knowledge-upload-title')
  })

  it('오류 상태: 지식 조회 오류 시 빈 상태와 구별되는 오류 문구가 나오고 버튼이 비활성화된다', () => {
    render(
      <KnowledgeStudioCTA
        error="자료를 불러오는 중 문제가 발생했습니다."
        items={[]}
      />,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(
      screen.getByText('자료를 불러오는 중 문제가 발생했습니다.'),
    ).toBeInTheDocument()
    // 빈 상태 안내 문구는 나타나지 않아야 함
    expect(screen.queryByText('먼저 가게 정보를 확인해 주세요')).not.toBeInTheDocument()

    const disabledBtn = screen.getByRole('button', { name: '4채널 글 만들기' })
    expect(disabledBtn).toBeDisabled()
  })
})
