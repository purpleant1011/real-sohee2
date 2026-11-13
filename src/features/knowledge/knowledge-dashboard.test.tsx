import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { KnowledgeDashboard } from './knowledge-dashboard'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))
vi.mock('./actions/upload-knowledge', () => ({ uploadKnowledgeAction: vi.fn() }))
vi.mock('./actions/review-knowledge', () => ({ reviewKnowledgeAction: vi.fn() }))
vi.mock('./actions/register-url-source', () => ({ registerUrlSourceAction: vi.fn() }))

const workspaceId = '20000000-0000-4000-8000-000000000001'

describe('KnowledgeDashboard', () => {
  it('shows the real empty state and the validation limitation', () => {
    render(
      <KnowledgeDashboard items={[]} role="owner" workspaceId={workspaceId} />,
    )

    expect(screen.getByRole('heading', { name: '지식 자료' })).toBeInTheDocument()
    expect(screen.getByText('아직 등록된 지식 자료가 없습니다.')).toBeInTheDocument()
    expect(screen.getByText(/실제 악성 파일 검사 완료를 의미하지 않습니다/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '자료 올리기' })).toBeEnabled()
    expect(screen.getByRole('heading', { name: '주소 출처 등록' })).toBeInTheDocument()
    expect(screen.getByLabelText('주소')).toHaveAttribute('type', 'url')
    expect(screen.getByRole('button', { name: '주소 등록' })).toBeEnabled()
    expect(screen.getByText('참고 주소는 패턴 분석에만 사용하고 복사하거나 게시하지 않습니다.')).toBeInTheDocument()
  })

  it('exposes only valid manager transitions and labels evidence readiness', () => {
    render(
      <KnowledgeDashboard
        role="manager"
        workspaceId={workspaceId}
        items={[
          {
            id: '60000000-0000-4000-8000-000000000001',
            name: '운영 안내.pdf',
            status: 'review_required',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
            fileUrl: 'https://example.test/private-file',
            canUseAsEvidence: false,
            createdAt: '2026-08-09T01:00:00.000Z',
            updatedAt: '2026-08-09T02:00:00.000Z',
          },
          {
            id: '60000000-0000-4000-8000-000000000002',
            name: '가격표.txt',
            status: 'approved',
            mimeType: 'text/plain',
            sizeBytes: 80,
            fileUrl: 'https://example.test/private-price',
            canUseAsEvidence: true,
            createdAt: '2026-08-09T01:00:00.000Z',
            updatedAt: '2026-08-09T02:00:00.000Z',
          },
        ]}
      />,
    )

    expect(screen.getByRole('button', { name: '승인하기' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '반려하기' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '사용 중지' })).toBeInTheDocument()
    expect(screen.getByText('콘텐츠 근거 사용 가능')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: '원본 확인' })[0]).toHaveAttribute(
      'rel',
      'noreferrer',
    )
  })

  it('keeps review controls hidden from read-only members', () => {
    render(
      <KnowledgeDashboard
        role="viewer"
        workspaceId={workspaceId}
        items={[
          {
            id: '60000000-0000-4000-8000-000000000001',
            name: '운영 안내.pdf',
            status: 'review_required',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
            fileUrl: 'https://example.test/private-file',
            canUseAsEvidence: false,
            createdAt: '2026-08-09T01:00:00.000Z',
            updatedAt: '2026-08-09T02:00:00.000Z',
          },
        ]}
      />,
    )

    expect(screen.queryByRole('button', { name: '승인하기' })).not.toBeInTheDocument()
    expect(screen.getByText(/소유자와 관리자만 검토 상태를 변경/)).toBeInTheDocument()
  })

  it('shows the active Byreum image harness as workspace knowledge', () => {
    render(
      <KnowledgeDashboard
        activeImageHarness={{
          name: '바이름 추천 이미지 하네스',
          version: '1.0.0',
          channels: ['instagram', 'threads', 'naver_blog'],
          approvalStatus: 'DRAFT_OWNER_APPROVAL_PENDING',
          storageStatus: 'persisted',
        }}
        items={[]}
        role="owner"
        workspaceId={workspaceId}
      />,
    )

    expect(screen.getByRole('heading', { name: '활성 이미지 기준' })).toBeInTheDocument()
    expect(screen.getByText(/바이름 추천 이미지 하네스/)).toBeInTheDocument()
    expect(screen.getByText('지식체계 연결됨')).toBeInTheDocument()
    expect(screen.getByText(/사장님 승인 전에는 게시할 수 없습니다/)).toBeInTheDocument()
  })

  it('labels the bundled Byreum harness honestly while Supabase migration is pending', () => {
    render(
      <KnowledgeDashboard
        activeImageHarness={{
          name: '바이름 추천 이미지 하네스',
          version: '1.0.0',
          channels: ['instagram', 'threads', 'naver_blog'],
          approvalStatus: 'DRAFT_OWNER_APPROVAL_PENDING',
          storageStatus: 'bundled',
        }}
        items={[]}
        role="owner"
        workspaceId={workspaceId}
      />,
    )

    expect(screen.getByText('AI 적용됨 · 저장 준비 중')).toBeInTheDocument()
    expect(screen.getByText(/현재 소희 대화와 이미지 생성에 적용 중이며/)).toBeInTheDocument()
  })

  it('renders the 4-channel studio CTA card with active link when evidence is available', () => {
    render(
      <KnowledgeDashboard
        items={[
          {
            id: '60000000-0000-4000-8000-000000000002',
            name: '가격표.txt',
            status: 'approved',
            mimeType: 'text/plain',
            sizeBytes: 80,
            fileUrl: 'https://example.test/private-price',
            canUseAsEvidence: true,
            createdAt: '2026-08-09T01:00:00.000Z',
            updatedAt: '2026-08-09T02:00:00.000Z',
          },
        ]}
        role="owner"
        workspaceId={workspaceId}
      />,
    )

    expect(
      screen.getByRole('heading', {
        name: '이 정보로 인스타그램·스레드·네이버·당근 글 만들기',
      }),
    ).toBeInTheDocument()
    const link = screen.getByRole('link', { name: '4채널 글 만들기' })
    expect(link).toHaveAttribute('href', '/app/content?studio=four-channel')
  })

  it('공식 채널 지식 학습 패널(ChannelLearningPanel)을 렌더링한다', () => {
    render(
      <KnowledgeDashboard items={[]} role="owner" workspaceId={workspaceId} />,
    )

    expect(
      screen.getByRole('heading', { name: '공식 채널 지식 학습' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/직접 입력한 주소는 확인 완료 상태가 아니며/),
    ).toBeInTheDocument()
  })
})
