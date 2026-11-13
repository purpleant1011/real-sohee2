import { describe, expect, it, vi } from 'vitest'
import type { ConversationArtifact } from '@/features/chat/types'
import { BYREUM_WORKSPACE_ID } from '@/features/content/content-draft-service'
import { createRetryArtifactSlidePostHandler } from './route'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const threadId = '20000000-0000-4000-8000-000000000001'
const artifactId = '30000000-0000-4000-8000-000000000001'
const messageId = '40000000-0000-4000-8000-000000000001'
const slideId = '50000000-0000-4000-8000-000000000001'
const requestKey = '60000000-0000-4000-8000-000000000001'

const artifact: ConversationArtifact = {
  id: artifactId,
  workspaceId,
  sourceMessageId: '70000000-0000-4000-8000-000000000001',
  type: 'naver_blog_post',
  status: 'partial',
  title: '눈썹 반영구 상담 전 확인할 점',
  caption: '눈썹 디자인과 상담 기준을 안내합니다.',
  hashtags: ['#눈썹반영구'],
  cta: '상담으로 본인에게 맞는 방향을 확인해 보세요.',
  disclosure: '', observations: [], limitations: [], evidence: [], unresolvedQuestions: [],
  idempotencyKey: '80000000-0000-4000-8000-000000000001',
  slides: [{ id: slideId, position: 1, role: 'cover', status: 'failed', mediaAssetId: null, altText: '', retryable: true, safeErrorCode: 'IMAGE_RETRYABLE' }],
}

describe('retry artifact slide route', () => {
  it('regenerates one failed slide on the existing artifact without creating a message', async () => {
    const retry = vi.fn().mockResolvedValue({
      ...artifact,
      status: 'ready_for_review',
      slides: [{ ...artifact.slides[0], status: 'succeeded', mediaAssetId: '90000000-0000-4000-8000-000000000001', retryable: false, safeErrorCode: null }],
    })
    const handler = createRetryArtifactSlidePostHandler({
      authenticate: vi.fn().mockResolvedValue('a0000000-0000-4000-8000-000000000001'),
      authorizeThread: vi.fn().mockResolvedValue(true),
      resolveRetry: vi.fn().mockResolvedValue({ ok: true, artifact, slide: artifact.slides[0] }),
      retry,
    })

    const response = await handler(new Request('https://sohee.test/retry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ replyToMessageId: messageId, slideId, requestKey }),
    }), { params: Promise.resolve({ workspaceId, threadId, artifactId }) })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { artifact: { status: 'ready_for_review' } } })
    expect(retry).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      artifact,
      slideId,
      requestKey,
      prompt: expect.stringContaining('눈썹 반영구 상담 전 확인할 점'),
    }))
  })

  it('does not regenerate an artifact that is not linked to the requested id', async () => {
    const retry = vi.fn()
    const handler = createRetryArtifactSlidePostHandler({
      authenticate: vi.fn().mockResolvedValue('a0000000-0000-4000-8000-000000000001'),
      authorizeThread: vi.fn().mockResolvedValue(true),
      resolveRetry: vi.fn().mockResolvedValue({ ok: true, artifact, slide: artifact.slides[0] }),
      retry,
    })
    const response = await handler(new Request('https://sohee.test/retry', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ replyToMessageId: messageId, slideId, requestKey }),
    }), { params: Promise.resolve({ workspaceId, threadId, artifactId: '30000000-0000-4000-8000-000000000002' }) })

    expect(response.status).toBe(404)
    expect(retry).not.toHaveBeenCalled()
  })

  it('keeps a retry prompt below the image harness limit without losing the exact slot scene', async () => {
    const retry = vi.fn().mockResolvedValue(artifact)
    const longArtifact: ConversationArtifact = {
      ...artifact,
      caption: '전체 블로그 본문입니다. '.repeat(1_000),
      naverBlog: {
        introduction: '도입',
        sections: [{ heading: '맞춤 디자인', body: '긴 본문입니다. '.repeat(800) }],
        editorBlueprint: [{ kind: 'image_slot', position: 1, altText: '자연스러운 눈썹 결이 보이는 정면 표지 이미지' }],
        keywords: ['청라눈썹'],
        visibility: 'public',
      },
    }
    const handler = createRetryArtifactSlidePostHandler({
      authenticate: vi.fn().mockResolvedValue('a0000000-0000-4000-8000-000000000001'),
      authorizeThread: vi.fn().mockResolvedValue(true),
      resolveRetry: vi.fn().mockResolvedValue({ ok: true, artifact: longArtifact, slide: longArtifact.slides[0] }),
      retry,
    })

    await handler(new Request('https://sohee.test/retry', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ replyToMessageId: messageId, slideId, requestKey }),
    }), { params: Promise.resolve({ workspaceId, threadId, artifactId }) })

    const prompt = retry.mock.calls[0]?.[0]?.prompt as string
    expect(prompt.length).toBeLessThanOrEqual(1_400)
    expect(prompt).toContain('자연스러운 눈썹 결이 보이는 정면 표지 이미지')
    expect(prompt).not.toContain(longArtifact.caption)
  })

  it('uses neutral fallbacks without byreum or eyebrow keywords for non-byreum workspaces', async () => {
    const retry = vi.fn().mockResolvedValue(artifact)
    const neutralArtifact: ConversationArtifact = {
      ...artifact,
      title: '',
      caption: '',
      naverBlog: undefined,
    }
    const handler = createRetryArtifactSlidePostHandler({
      authenticate: vi.fn().mockResolvedValue('a0000000-0000-4000-8000-000000000001'),
      authorizeThread: vi.fn().mockResolvedValue(true),
      resolveRetry: vi.fn().mockResolvedValue({ ok: true, artifact: neutralArtifact, slide: neutralArtifact.slides[0] }),
      retry,
    })

    const response = await handler(new Request('https://sohee.test/retry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ replyToMessageId: messageId, slideId, requestKey }),
    }), { params: Promise.resolve({ workspaceId, threadId, artifactId }) })

    expect(response.status).toBe(200)
    const prompt = retry.mock.calls[0]?.[0]?.prompt as string
    expect(prompt).toContain('네이버 블로그 글 제목: 블로그 콘텐츠 안내')
    expect(prompt).toContain('이 이미지 슬롯의 정확한 장면: 1번 이미지 장면')
    expect(prompt).toContain('같은 글 맥락과 시각 흐름을 유지하세요.')
    expect(prompt).not.toContain('바이름')
    expect(prompt).not.toContain('눈썹')
  })

  it('preserves byreum and eyebrow phrases when workspace is byreum', async () => {
    const retry = vi.fn().mockResolvedValue(artifact)
    const byreumArtifact: ConversationArtifact = {
      ...artifact,
      workspaceId: BYREUM_WORKSPACE_ID,
      title: '',
      caption: '',
      naverBlog: undefined,
    }
    const handler = createRetryArtifactSlidePostHandler({
      authenticate: vi.fn().mockResolvedValue('a0000000-0000-4000-8000-000000000001'),
      authorizeThread: vi.fn().mockResolvedValue(true),
      resolveRetry: vi.fn().mockResolvedValue({ ok: true, artifact: byreumArtifact, slide: byreumArtifact.slides[0] }),
      retry,
    })

    const response = await handler(new Request('https://sohee.test/retry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ replyToMessageId: messageId, slideId, requestKey }),
    }), { params: Promise.resolve({ workspaceId: BYREUM_WORKSPACE_ID, threadId, artifactId }) })

    expect(response.status).toBe(200)
    const prompt = retry.mock.calls[0]?.[0]?.prompt as string
    expect(prompt).toContain('네이버 블로그 글 제목: 바이름 눈썹 디자인 안내')
    expect(prompt).toContain('이 이미지 슬롯의 정확한 장면: 1번 눈썹 디자인 장면')
    expect(prompt).toContain('바이름의 자연스러운 눈썹 디자인 상담 글과 같은 시각 흐름을 유지하세요.')
  })
})
