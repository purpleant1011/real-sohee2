import { describe, it, expect } from 'vitest'
import {
  parseContentApiResponse,
  type ContentApiResponse,
  type ContentViewState,
} from '../content-view-state'

describe('Content API Contract & State Separation (ANI-1190, ANI-1208, ANI-1209)', () => {
  const targetWorkspaceId = '00000000-0000-4000-8000-0000000000a2'

  const sampleItems = [
    {
      contentId: 'c1000000-0000-4000-8000-000000000001',
      workspaceId: targetWorkspaceId,
      title: '자연눈썹 시술 안내',
      channel: 'instagram',
      caption: '자연스러운 눈썹 결을 살려드립니다.',
      hashtags: ['#자연눈썹', '#바이름'],
      mediaUrls: ['https://example.com/image1.jpg'],
      currentVersionId: 'v1000000-0000-4000-8000-000000000001',
      versionNumber: 1,
      fingerprint: 'fp-1',
      isApproved: true,
      approvalId: 'a1000000-0000-4000-8000-000000000001',
      status: 'published',
      createdAt: '2026-09-03T10:00:00.000Z',
    },
  ]

  it('MUST NOT depend on data.success and parse contents directly from canonical contract', () => {
    // Canonical payload without "success: true" property
    const canonicalPayload: ContentApiResponse = {
      contents: sampleItems as any,
    }

    const result = parseContentApiResponse(canonicalPayload, targetWorkspaceId)
    expect(result.status).toBe('DATA')
    if (result.status === 'DATA') {
      expect(result.items.length).toBe(1)
      expect(result.items[0].id).toBe('c1000000-0000-4000-8000-000000000001')
      expect(result.items[0].title).toBe('자연눈썹 시술 안내')
    }
  })

  it('MUST distinguish ERROR from EMPTY when API fails', () => {
    const errorPayload = {
      error: { code: 'FETCH_FAILED', message: 'Internal Server Error' },
    }

    const result = parseContentApiResponse(errorPayload, targetWorkspaceId)
    expect(result.status).toBe('ERROR')
    if (result.status === 'ERROR') {
      expect(result.errorMessage).toBe('Internal Server Error')
    }
  })

  it('MUST mark EMPTY only when contents array is legitimately empty', () => {
    const emptyPayload: ContentApiResponse = {
      contents: [],
    }

    const result = parseContentApiResponse(emptyPayload, targetWorkspaceId)
    expect(result.status).toBe('EMPTY')
    if (result.status === 'EMPTY') {
      expect(result.items.length).toBe(0)
    }
  })

  it('MUST isolate workspace contents and discard foreign workspace items', () => {
    const mixedPayload: ContentApiResponse = {
      contents: [
        ...sampleItems,
        {
          contentId: 'foreign-content-999',
          workspaceId: 'b1000000-0000-4000-8000-000000000001', // Foreign workspace!
          title: '다른 매장 콘텐츠',
          channel: 'instagram',
          caption: '외래 콘텐츠',
          hashtags: [],
          mediaUrls: [],
          currentVersionId: 'v-foreign',
          versionNumber: 1,
          fingerprint: 'fp-foreign',
          isApproved: false,
          approvalId: null,
          status: 'draft',
          createdAt: '2026-09-03T10:00:00.000Z',
        } as any,
      ],
    }

    const result = parseContentApiResponse(mixedPayload, targetWorkspaceId)
    expect(result.status).toBe('DATA')
    if (result.status === 'DATA') {
      expect(result.items.length).toBe(1)
      expect(result.items[0].id).toBe('c1000000-0000-4000-8000-000000000001')
      // Foreign workspace content must be filtered out
      expect(result.items.some((item) => item.id === 'foreign-content-999')).toBe(false)
    }
  })
})
