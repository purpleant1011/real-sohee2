import { describe, expect, it, vi } from 'vitest'
import { getLatestPublishedDestinationUrl } from './latest-destination'

describe('getLatestPublishedDestinationUrl', () => {
  const workspaceId = '11111111-1111-4111-8111-111111111111'
  const contentId = '22222222-2222-4222-8222-222222222222'

  it('유효하지 않은 UUID는 즉시 null을 반환한다', async () => {
    const res = await getLatestPublishedDestinationUrl('invalid-ws', contentId)
    expect(res).toBeNull()
  })

  it('성공한 최신 1건의 publish_attempts 및 social_post_tracking destination_url (https)을 반환한다', async () => {
    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === 'schedules') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [{ id: 'sched-1' }],
              error: null,
            }),
          }
        }
        if (table === 'publish_attempts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [{ id: 'att-1', finished_at: '2026-08-11T01:02:00.000Z' }],
              error: null,
            }),
          }
        }
        if (table === 'social_post_tracking') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { destination_url: 'https://www.instagram.com/p/ABC123xyz/' },
              error: null,
            }),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    const res = await getLatestPublishedDestinationUrl(workspaceId, contentId, mockClient as never)
    expect(res).toBe('https://www.instagram.com/p/ABC123xyz/')
  })

  it('https가 아닌 destination_url은 null을 반환한다', async () => {
    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === 'schedules') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [{ id: 'sched-1' }],
              error: null,
            }),
          }
        }
        if (table === 'publish_attempts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [{ id: 'att-1', finished_at: '2026-08-11T01:02:00.000Z' }],
              error: null,
            }),
          }
        }
        if (table === 'social_post_tracking') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { destination_url: 'javascript:alert(1)' },
              error: null,
            }),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    const res = await getLatestPublishedDestinationUrl(workspaceId, contentId, mockClient as never)
    expect(res).toBeNull()
  })

  it('스케줄이 없으면 null을 반환한다', async () => {
    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [],
          error: null,
        }),
      }),
    }

    const res = await getLatestPublishedDestinationUrl(workspaceId, contentId, mockClient as never)
    expect(res).toBeNull()
  })
})
