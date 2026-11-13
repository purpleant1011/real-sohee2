import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/features/content/actions/save-artifact-to-work', () => ({ saveArtifactToWork: vi.fn() }))
vi.mock('./actions/load-conversation-publishing', () => ({ loadConversationPublishingAction: vi.fn() }))
vi.mock('./actions/partial-content-revision', () => ({ partialContentRevisionAction: vi.fn() }))
vi.mock('@/features/approvals/actions/approve-and-dispatch', () => ({ approveAndDispatchAction: vi.fn() }))

import { BlogArtifactPreview, blogBlocks } from './blog-artifact-preview'
import { materializeNaverEditorBlocks } from '@/features/content/naver-editor-blocks'
import { ConversationShell } from './conversation-shell'
import type { ConversationArtifact } from './types'

const workspaceId = '11111111-1111-4111-8111-111111111111'

function artifact(over: Partial<ConversationArtifact> = {}): ConversationArtifact {
  return {
    id: '77777777-7777-4777-8777-777777777777', workspaceId, sourceMessageId: '66666666-6666-4666-8666-666666666666',
    type: 'naver_blog_post', status: 'ready_for_review', caption: '', title: '상담 전 확인할 내용',
    naverBlog: {
      introduction: '도입 문단입니다.',
      sections: [{ heading: '준비할 내용', body: '궁금한 점을 미리 정리해 주세요.' }],
      editorBlueprint: [
        { kind: 'paragraph', text: '도입 문단입니다.' },
        { kind: 'image_slot', position: 1, altText: '매장 사진' },
        { kind: 'heading', text: '준비할 내용' },
        { kind: 'paragraph', text: '궁금한 점을 미리 정리해 주세요.' },
      ],
      keywords: ['상담'], visibility: 'private',
    },
    hashtags: [], cta: '', disclosure: '', observations: [], limitations: ['후기는 사용하지 않았어요.'],
    evidence: ['승인된 가게 정보: 영업시간'], unresolvedQuestions: ['주차 가능 여부'], idempotencyKey: 'k', slides: [],
    ...over,
  } as ConversationArtifact
}

describe('ANI-1906: BlogArtifactPreview', () => {
  it('shows the whole manuscript in order and selects only text blocks', () => {
    const onSelect = vi.fn()
    render(<BlogArtifactPreview artifact={artifact()} onSelectBlock={onSelect} />)

    expect(screen.getByRole('heading', { name: '상담 전 확인할 내용' })).toBeTruthy()
    expect(screen.getAllByRole('listitem').filter(item => item.hasAttribute('data-block-kind'))).toHaveLength(4)
    expect(screen.getByText('사진 1번 · 매장 사진')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '2번 문단 수정 요청' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '4번 문단 수정 요청' }))
    expect(onSelect).toHaveBeenCalledWith({ index: 3, text: '궁금한 점을 미리 정리해 주세요.' })
  })

  it('labels tags in readable text rather than a prohibited paragraph aria-label', () => {
    render(<BlogArtifactPreview artifact={artifact()} />)
    expect(screen.getByText('태그: #상담')).not.toHaveAttribute('aria-label')
  })

  it('keeps evidence folded until opened and does not invent evidence', () => {
    const { rerender } = render(<BlogArtifactPreview artifact={artifact()} />)
    expect(screen.queryByText('승인된 가게 정보: 영업시간')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /근거와 확인 필요 펼치기/ }))
    expect(screen.getByText('승인된 가게 정보: 영업시간')).toBeTruthy()
    expect(screen.getByText('주차 가능 여부')).toBeTruthy()
    expect(screen.getByText('후기는 사용하지 않았어요.')).toBeTruthy()

    rerender(<BlogArtifactPreview artifact={artifact({ evidence: [], limitations: [], unresolvedQuestions: [] })} />)
    expect(screen.queryByRole('button', { name: /근거와 확인 필요/ })).toBeNull()
  })

  it('uses only a succeeded tenant-scoped photo and does not replace failed media with a sample', () => {
    render(<BlogArtifactPreview artifact={artifact({ slides: [{
      id: 'slide-1', position: 1, role: 'cover', status: 'succeeded',
      mediaAssetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', altText: '매장 사진', retryable: false, safeErrorCode: null,
    }] })} />)
    const image = screen.getByRole('img', { name: '매장 사진' })
    expect(image.getAttribute('src')).toBe(`/api/workspaces/${workspaceId}/media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`)
    fireEvent.error(image)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText(/사진을 불러오지 못했어요/)).toBeTruthy()
  })

  it('opens a focused manuscript review with full text and manual copy actions', () => {
    render(<BlogArtifactPreview artifact={artifact()} />)
    fireEvent.click(screen.getByRole('button', { name: '원고 전체 보기' }))
    const dialog = screen.getByRole('dialog', { name: '네이버 원고 검토' })
    expect(within(dialog).getByText('도입 문단입니다.')).toBeTruthy()
    expect(within(dialog).getByText('궁금한 점을 미리 정리해 주세요.')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '전체 복사' })).toBeTruthy()
  })

  it('closes focused review when selecting a paragraph, without sending a message', () => {
    const onSelect = vi.fn()
    render(<BlogArtifactPreview artifact={artifact()} onSelectBlock={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: '원고 전체 보기' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '4번 문단 수정 요청' }))
    expect(onSelect).toHaveBeenCalledWith({ index: 3, text: '궁금한 점을 미리 정리해 주세요.' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('hides edit buttons unless the artifact is ready for review', () => {
    render(<BlogArtifactPreview artifact={artifact({ status: 'archived' })} onSelectBlock={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /문단 수정 요청/ })).toBeNull()
  })

  it('renders nothing for non-Naver artifacts', () => {
    const { container } = render(<BlogArtifactPreview artifact={artifact({ type: 'instagram_post', naverBlog: null })} />)
    expect(container.firstChild).toBeNull()
  })

  it('includes the CTA in legacy preview just as the copy payload does', () => {
    const base = artifact()
    const legacy = artifact({ cta: '방문 전 문의해 주세요.', naverBlog: { ...base.naverBlog!, editorBlueprint: undefined } })
    expect(blogBlocks(legacy).at(-1)).toEqual({ kind: 'cta', text: '방문 전 문의해 주세요.' })
  })

  it('falls back to introduction and sections for older artifacts', () => {
    const base = artifact()
    const legacy = artifact({ naverBlog: { ...base.naverBlog!, editorBlueprint: undefined } })
    expect(blogBlocks(legacy).map(block => block.kind)).toEqual(['paragraph', 'heading', 'paragraph'])
  })
})

describe('ANI-1906: conversation shell rail', () => {
  const message = {
    id: '66666666-6666-4666-8666-666666666666', workspaceId, threadId: '22222222-2222-4222-8222-222222222222',
    role: 'sohee' as const, content: '원고를 준비했어요.', status: 'completed' as const, workItemId: null,
    createdAt: '2026-08-10T01:00:00.000Z', completedAt: '2026-08-10T01:01:00.000Z',
  }
  const details = (item: ConversationArtifact) => ({
    [message.id]: { evidence: [], artifacts: [{
      id: item.id, kind: 'conversation_artifact' as const, title: '인스타그램 게시물 초안' as const,
      href: '/app/work' as const, statusLabel: '검토 준비됨' as const, requiresConfirmation: true as const, artifact: item,
    }] },
  })

  it('links a selected paragraph to the composer without sending anything', () => {
    const onSubmit = vi.fn()
    render(<ConversationShell messages={[message]} messageDetails={details(artifact())} onSubmit={onSubmit} workspaceId={workspaceId} />)

    fireEvent.click(screen.getByRole('button', { name: '4번 문단 수정 요청' }))

    const composer = screen.getByRole('textbox', { name: '소희에게 메시지 보내기' }) as HTMLTextAreaElement
    expect(composer.value).toContain('[원고 4번 문단 "궁금한 점을 미리 정리해 주세요."]')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does not overwrite typing when the same paragraph is not reselected', () => {
    render(<ConversationShell messages={[message]} messageDetails={details(artifact())} workspaceId={workspaceId} />)
    const composer = screen.getByRole('textbox', { name: '소희에게 메시지 보내기' }) as HTMLTextAreaElement
    fireEvent.click(screen.getByRole('button', { name: '1번 문단 수정 요청' }))
    fireEvent.change(composer, { target: { value: '직접 쓴 내용' } })
    expect(composer.value).toBe('직접 쓴 내용')
  })

  it('shows no rail without a Naver blog artifact', () => {
    render(<ConversationShell messages={[message]} />)
    expect(screen.queryByLabelText('네이버 블로그 원고 미리보기')).toBeNull()
  })
})

describe('ANI-1906: rail index contract', () => {
  it('keeps blueprint indices identical to the saved editorBlocks indices', () => {
    const blueprint = artifact().naverBlog!.editorBlueprint!
    const blocks = materializeNaverEditorBlocks(blueprint, [{ mediaId: '50000000-0000-4000-8000-000000000001', altText: '매장 사진' }])
    expect(blocks).toHaveLength(blueprint.length)
    blueprint.forEach((block, index) => {
      expect(blocks[index]!.kind).toBe(block.kind === 'image_slot' ? 'image' : block.kind)
      if ('text' in block) expect(blocks[index]).toMatchObject({ text: block.text })
    })
  })

  it('offers direct editing only when the artifact is saved as work', () => {
    const { rerender } = render(<BlogArtifactPreview artifact={artifact()} onSelectBlock={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '4번 문단 직접 수정' })).toBeNull()
    rerender(<BlogArtifactPreview artifact={artifact({ contentItemId: '20000000-0000-4000-8000-000000000001' })} onSelectBlock={vi.fn()} />)
    expect(screen.getByRole('button', { name: '4번 문단 직접 수정' })).toBeTruthy()
  })
})
