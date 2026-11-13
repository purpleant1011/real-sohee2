import { describe, expect, it, vi } from 'vitest'
import { createConversationImageSlidePostHandler } from './route'
import type { ContentBrief } from '@/features/chat/content-interview'

const workspaceId = '11111111-1111-4111-8111-111111111111'

describe('POST conversation image slide', () => {
  it('forwards the validated image template brief to the production generator', async () => {
    const contentBrief = {
      channels: ['instagram'], goal: { value: 'expertise' }, audience: { value: 'local' },
      audienceProblem: '자연스러운 디자인을 원하는 분',
      textDirection: { structure: { value: 'expertise_story' }, tone: '차분하게', messageAngle: '상담 기준' },
      imageDirection: {
        mood: { value: 'design_consult' }, composition: '상담 장면', sceneRoles: ['표지'], avoid: [],
        templateId: 'design_consult', modelAge: '40s', framing: 'upper_body', pose: 'explaining',
        background: 'warm_studio', textOverlay: 'none',
      },
      callToAction: { value: 'consult' }, mustInclude: [], mustAvoid: [], referenceMediaIds: [],
    } satisfies ContentBrief
    const generate = vi.fn(async () => ({ id: '22222222-2222-4222-8222-222222222222', title: '맞춤 이미지' }))
    const handler = createConversationImageSlidePostHandler({
      authenticate: async () => '33333333-3333-4333-8333-333333333333',
      generate,
    })

    const response = await handler(new Request('https://example.com/api/internal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '맞춤 이미지', channel: 'instagram', position: 1, contentBrief }),
    }), { params: Promise.resolve({ workspaceId }) })

    expect(response.status).toBe(200)
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ contentBrief }))
  })

  it('generates exactly one image for the authenticated workspace member', async () => {
    const generate = vi.fn(async () => ({
      id: '22222222-2222-4222-8222-222222222222',
      title: '바이름 네이버 블로그 상세 이미지 초안',
    }))
    const handler = createConversationImageSlidePostHandler({
      authenticate: async () => '33333333-3333-4333-8333-333333333333',
      generate,
    })

    const response = await handler(new Request('https://example.com/api/internal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: '캐러셀 1번 표지 이미지로 구성하세요.',
        channel: 'naver_blog',
        position: 1,
      }),
    }), { params: Promise.resolve({ workspaceId }) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      data: {
        mediaAssetId: '22222222-2222-4222-8222-222222222222',
        altText: '바이름 네이버 블로그 상세 이미지 초안',
      },
    })
    expect(generate).toHaveBeenCalledOnce()
    expect(generate).toHaveBeenCalledWith({
      workspaceId,
      userId: '33333333-3333-4333-8333-333333333333',
      prompt: '캐러셀 1번 표지 이미지로 구성하세요.',
      channel: 'naver_blog',
    })
  })

  it('does not call the image API without an authenticated session', async () => {
    const generate = vi.fn()
    const handler = createConversationImageSlidePostHandler({
      authenticate: async () => null,
      generate,
    })

    const response = await handler(new Request('https://example.com/api/internal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '이미지', channel: 'naver_blog', position: 1 }),
    }), { params: Promise.resolve({ workspaceId }) })

    expect(response.status).toBe(401)
    expect(generate).not.toHaveBeenCalled()
  })
})
