import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { artifactToCopyPost, BlogArtifactCopyBar } from './blog-artifact-copy-bar'
import type { ConversationArtifact } from './types'

function artifact(over: Partial<ConversationArtifact> = {}): ConversationArtifact {
  return {
    id: '77777777-7777-4777-8777-777777777777', workspaceId: '11111111-1111-4111-8111-111111111111',
    sourceMessageId: '66666666-6666-4666-8666-666666666666', type: 'naver_blog_post', status: 'ready_for_review',
    caption: '', title: '상담 전 확인할 내용',
    naverBlog: {
      introduction: '도입 문단입니다.',
      sections: [{ heading: '준비할 내용', body: '궁금한 점을 미리 정리해 주세요.' }],
      editorBlueprint: [
        { kind: 'paragraph', text: '도입 문단입니다.' },
        { kind: 'image_slot', position: 1, altText: '매장 사진' },
        { kind: 'heading', text: '준비할 내용' },
        { kind: 'paragraph', text: '궁금한 점을 미리 정리해 주세요.' },
      ],
      keywords: ['상담', '#준비'], visibility: 'private',
    },
    hashtags: [], cta: '', disclosure: '', observations: [], limitations: [], evidence: [], unresolvedQuestions: [],
    idempotencyKey: 'k', slides: [],
    ...over,
  } as ConversationArtifact
}

function mockClipboard(write: () => Promise<void> = async () => {}, text: () => Promise<void> = async () => {}) {
  const writeText = vi.fn(async () => { await text() })
  const clipboardWrite = vi.fn(write)
  vi.stubGlobal('ClipboardItem', class { constructor(public items: Record<string, Blob>) {} })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText, write: clipboardWrite } })
  return { writeText, clipboardWrite }
}

afterEach(() => vi.unstubAllGlobals())

describe('artifactToCopyPost', () => {
  it('maps actual completed photos into the same canonical block order for rich paste', () => {
    const mediaId = '22222222-2222-4222-8222-222222222222'
    const value = artifact({ slides: [{ id: 'slide', position: 1, role: 'cover', status: 'succeeded', mediaAssetId: mediaId, altText: '매장 사진', retryable: false, safeErrorCode: null }] })
    const post = artifactToCopyPost(value, true)!
    expect(post.editorBlocks?.map(block => block.kind)).toEqual(['paragraph', 'image', 'heading', 'paragraph'])
    expect(post.media).toEqual([{ id: mediaId, src: `/api/workspaces/${value.workspaceId}/media/${mediaId}` }])
    expect(artifactToCopyPost(artifact(), true)).toBeNull()
  })
  it('drops image slots (사진은 직접 올림) and keeps text order, tags without duplicate #', () => {
    const post = artifactToCopyPost(artifact())!
    expect(post.title).toBe('상담 전 확인할 내용')
    expect(post.editorBlocks?.map((block) => block.kind)).toEqual(['paragraph', 'heading', 'paragraph'])
    expect(post.keywords).toEqual(['상담', '#준비'])
  })

  it('returns null when it is not a ready naver blog artifact', () => {
    expect(artifactToCopyPost(artifact({ status: 'partial' }))).toBeNull()
    expect(artifactToCopyPost(artifact({ type: 'instagram_post', naverBlog: null }))).toBeNull()
  })
})

describe('BlogArtifactCopyBar', () => {
  it('copies body and inline photos when requested', async () => {
    const mediaId = '22222222-2222-4222-8222-222222222222'
    const value = artifact({ slides: [{ id: 'slide', position: 1, role: 'cover', status: 'succeeded', mediaAssetId: mediaId, altText: '매장 사진', retryable: false, safeErrorCode: null }] })
    const fetcher = vi.fn(async () => new Response(new Blob(['bytes'], { type: 'image/png' }), { headers: { 'content-type': 'image/png' } }))
    vi.stubGlobal('fetch', fetcher)
    const { clipboardWrite } = mockClipboard()
    render(<BlogArtifactCopyBar artifact={value} />)
    fireEvent.click(screen.getByRole('button', { name: '본문·사진 복사' }))
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalled())
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('본문 서식과 사진 1장을 클립보드에 담았어요')
    expect(status.textContent).toContain('네이버 편집기에 붙여넣은 뒤')
  })

  it('defaults to plain text, preserving title/body/tags without copying photo placeholders', async () => {
    const { clipboardWrite, writeText } = mockClipboard()
    render(<BlogArtifactCopyBar artifact={artifact()} />)
    fireEvent.click(screen.getByRole('button', { name: '전체 복사' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('상담 전 확인할 내용\n\n도입 문단입니다.\n\n준비할 내용\n\n궁금한 점을 미리 정리해 주세요.\n\n#상담 #준비'))
    expect(clipboardWrite).not.toHaveBeenCalled()
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('텍스트로 복사했어요')
    expect(status.textContent).toContain('사진 1장')
    expect(status.textContent).toContain('게시 완료가 아니에요')
  })

  it('copies parts separately as plain text', async () => {
    const { writeText } = mockClipboard()
    render(<BlogArtifactCopyBar artifact={artifact()} />)
    fireEvent.click(screen.getByRole('button', { name: '제목 복사' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('상담 전 확인할 내용'))
    fireEvent.click(screen.getByRole('button', { name: '태그 복사' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('#상담 #준비'))
  })

  it('falls back to text and says so when HTML copy is unsupported', async () => {
    const { writeText } = mockClipboard(async () => { throw Object.assign(new Error('x'), { name: 'NotSupportedError' }) })
    render(<BlogArtifactCopyBar artifact={artifact()} />)
    fireEvent.click(screen.getByRole('button', { name: '서식 포함 복사' }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect((await screen.findByRole('status')).textContent).toContain('텍스트만 복사했어요')
  })

  it('shows an alert, not success, when the clipboard is denied', async () => {
    const denied = async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }) }
    mockClipboard(denied, denied)
    render(<BlogArtifactCopyBar artifact={artifact()} />)
    fireEvent.click(screen.getByRole('button', { name: '전체 복사' }))
    expect((await screen.findByRole('alert')).textContent).toContain('권한')
    const manual = screen.getByRole('textbox', { name: '직접 선택할 원고' }) as HTMLTextAreaElement
    expect(manual.readOnly).toBe(true)
    expect(manual.value).toContain('상담 전 확인할 내용')
    expect(manual.value).toContain('#상담 #준비')
    fireEvent.click(screen.getByRole('button', { name: '텍스트 전체 선택' }))
    expect(manual).toHaveFocus()
    expect(manual.selectionStart).toBe(0)
    expect(manual.selectionEnd).toBe(manual.value.length)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('offers the complete untruncated text when clipboard APIs are unavailable and resets on version changes', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    const long = '확인된 가게 안내 '.repeat(400)
    const sample = artifact({ naverBlog: { ...artifact().naverBlog!, editorBlueprint: [{ kind: 'paragraph', text: long }] } })
    const { rerender } = render(<BlogArtifactCopyBar artifact={sample} />)
    fireEvent.click(screen.getByRole('button', { name: '전체 복사' }))
    const manual = await screen.findByRole('textbox', { name: '직접 선택할 원고' }) as HTMLTextAreaElement
    expect(manual.value).toContain(long)
    expect(manual.value.length).toBeGreaterThan(2200)
    expect(screen.queryByRole('status')).toBeNull()
    rerender(<BlogArtifactCopyBar artifact={{ ...sample, versionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }} />)
    expect(screen.queryByRole('textbox', { name: '직접 선택할 원고' })).toBeNull()
  })

  it('renders nothing for artifacts that are not ready', () => {
    const { container } = render(<BlogArtifactCopyBar artifact={artifact({ status: 'preparing' })} />)
    expect(container.firstChild).toBeNull()
  })
})

const downloadNaverHandoff = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/features/channel-studio/naver/naver-handoff', () => ({ downloadNaverHandoff }))

function publishingState(over: Record<string, unknown> = {}) {
  return { data: { receipt: null, preview: {
    workspaceId: '11111111-1111-4111-8111-111111111111', contentId: '88888888-8888-4888-8888-888888888888',
    versionId: '99999999-9999-4999-8999-999999999999', fingerprint: 'a'.repeat(64), channel: 'naver_blog',
    approval: { status: 'unreviewed' }, disclosure: '', media: [{ id: 'm1', src: '/m1.webp' }],
    account: { label: '@naver_byreum', status: 'connected' }, versionNumber: 1, text: 't', naverCopy: { title: 't' },
    issues: [], ...over,
  } } }
}

describe('manual package source boundaries', () => {
  it('requests the exact version before producing a download', async () => {
    const fetchMock = vi.fn(async () => Response.json(publishingState()))
    vi.stubGlobal('fetch', fetchMock)
    render(<BlogArtifactCopyBar artifact={artifact({ contentItemId: '88888888-8888-4888-8888-888888888888', versionId: '99999999-9999-4999-8999-999999999999' })} />)
    fireEvent.click(screen.getByRole('button', { name: '사진·원고 ZIP 받기' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/11111111-1111-4111-8111-111111111111/naver-posts/88888888-8888-4888-8888-888888888888', expect.any(Object)))
    expect(downloadNaverHandoff).toHaveBeenCalledOnce()
  })

  it('rejects zip download if the version changed concurrently or is already approved', async () => {
    downloadNaverHandoff.mockClear()
    const fetchMock = vi.fn(async () => Response.json(publishingState({ versionId: '00000000-0000-4000-8000-000000000000' })))
    vi.stubGlobal('fetch', fetchMock)
    render(<BlogArtifactCopyBar artifact={artifact({ contentItemId: '88888888-8888-4888-8888-888888888888', versionId: '99999999-9999-4999-8999-999999999999' })} />)
    fireEvent.click(screen.getByRole('button', { name: '사진·원고 ZIP 받기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('원고가 이 화면의 원고와 달라요')
    expect(downloadNaverHandoff).not.toHaveBeenCalled()
  })
})

describe('BlogArtifactCopyBar manual report', () => {
  it('opens report panel when clicked', () => {
    render(<BlogArtifactCopyBar artifact={artifact({ contentItemId: '88888888-8888-4888-8888-888888888888', versionId: '99999999-9999-4999-8999-999999999999' })} />)
    fireEvent.click(screen.getByRole('button', { name: '네이버에 올렸어요' }))
    expect(screen.getByRole('region', { name: '수동 전달 기록' })).toBeInTheDocument()
  })
})
