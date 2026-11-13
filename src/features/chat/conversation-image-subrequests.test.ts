import { describe, expect, it, vi } from 'vitest'
import { generateConversationImageBatchViaSubrequests } from './conversation-image-subrequests'
import type { ContentBrief } from './content-interview'

describe('generateConversationImageBatchViaSubrequests', () => {
  it('embeds the interview image direction in every isolated image request', async () => {
    const bodies: string[] = []
    const briefs: unknown[] = []
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { prompt: string; position: number; contentBrief?: unknown }
      bodies.push(body.prompt)
      briefs.push(body.contentBrief)
      return Response.json({ data: { mediaAssetId: '00000000-0000-4000-8000-000000000001', altText: '이미지' } })
    })
    const contentBrief = {
      channels: ['instagram'], goal: { value: 'consultation' }, audience: { value: 'local' },
      audienceProblem: '눈썹 비대칭이 고민인 분',
      textDirection: { structure: { value: 'empathy_info_consult' }, tone: '차분하게', messageAngle: '상담 기준' },
      imageDirection: {
        mood: { value: 'design_consult' }, composition: '눈썹 결 중심', sceneRoles: ['표지'], avoid: ['전후 비교'],
        templateId: 'design_consult', modelAge: '30s', framing: 'upper_body', pose: 'explaining',
        background: 'warm_studio', textOverlay: 'none',
      },
      callToAction: { value: 'consult' }, mustInclude: [], mustAvoid: [], referenceMediaIds: [],
    } satisfies ContentBrief

    await generateConversationImageBatchViaSubrequests({
      workspaceId: '11111111-1111-4111-8111-111111111111', prompt: '바이름 이미지', channel: 'instagram', count: 1,
      idempotencyKey: '22222222-2222-4222-8222-222222222222', origin: 'https://example.com', cookie: 'session=opaque',
      contentBrief, fetcher, createSlideId: () => '33333333-3333-4333-8333-333333333331',
    })

    expect(bodies[0]).toContain('대상 독자와 고민: 눈썹 비대칭이 고민인 분')
    expect(bodies[0]).toContain('피할 장면: 전후 비교')
    expect(bodies[0]).toContain('선택 이미지 템플릿: design_consult')
    expect(bodies[0]).toContain('모델 연령: 30s')
    expect(bodies[0]).toContain('인물 범위: upper_body')
    expect(briefs[0]).toEqual(contentBrief)
  })

  it('generates each requested image in a separate authenticated request and reports progress', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { position: number }
      return Response.json({
        data: {
          mediaAssetId: `00000000-0000-4000-8000-00000000000${body.position}`,
          altText: `이미지 ${body.position}`,
        },
      })
    })
    const progress: number[] = []

    const batch = await generateConversationImageBatchViaSubrequests({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      prompt: '바이름 네이버 블로그 글',
      channel: 'naver_blog',
      count: 3,
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      origin: 'https://example.com',
      cookie: 'session=opaque',
      fetcher,
      createSlideId: (position) => `33333333-3333-4333-8333-33333333333${position}`,
      onSlideProgress: (slide) => progress.push(slide.position),
    })

    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(fetcher.mock.calls.map(([, init]) => new Headers(init?.headers).get('cookie')))
      .toEqual(['session=opaque', 'session=opaque', 'session=opaque'])
    expect(progress).toEqual([1, 2, 3])
    expect(batch.status).toBe('ready_for_review')
    expect(batch.slides.map((slide) => slide.mediaAssetId)).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
    ])
  })

  it('preserves a failed slide and continues with the remaining requests', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { position: number }
      if (body.position === 2) return Response.json({ error: { code: 'IMAGE_RETRYABLE' } }, { status: 503 })
      return Response.json({
        data: {
          mediaAssetId: `00000000-0000-4000-8000-00000000000${body.position}`,
          altText: `이미지 ${body.position}`,
        },
      })
    })

    const batch = await generateConversationImageBatchViaSubrequests({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      prompt: '바이름 네이버 블로그 글',
      channel: 'naver_blog',
      count: 3,
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      origin: 'https://example.com',
      cookie: 'session=opaque',
      fetcher,
      createSlideId: (position) => `33333333-3333-4333-8333-33333333333${position}`,
    })

    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(batch.status).toBe('partial')
    expect(batch.slides[1]).toMatchObject({
      position: 2,
      status: 'failed',
      mediaAssetId: null,
      retryable: true,
      safeErrorCode: 'IMAGE_RETRYABLE',
    })
  })
})
