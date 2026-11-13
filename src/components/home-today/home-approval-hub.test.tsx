import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { HomeApprovalHub } from './home-approval-hub'
const navigation = vi.hoisted(() => ({ destinations: [] as string[] }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: (href: string) => navigation.destinations.push(href) }) }))

describe('HomeApprovalHub', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigation.destinations.length = 0
  })

  it('preserves the main branch initialData contract without a redundant fetch', () => {
    vi.stubGlobal('fetch', () => { throw new Error('unexpected read') })
    render(<HomeApprovalHub workspaceId="ws-1" initialData={{ autonomyLevel: 'L1', items: [{ id: 'post:fixture', category: 'post_publish', channel: 'instagram', title: '저장된 검토', targetLabel: '초기 데이터', sourceSnippet: '원문', draftSnippet: '초안', createdAt: '2026-10-16T00:00:00Z' }], autoHandledCount: 0, summary: { total: 1, comments: 0, posts: 1, dms: 0, proposals: 0 } }} />)
    expect(screen.getByText('초기 데이터')).toBeVisible()
    expect(screen.queryByLabelText('승인 센터 로딩')).not.toBeInTheDocument()
  })

  it('renders loading skeleton initially', () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(() => {})))
    render(<HomeApprovalHub workspaceId="ws-1" />)
    expect(screen.getByLabelText('승인 센터 로딩')).toBeInTheDocument()
  })

  it('renders approval items, autonomy selector, auto-handled banner, and filter pills', async () => {
    const mockData = {
      autonomyLevel: 'L2',
      items: [
        {
          id: 'post:1',
          category: 'post_publish',
          channel: 'multi',
          title: '소셜 포스팅 발행 승인',
          targetLabel: '가을 속건조 앰플 케어 꿀팁',
          sourceSnippet: '가을 속건조 앰플 케어',
          draftSnippet: '환절기 보습 케어 루틴을 소개합니다.',
          fullCaption: '환절기 보습 케어 루틴 전체 본문입니다. #청라뷰티',
          hashtags: ['#청라뷰티', '#에스테틱'],
          goldenTimeLabel: '화·목 19:00 추천 발행',
          createdAt: '2026-10-15T00:00:00Z',
        },
        {
          id: 'dm:1',
          category: 'dm_reply',
          channel: 'instagram',
          title: '인스타그램 DM 문의 답변 승인',
          targetLabel: '김민지 (@customer_a)',
          sourceSnippet: '10월 20일 2시 예약하고 싶어요!',
          draftSnippet: '안녕하세요! 10월 20일 14:00 예약 가능하세요.',
          suggestedBooking: { date: '2026-10-20', time: '14:00', service: '맞춤 케어' },
          createdAt: '2026-10-15T01:00:00Z',
        },
      ],
      autoHandledCount: 2,
      autoHandledLabel: '일상 칭찬 댓글 2건은 소희가 알아서 답글 발송 중입니다',
      summary: { total: 2, comments: 0, posts: 1, dms: 1, proposals: 0 },
    }

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: mockData }),
      })
    )

    render(<HomeApprovalHub workspaceId="ws-1" />)

    await waitFor(() => {
      expect(screen.getByText('소희 빠른 승인 센터')).toBeInTheDocument()
      expect(screen.getByText('L2 안심자율')).toBeInTheDocument()
      expect(screen.getByText(/일상 칭찬 댓글 2건은 소희가 알아서 답글 발송 중입니다/)).toBeInTheDocument()
      expect(screen.getByText('가을 속건조 앰플 케어 꿀팁')).toBeInTheDocument()
      expect(screen.getByText('화·목 19:00 추천 발행')).toBeInTheDocument()
      expect(screen.getByText('김민지 (@customer_a)')).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: '전체 내용 검토하기' }).length).toBeGreaterThan(0)
    })
  })

  it('toggles quick preview for posts', async () => {
    const mockData = {
      autonomyLevel: 'L2',
      items: [
        {
          id: 'post:1',
          category: 'post_publish',
          channel: 'multi',
          title: '소셜 포스팅 발행 승인',
          targetLabel: '가을 꿀팁',
          sourceSnippet: '가을 케어',
          draftSnippet: '요약 본문',
          fullCaption: '상세 전체 본문과 팁입니다.',
          hashtags: ['#뷰티', '#청라'],
          createdAt: '2026-10-15T00:00:00Z',
        },
      ],
      autoHandledCount: 0,
      summary: { total: 1, comments: 0, posts: 1, dms: 0, proposals: 0 },
    }

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: mockData }),
      })
    )

    render(<HomeApprovalHub workspaceId="ws-1" />)

    await waitFor(() => {
      expect(screen.getByText('상세 미리보기')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('상세 미리보기'))

    expect(screen.getByText('실제 게시 미리보기')).toBeInTheDocument()
    expect(screen.getByText('상세 전체 본문과 팁입니다.')).toBeInTheDocument()
    expect(screen.getByText('소희 AI 맞춤 사진과 함께 발행돼요')).toBeInTheDocument()
    expect(screen.getByText('#뷰티')).toBeInTheDocument()
    expect(screen.getByText('미리보기 닫기')).toBeInTheDocument()
  })

  it('renders knowledge prompt banner when needsKnowledgePrompt is true', async () => {
    const mockData = {
      autonomyLevel: 'L2',
      items: [],
      autoHandledCount: 0,
      summary: { total: 0, comments: 0, posts: 0, dms: 0, proposals: 0 },
      knowledgeStatus: {
        factsCount: 0,
        sourcesCount: 0,
        needsKnowledgePrompt: true,
      },
    }

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: mockData }),
      })
    )

    render(<HomeApprovalHub workspaceId="ws-1" />)

    await waitFor(() => {
      expect(
        screen.getByText('소희가 우리 매장을 더 잘 배울 수 있도록 지식을 알려주세요!')
      ).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /지식 가르치기/ })).toHaveAttribute(
        'href',
        '/app/sohee'
      )
    })
  })

  it('filters items by category tab', async () => {
    const mockData = {
      autonomyLevel: 'L2',
      items: [
        {
          id: 'post:1',
          category: 'post_publish',
          channel: 'multi',
          title: '포스팅',
          targetLabel: '포스팅 제목',
          sourceSnippet: '원문',
          draftSnippet: '초안',
          createdAt: '2026-10-15T00:00:00Z',
        },
        {
          id: 'dm:1',
          category: 'dm_reply',
          channel: 'instagram',
          title: 'DM',
          targetLabel: 'DM 고객',
          sourceSnippet: '문의',
          draftSnippet: '답변',
          createdAt: '2026-10-15T01:00:00Z',
        },
      ],
      autoHandledCount: 0,
      summary: { total: 2, comments: 0, posts: 1, dms: 1, proposals: 0 },
    }

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: mockData }),
      })
    )

    render(<HomeApprovalHub workspaceId="ws-1" />)

    await waitFor(() => {
      expect(screen.getByText('포스팅 제목')).toBeInTheDocument()
      expect(screen.getByText('DM 고객')).toBeInTheDocument()
    })

    // Click DM filter
    fireEvent.click(screen.getByText('DM·예약 (1)'))

    expect(screen.queryByText('포스팅 제목')).not.toBeInTheDocument()
    expect(screen.getByText('DM 고객')).toBeInTheDocument()
  })

  it('opens DM review instead of combining booking and dispatch', async () => {
    const mockData = {
      autonomyLevel: 'L2',
      items: [
        {
          id: 'dm:1',
          category: 'dm_reply',
          channel: 'instagram',
          title: '인스타그램 DM 문의 답변 승인',
          targetLabel: '김민지 (@customer_a)',
          sourceSnippet: '10월 20일 2시 예약하고 싶어요!',
          draftSnippet: '안녕하세요! 10월 20일 14:00 예약 가능하세요.',
          suggestedBooking: { date: '2026-10-20', time: '14:00', service: '맞춤 케어' },
          createdAt: '2026-10-15T01:00:00Z',
        },
      ],
      autoHandledCount: 0,
      summary: { total: 1, comments: 0, posts: 0, dms: 1, proposals: 0 },
    }

    const fetchMock = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (opts?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: { succeededIds: ['dm:1'] } }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: mockData }),
      })
    })

    vi.stubGlobal('fetch', fetchMock)

    render(<HomeApprovalHub workspaceId="ws-1" />)

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: '전체 내용 검토하기' }).length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: '전체 내용 검토하기' }))
    expect(navigation.destinations).toEqual(['/app/approvals?item=dm%3A1'])
    expect(fetchMock.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true)
  })

  it('홈이 길어지지 않도록 3건만 보이고 나머지는 더 보기로 펼친다', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({
      id: `post:${i}`,
      category: 'post_publish' as const,
      channel: 'instagram' as const,
      title: '소셜 포스팅 발행 승인',
      targetLabel: `항목 ${i}`,
      sourceSnippet: '원문',
      draftSnippet: '초안',
      createdAt: '2026-10-15T00:00:00Z',
    }))
    render(<HomeApprovalHub workspaceId="ws-1" initialData={{ autonomyLevel: 'L1', items, autoHandledCount: 0, summary: { total: 7, comments: 0, posts: 7, dms: 0, proposals: 0 } }} />)

    // 접힌 상태: 3건만 렌더되고 정보는 삭제되지 않는다(나머지 건수를 버튼이 알려 준다).
    for (let i = 0; i < 3; i++) expect(screen.getByText(`항목 ${i}`)).toBeVisible()
    for (let i = 3; i < 7; i++) expect(screen.queryByText(`항목 ${i}`)).not.toBeInTheDocument()

    const toggle = screen.getByRole('button', { name: /나머지 4건 더 보기/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    // 토글이 펼치는 대상이 목록임을 보조기기에 알린다.
    expect(toggle).toHaveAttribute('aria-controls', 'home-approval-items')
    expect(document.getElementById('home-approval-items')).not.toBeNull()

    fireEvent.click(toggle)
    for (let i = 0; i < 7; i++) expect(screen.getByText(`항목 ${i}`)).toBeVisible()
    expect(screen.getByRole('button', { name: /접기/ })).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(screen.getByRole('button', { name: /접기/ }))
    expect(screen.queryByText('항목 6')).not.toBeInTheDocument()
  })

  it('필터를 바꾸면 접힘 상태로 돌아간다', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: `post:${i}`,
      category: 'post_publish' as const,
      channel: 'instagram' as const,
      title: '소셜 포스팅 발행 승인',
      targetLabel: `항목 ${i}`,
      sourceSnippet: '원문',
      draftSnippet: '초안',
      createdAt: '2026-10-15T00:00:00Z',
    }))
    render(<HomeApprovalHub workspaceId="ws-1" initialData={{ autonomyLevel: 'L1', items, autoHandledCount: 0, summary: { total: 5, comments: 0, posts: 5, dms: 0, proposals: 0 } }} />)

    fireEvent.click(screen.getByRole('button', { name: /나머지 2건 더 보기/ }))
    expect(screen.getByText('항목 4')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: /^포스팅 \(5\)$/ }))
    expect(screen.queryByText('항목 4')).not.toBeInTheDocument()
  })
})
