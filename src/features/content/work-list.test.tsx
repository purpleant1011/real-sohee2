import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/features/approvals/actions/approve-and-dispatch', () => ({ approveAndDispatchAction: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
import type { ContentDetail, ContentListResult } from './types'
import type { WorkSummary } from './work-summary'
import { WorkDetail } from './work-detail'
import { WorkList } from './work-list'

const listData: ContentListResult = {
  nextCursor: null,
  items: [
    {
      id: '20000000-0000-4000-8000-000000000001',
      title: '여름 캠페인 초안',
      status: 'review',
      channel: 'instagram',
      currentVersionId: '30000000-0000-4000-8000-000000000001',
      currentVersionNumber: 2,
      currentCaption: '여름 캠페인의 핵심 문구입니다.',
      updatedAt: '2026-08-09T05:00:00.000Z',
      source: 'actual',
      needsRecovery: false,
    },
  ],
}

const summary: WorkSummary = { all: 4, inProgress: 2, recovery: 1, approved: 1 }

const detail: ContentDetail = {
  id: listData.items[0].id,
  title: listData.items[0].title,
  status: 'review',
  channel: 'instagram',
  currentVersionId: listData.items[0].currentVersionId,
  currentVersionNumber: 2,
  createdAt: '2026-08-09T01:00:00.000Z',
  updatedAt: '2026-08-09T05:00:00.000Z',
  source: 'actual',
  versions: [
    {
      id: '30000000-0000-4000-8000-000000000001',
      versionNumber: 2,
      caption: '두 번째 문구',
      hashtags: ['#여름'],
      disclosure: '모의 콘텐츠 예시입니다.',
      fingerprint: 'b'.repeat(64),
      revisionReason: '문구를 간결하게 수정했어요.',
      createdAt: '2026-08-09T05:00:00.000Z',
      rightsConfirmed: true,
      generationEvidenceConfirmed: true,
      mediaCount: 1,
      media: [],
      structuredPayload: null,
      knowledgeIds: [],
      harnessRuleIds: [],
    },
    {
      id: '30000000-0000-4000-8000-000000000002',
      versionNumber: 1,
      caption: '첫 번째 문구',
      hashtags: ['#여름'],
      disclosure: '모의 콘텐츠 예시입니다.',
      fingerprint: 'a'.repeat(64),
      revisionReason: '첫 버전을 만들었어요.',
      createdAt: '2026-08-09T04:00:00.000Z',
      rightsConfirmed: true,
      generationEvidenceConfirmed: true,
      mediaCount: 1,
      media: [],
      structuredPayload: null,
      knowledgeIds: [],
      harnessRuleIds: [],
    },
  ],
}

describe('WorkList', () => {
  it('shows matching tab counts and clearly marks actual workspace data', () => {
    render(<WorkList activeFilter="all" data={listData} search="" summary={summary} />)

    expect(screen.getByRole('link', { name: '전체 4' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: '진행 중 2' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '복구 필요 1' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '승인·게시 1' })).toBeInTheDocument()
    expect(screen.getByText('실제 데이터')).toBeInTheDocument()
    expect(screen.getByText('v2')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '새 콘텐츠' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '소희와 콘텐츠 만들기' })).toHaveAttribute('href', '/app')
    expect(screen.getByRole('link', { name: /여름 캠페인 초안/ })).toHaveAttribute(
      'href',
      `/app/work/${listData.items[0].id}`,
    )
  })

  it('distinguishes an unavailable shared count from actual zero', () => {
    render(<WorkList activeFilter="all" data={listData} search="" summary={{ available: false }} />)

    expect(screen.getByRole('link', { name: '전체 수를 확인할 수 없음' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '진행 중 수를 확인할 수 없음' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '복구 필요 수를 확인할 수 없음' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '승인·게시 수를 확인할 수 없음' })).toBeInTheDocument()
  })

  it('keeps long copy compact in the operations board', () => {
    render(<WorkList activeFilter="all" data={{
      ...listData,
      items: [{ ...listData.items[0], currentCaption: '가'.repeat(240) }],
    }} search="" summary={summary} />)

    expect(screen.getByText(`${'가'.repeat(76)}…`)).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('가'.repeat(100))
  })

  it('renders MasterDetail with emptyDetail when no item is selected, and shows detail when selected', () => {
    const { rerender } = render(<WorkList activeFilter="all" data={listData} search="" summary={summary} />)

    expect(screen.getByRole('region', { name: '작업 목록' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '작업 상세 미리보기' })).toBeInTheDocument()
    expect(screen.getByText('왼쪽에서 하나를 골라 보세요.')).toBeInTheDocument()

    // Pass selectedId
    rerender(<WorkList activeFilter="all" data={listData} search="" summary={summary} selectedId={listData.items[0].id} />)

    const selectedCard = screen.getByRole('link', { name: /여름 캠페인 초안/ })
    expect(selectedCard).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('heading', { name: '게시 문구 미리보기' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '승인 및 게시 확인' })).toHaveAttribute(
      'href',
      `/app/work/${listData.items[0].id}/approve`,
    )
  })

  it('renders StateView with action button when work item list is empty', () => {
    render(<WorkList activeFilter="all" data={{ nextCursor: null, items: [] }} search="" summary={summary} />)

    expect(screen.getByText('조건에 맞는 작업이 아직 없어요')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '소희에게 글 맡기기' })).toBeInTheDocument()
  })
})

describe('WorkDetail', () => {
  it('shows the current state, immutable versions, and a nearby decision area', () => {
    render(<WorkDetail detail={detail} />)

    expect(screen.getByText('승인 대기')).toBeInTheDocument()
    expect(screen.getByText('현재 v2')).toBeInTheDocument()
    expect(screen.getByText('이전 v1')).toBeInTheDocument()
    expect(screen.getByText('첫 번째 문구')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '콘텐츠 결정 영역' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '새 버전 만들기' })).toHaveAttribute(
      'href',
      `/app/work/${detail.id}/edit`,
    )
    expect(screen.getByRole('link', { name: '일정 보기' })).toHaveAttribute(
      'href',
      '/app/schedule',
    )
  })
})
