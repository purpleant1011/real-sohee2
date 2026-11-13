import { describe, expect, it, vi } from 'vitest'
import {
  crossPostToSocial,
  buildInstagramCaption,
  buildThreadsCaption,
} from './cross-post-to-social'

describe('crossPostToSocial (네이버 블로그 ➡️ 인스타그램/스레드 OSMU 엔진)', () => {
  const workspaceId = '10000000-0000-4000-8000-000000000001'
  const userId = '20000000-0000-4000-8000-000000000001'
  const naverContentId = '40000000-0000-4000-8000-000000000001'
  const naverVersionId = '50000000-0000-4000-8000-000000000001'

  const sampleSections = [
    { heading: '가을철 보습 관리', body: '환절기에는 유수분 밸런스가 쉽게 무너집니다. 피부 장벽을 지키는 세심한 관리가 필요합니다.' },
    { heading: '맞춤 케어 솔루션', body: '개인 피부 타입에 맞는 앰플을 사용하여 자극 없이 촉촉함을 유지해 드립니다.' },
  ]

  it('buildInstagramCaption formats title, intro, sections with bullets, and CTA nicely', () => {
    const caption = buildInstagramCaption(
      '가을철 피부관리 노하우',
      '날씨가 쌀쌀해지며 피부 고민이 늘어나는 계절입니다.',
      sampleSections,
      '네이버 예약으로 바로 상담받기',
    )

    expect(caption).toContain('✨ 가을철 피부관리 노하우')
    expect(caption).toContain('날씨가 쌀쌀해지며 피부 고민이 늘어나는 계절입니다.')
    expect(caption).toContain('📍 가을철 보습 관리')
    expect(caption).toContain('📍 맞춤 케어 솔루션')
    expect(caption).toContain('💬 네이버 예약으로 바로 상담받기')
  })

  it('buildThreadsCaption creates conversational, friendly short-form text under 480 chars', () => {
    const caption = buildThreadsCaption('가을철 피부관리 노하우', sampleSections)

    expect(caption).toContain('가을철 피부관리 노하우에 대해 손님들이 많이 물어보시는데요')
    expect(caption).toContain('환절기에는 유수분 밸런스가 쉽게 무너집니다.')
    expect(caption).toContain('궁금한 점 있으시면 언제든 편하게 댓글 남겨주세요! 😊')
    expect(caption.length).toBeLessThanOrEqual(480)
  })

  it('crossPostToSocial creates both Instagram and Threads posts reusing Naver media assets', async () => {
    const createdItems: any[] = []
    const createdVersions: any[] = []

    const mockCreateItem = vi.fn(async (_client, input: any) => {
      const contentId = `new-content-${input.channel}`
      createdItems.push({ ...input, contentId })
      return { data: { contentId, next: '' } }
    })

    const mockCreateVersion = vi.fn(async (_client, input: any) => {
      const versionId = `new-version-${input.structuredPayload.channel}`
      createdVersions.push({ ...input, versionId })
      return { data: { versionId, versionNumber: 1, fingerprint: 'f'.repeat(64) } }
    })

    const fakeUserClient = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: naverVersionId,
            content_id: naverContentId,
            content_items: { title: '가을철 피부관리 노하우' },
            structured_payload: {
              channel: 'naver_blog',
              title: '가을철 피부관리 노하우',
              introduction: '환절기 피부 고민 해결법',
              sections: sampleSections,
              keywords: ['#피부관리', '#가을피부', '#뷰티샵'],
              imagePlacements: [
                { mediaId: 'media-001', placement: 'cover' },
                { mediaId: 'media-002', placement: 'inline' },
              ],
            },
          },
          error: null,
        }),
      })),
    }

    const result = await crossPostToSocial({
      workspaceId,
      userId,
      naverContentId,
      naverVersionId,
      userClient: fakeUserClient as any,
      deps: {
        createItem: mockCreateItem as any,
        createVersion: mockCreateVersion as any,
      },
    })

    expect(result.instagram).toBeDefined()
    expect(result.threads).toBeDefined()
    expect(result.instagram?.contentId).toBe('new-content-instagram')
    expect(result.threads?.contentId).toBe('new-content-threads')

    // Verify Instagram item & version
    expect(mockCreateItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ channel: 'instagram' }),
    )
    const igVersion = createdVersions.find((v) => v.structuredPayload.channel === 'instagram')
    expect(igVersion.mediaIds).toEqual(['media-001', 'media-002'])
    expect(igVersion.structuredPayload.slides).toHaveLength(2)

    // Verify Threads item & version
    expect(mockCreateItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ channel: 'threads' }),
    )
    const threadsVersion = createdVersions.find((v) => v.structuredPayload.channel === 'threads')
    expect(threadsVersion.mediaIds).toEqual(['media-001'])
  })
})
