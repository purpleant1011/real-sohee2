import { describe, it, expect } from 'vitest'
import { externalActionSchema } from '@/features/external-actions/schema'
import type { ExternalActionChannel, ExternalActionKind } from '@/features/external-actions/types'

describe('Meta External Action Schema & Contract (ANI-995)', () => {
  const baseAction = {
    workspaceId: '10000000-0000-4000-8000-000000000001',
    target: {
      externalId: 'act_meta_123456',
      label: '소희 공식 인스타그램',
    },
    contentVersion: {
      id: '20000000-0000-4000-8000-000000000001',
      fingerprint: 'a'.repeat(64),
      text: '소희 7차 정본 인스타그램 피드 포스팅 테스트입니다.',
      media: [
        { id: '30000000-0000-4000-8000-000000000001', position: 0, signedUrl: 'https://images.example.com/feed.jpg' },
      ],
    },
    approval: {
      id: '40000000-0000-4000-8000-000000000001',
      fingerprint: 'b'.repeat(64),
    },
  }

  describe('Channel and Action Kind Vocabulary', () => {
    it('accepts valid Instagram action kinds (feed_publish, story_publish, comment_reply, dm_reply)', () => {
      const feedRes = externalActionSchema.safeParse({
        ...baseAction,
        channel: 'instagram',
        actionKind: 'feed_publish',
      })
      expect(feedRes.success).toBe(true)

      const storyRes = externalActionSchema.safeParse({
        ...baseAction,
        channel: 'instagram',
        actionKind: 'story_publish',
      })
      expect(storyRes.success).toBe(true)

      const commentRes = externalActionSchema.safeParse({
        ...baseAction,
        channel: 'instagram',
        actionKind: 'comment_reply',
        contentVersion: { ...baseAction.contentVersion, media: [] },
      })
      expect(commentRes.success).toBe(true)

      const dmRes = externalActionSchema.safeParse({
        ...baseAction,
        channel: 'instagram',
        actionKind: 'dm_reply',
        contentVersion: { ...baseAction.contentVersion, media: [] },
      })
      expect(dmRes.success).toBe(true)
    })

    it('accepts valid Threads action kinds (thread_publish, comment_reply)', () => {
      const threadRes = externalActionSchema.safeParse({
        ...baseAction,
        channel: 'threads',
        actionKind: 'thread_publish',
      })
      expect(threadRes.success).toBe(true)

      const replyRes = externalActionSchema.safeParse({
        ...baseAction,
        channel: 'threads',
        actionKind: 'comment_reply',
        contentVersion: { ...baseAction.contentVersion, media: [] },
      })
      expect(replyRes.success).toBe(true)
    })

    it('rejects unknown or unmapped channels', () => {
      const res = externalActionSchema.safeParse({
        ...baseAction,
        channel: 'tiktok' as unknown as ExternalActionChannel,
        actionKind: 'feed_publish',
      })
      expect(res.success).toBe(false)
    })

    it('rejects unknown or invalid action kinds for a channel', () => {
      const res = externalActionSchema.safeParse({
        ...baseAction,
        channel: 'threads',
        actionKind: 'feed_publish' as unknown as ExternalActionKind,
      })
      expect(res.success).toBe(false)
    })
  })

  describe('Payload & Security Isolation', () => {
    it('rejects secrets or credential injection in action payload', () => {
      const res = externalActionSchema.safeParse({
        ...baseAction,
        channel: 'instagram',
        actionKind: 'feed_publish',
        accessToken: 'EAABsb...',
      })
      expect(res.success).toBe(false)
    })

    it('enforces maximum media limits for Meta channels (10 media)', () => {
      const elevenMedia = Array.from({ length: 11 }, (_, i) => ({
        id: `30000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
        position: i,
        signedUrl: `https://images.example.com/img-${i}.jpg`,
      }))

      const res = externalActionSchema.safeParse({
        ...baseAction,
        channel: 'instagram',
        actionKind: 'feed_publish',
        contentVersion: {
          ...baseAction.contentVersion,
          media: elevenMedia,
        },
      })
      expect(res.success).toBe(false)
    })
  })
})
