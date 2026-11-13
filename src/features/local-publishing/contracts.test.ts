import { describe, expect, it } from 'vitest'

import { checkpointSchema, localPublishJobSchema } from './contracts'

const baseJob = {
  id: '10000000-0000-4000-8000-000000000001',
  workspaceId: '10000000-0000-4000-8000-000000000002',
  channel: 'naver_blog',
  actionKind: 'blog_post',
  targetConnectionId: '10000000-0000-4000-8000-000000000003',
  targetExternalId: 'findk3',
  targetLabel: 'findk3 테스트 블로그',
  contentVersionId: '10000000-0000-4000-8000-000000000004',
  versionFingerprint: 'a'.repeat(64),
  approvalId: '10000000-0000-4000-8000-000000000005',
  approvalFingerprint: 'a'.repeat(64),
  structuredPayload: {
    channel: 'naver_blog',
    title: '승인된 제목',
    introduction: '승인된 도입',
    sections: [{ heading: '첫 구역', body: '승인된 본문' }],
    keywords: ['소희'],
    imagePlacements: [{
      mediaId: '10000000-0000-4000-8000-000000000006',
      placement: 'cover',
      altText: '승인 이미지',
    }],
    cta: '문의해 주세요.',
  },
  media: [{
    id: '10000000-0000-4000-8000-000000000006',
    position: 0,
    signedUrl: 'https://storage.example.test/approved.png?token=secret',
    digest: 'b'.repeat(64),
  }],
  submitPermitRequired: true,
} as const

describe('local publish contracts', () => {
  it('accepts an exact Naver job', () => {
    expect(localPublishJobSchema.parse(baseJob)).toMatchObject({
      channel: 'naver_blog',
      actionKind: 'blog_post',
      targetExternalId: 'findk3',
    })
  })

  it('accepts twenty ordered Naver media items but keeps Daangn at ten', () => {
    const media = Array.from({ length: 20 }, (_, index) => ({
      id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      position: index,
      signedUrl: `https://storage.example.test/approved-${index + 1}.png`,
      digest: String((index % 10)).repeat(64),
    }))
    const imagePlacements = media.map((item, index) => ({
      mediaId: item.id,
      placement: index === 0 ? 'cover' as const : 'detail' as const,
      altText: `승인 이미지 ${index + 1}`,
    }))
    expect(localPublishJobSchema.safeParse({
      ...baseJob,
      structuredPayload: { ...baseJob.structuredPayload, imagePlacements },
      media,
    }).success).toBe(true)
    expect(localPublishJobSchema.safeParse({
      ...baseJob,
      channel: 'daangn_business', actionKind: 'business_news_post',
      structuredPayload: {
        channel: 'daangn_business', title: '소식', body: '본문',
        mediaIds: media.slice(0, 11).map((item) => item.id), localCta: '문의', targetNeighborhood: '청라동',
      },
      media: media.slice(0, 11),
    }).success).toBe(false)
  })

  it('rejects mismatched approval and version fingerprints', () => {
    expect(localPublishJobSchema.safeParse({
      ...baseJob,
      approvalFingerprint: 'c'.repeat(64),
    }).success).toBe(false)
  })

  it('rejects channel payload mismatches and non-contiguous media', () => {
    expect(localPublishJobSchema.safeParse({
      ...baseJob,
      structuredPayload: { ...baseJob.structuredPayload, channel: 'daangn_business' },
    }).success).toBe(false)
    expect(localPublishJobSchema.safeParse({
      ...baseJob,
      media: [{ ...baseJob.media[0], position: 1 }],
    }).success).toBe(false)
  })

  it('accepts an observed success checkpoint and rejects secret-shaped extras', () => {
    const checkpoint = {
      jobId: baseJob.id,
      leaseId: '10000000-0000-4000-8000-000000000007',
      phase: 'succeeded',
      observedAt: '2026-08-19T06:00:00.000Z',
      providerReference: 'naver-post-1',
      resultUrl: 'https://blog.naver.com/findk3/223000000000',
    }
    expect(checkpointSchema.safeParse(checkpoint).success).toBe(true)
    expect(checkpointSchema.safeParse({ ...checkpoint, cookie: 'never-store' }).success).toBe(false)
  })

  it('requires a failure code for terminal failures', () => {
    expect(checkpointSchema.safeParse({
      jobId: baseJob.id,
      leaseId: '10000000-0000-4000-8000-000000000007',
      phase: 'failed_before_submit',
      observedAt: '2026-08-19T06:00:00.000Z',
    }).success).toBe(false)
  })
})
