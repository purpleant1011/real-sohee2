import { describe, expect, it } from 'vitest'

import { externalActionSchema } from './schema'

const validAction = {
  workspaceId: '10000000-0000-4000-8000-000000000001',
  channel: 'daangn_business',
  actionKind: 'news_post',
  target: {
    externalId: 'daangn-business-001',
    label: '소희 뷰티 성수점',
  },
  contentVersion: {
    id: '20000000-0000-4000-8000-000000000001',
    fingerprint: 'a'.repeat(64),
    text: '이번 주 신규 예약 혜택을 안내합니다.',
    media: [
      { id: '30000000-0000-4000-8000-000000000001', position: 0, signedUrl: 'https://storage.example.test/one.png' },
    ],
  },
  approval: {
    id: '40000000-0000-4000-8000-000000000001',
    fingerprint: 'b'.repeat(64),
  },
}

describe('external action schema', () => {
  it('accepts exact local publishing action kinds', () => {
    expect(externalActionSchema.parse({
      ...validAction,
      channel: 'naver_blog',
      actionKind: 'blog_post',
    })).toMatchObject({ channel: 'naver_blog', actionKind: 'blog_post' })

    expect(externalActionSchema.parse({
      ...validAction,
      actionKind: 'business_news_post',
    })).toMatchObject({ channel: 'daangn_business', actionKind: 'business_news_post' })
  })

  it('accepts twenty ordered media items only for Naver Blog', () => {
    const media = Array.from({ length: 20 }, (_, index) => ({
      id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      position: index,
      signedUrl: `https://storage.example.test/${index + 1}.png`,
    }))
    expect(externalActionSchema.safeParse({
      ...validAction, channel: 'naver_blog', actionKind: 'blog_post',
      contentVersion: { ...validAction.contentVersion, media },
    }).success).toBe(true)
    expect(externalActionSchema.safeParse({
      ...validAction,
      contentVersion: { ...validAction.contentVersion, media: media.slice(0, 11) },
    }).success).toBe(false)
  })

  it('accepts exact Meta publishing and reply action kinds', () => {
    expect(externalActionSchema.parse({
      ...validAction,
      channel: 'instagram',
      actionKind: 'feed_publish',
    })).toMatchObject({ channel: 'instagram', actionKind: 'feed_publish' })

    expect(externalActionSchema.parse({
      ...validAction,
      channel: 'threads',
      actionKind: 'thread_publish',
    })).toMatchObject({ channel: 'threads', actionKind: 'thread_publish' })

    expect(externalActionSchema.parse({
      ...validAction,
      channel: 'instagram',
      actionKind: 'comment_reply',
      contentVersion: { ...validAction.contentVersion, media: [] },
    })).toMatchObject({ channel: 'instagram', actionKind: 'comment_reply' })
  })

  it('rejects local publishing action and channel mismatches', () => {
    expect(externalActionSchema.safeParse({
      ...validAction,
      channel: 'naver_blog',
      actionKind: 'business_news_post',
    }).success).toBe(false)
    expect(externalActionSchema.safeParse({
      ...validAction,
      channel: 'daangn_business',
      actionKind: 'blog_post',
    }).success).toBe(false)
    expect(externalActionSchema.safeParse({
      ...validAction,
      channel: 'instagram',
      actionKind: 'thread_publish',
    }).success).toBe(false)
    expect(externalActionSchema.safeParse({
      ...validAction,
      channel: 'threads',
      actionKind: 'feed_publish',
    }).success).toBe(false)
    expect(externalActionSchema.safeParse({
      ...validAction,
      channel: 'tiktok',
      actionKind: 'feed_publish',
    }).success).toBe(false)
  })

  it('rejects any password-like field', () => {
    expect(externalActionSchema.safeParse({
      ...validAction,
      password: 'do-not-store',
    }).success).toBe(false)
  })

  it('rejects raw cookie, OTP, captcha, and session secret fields', () => {
    for (const key of ['cookie', 'otp', 'recoveryCode', 'captchaAnswer', 'accessToken', 'sessionCookie']) {
      expect(externalActionSchema.safeParse({ ...validAction, [key]: 'never-store' }).success).toBe(false)
    }
  })

  it('requires exact approval fingerprint, target, text, and ordered media', () => {
    expect(externalActionSchema.safeParse(validAction).success).toBe(true)
    expect(externalActionSchema.safeParse({
      ...validAction,
      contentVersion: { ...validAction.contentVersion, media: [
        { id: '30000000-0000-4000-8000-000000000001', position: 1, signedUrl: 'https://storage.example.test/one.png' },
      ] },
    }).success).toBe(false)
  })
})
