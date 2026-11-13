import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mockWorkspace = { workspaceId: 'workspace-123' }
vi.mock('@/features/auth/current-workspace', () => ({
  getCurrentWorkspaceContext: vi.fn(async () => mockWorkspace),
}))

import NaverChannelSettingsPage from './page'

describe('NaverChannelSettingsPage', () => {
  it('renders manual posting notice and 3-step guide', async () => {
    const page = await NaverChannelSettingsPage()
    render(page)

    // 상태 문구
    expect(
      screen.getByText('소희는 네이버에 자동으로 올리지 않아요. 원고와 사진을 준비해 드리면 네이버 글쓰기에서 직접 게시해요.')
    ).toBeInTheDocument()

    // 3단계 안내
    expect(screen.getByText(/원고·사진 준비/)).toBeInTheDocument()
    expect(screen.getByText(/복사\/저장/)).toBeInTheDocument()
    expect(screen.getByText(/네이버 글쓰기에서 직접 붙여넣고 게시 후 글 주소 기록/)).toBeInTheDocument()

    // 네이버 글쓰기 열기 링크
    const naverWriteLink = screen.getByRole('link', { name: '네이버 글쓰기 열기' })
    expect(naverWriteLink).toHaveAttribute('href', 'https://blog.naver.com/GoBlogWrite.naver')
    expect(naverWriteLink).toHaveAttribute('target', '_blank')

    // 콘텐츠 만들기로 가는 링크
    const createContentLink = screen.getByRole('link', { name: '콘텐츠 만들기' })
    expect(createContentLink).toHaveAttribute('href', '/app/content')
  })

  it('does not contain banned elements or connector/extension keywords', async () => {
    const page = await NaverChannelSettingsPage()
    render(page)

    const fullText = document.body.textContent ?? ''

    // 금지 문구 (부정 안내 제외)
    expect(fullText).not.toContain('확장 프로그램')
    expect(fullText).not.toContain('연결기')
    expect(fullText).not.toContain('전용 실행기')
    expect(fullText).not.toContain('네이버 공식 로그인 열기')
    expect(fullText).not.toContain('게시 가능')
    expect(fullText).not.toContain('자동등록')
    expect(fullText).not.toContain('자동 포스팅')
    expect(fullText).not.toContain('저장된 연결 기록')
    expect(fullText).not.toContain('findk3')

    // 링크 중에 공식 로그인 링크나 connector 다운로드 링크가 없어야 함
    for (const link of screen.queryAllByRole('link')) {
      expect(link).not.toHaveAttribute('href', expect.stringContaining('nidlogin.login'))
      expect(link).not.toHaveAttribute('href', expect.stringContaining('sohee-naver-connector.zip'))
      expect(link).not.toHaveAttribute('href', '/help/naver-connector')
    }
  })
})
