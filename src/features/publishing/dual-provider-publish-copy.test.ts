/**
 * ANI-1775 후속: 승인한 CTA 가 실제 게시 본문에도 실리는가.
 *
 * 승인 지문과 M07 화면은 `copies[channel].cta` 를 포함하는데, 게시 직렬화가 이를 빼면
 * 사용자가 승인한 원고와 실제 게시물이 달라진다. 직렬화·대조를 여기서 고정한다.
 */
import { describe, expect, it } from 'vitest'
import {
  composeInstagramPublishText,
  composeThreadsPublishText,
  executeDualProviderPublish,
  publishedTextMatches,
  type ChannelPublishAdapter,
} from './dual-provider-publish-service'
import { calculateApprovalFingerprint } from '@/lib/evidence/approval-fingerprint'
import type { ApprovedFirstPostMission, ExactApprovalPayload } from '@/features/missions/conversational-first-post'

describe('게시 본문 직렬화 — CTA 포함', () => {
  it('인스타그램은 캡션 + CTA + 해시태그 순서로 보낸다', () => {
    const text = composeInstagramPublishText({
      caption: '신메뉴 소식입니다.',
      hashtags: ['#가게', '#신메뉴'],
      cta: '매장에서 속눈썹 연장 만나보세요.',
    })
    expect(text).toBe('신메뉴 소식입니다.\n\n매장에서 속눈썹 연장 만나보세요.\n\n#가게 #신메뉴')
  })

  it('해시태그에 # 이 이미 있으면 두 번 붙이지 않는다', () => {
    expect(composeInstagramPublishText({ caption: '본문', hashtags: ['#가게', '신메뉴'] })).toBe(
      '본문\n\n#가게 #신메뉴',
    )
  })

  it('스레드는 본문 + CTA 로 보낸다', () => {
    expect(composeThreadsPublishText({ content: '신메뉴 소식입니다.', cta: '매장에서 만나보세요.' })).toBe(
      '신메뉴 소식입니다.\n\n매장에서 만나보세요.',
    )
  })

  it('CTA 가 없으면 기존 직렬화와 같다(구분자도 붙이지 않는다)', () => {
    expect(composeInstagramPublishText({ caption: '본문', hashtags: ['#가게'] })).toBe('본문\n\n#가게')
    expect(composeInstagramPublishText({ caption: '본문' })).toBe('본문')
    expect(composeThreadsPublishText({ content: '본문' })).toBe('본문')
  })

  it('공백뿐인 CTA 는 싣지 않는다', () => {
    expect(composeInstagramPublishText({ caption: '본문', cta: '   ' })).toBe('본문')
    expect(composeThreadsPublishText({ content: '본문', cta: '\n ' })).toBe('본문')
  })
})

describe('게시 본문 대조', () => {
  it('공백·줄바꿈 차이만 있으면 같은 것으로 본다', () => {
    expect(publishedTextMatches('본문  매장에서 만나보세요.', '본문\n\n매장에서 만나보세요.')).toBe(true)
  })

  it('문자가 다르면 어긋난 것으로 본다', () => {
    expect(publishedTextMatches('본문', '본문\n\n매장에서 만나보세요.')).toBe(false)
  })

  it('관측 본문이 없으면 판정하지 않는다', () => {
    expect(publishedTextMatches(undefined, '본문')).toBeNull()
    expect(publishedTextMatches('', '본문')).toBeNull()
  })
})

function fixture(copies: ExactApprovalPayload['copies']) {
  const payload: ExactApprovalPayload = {
    workspaceId: 'ws-cta-1',
    missionId: 'mission-cta-1',
    channels: [{ provider: 'instagram', handle: '@shop' }],
    copies,
    imageIds: ['asset-1'],
    boundVersions: {
      knowledgeVersion: 1,
      textHarnessVersion: 1,
      imageHarnessVersion: 1,
      operatingPolicyVersion: 1,
    },
    rights: { rightsStatus: 'OWNED', consentStatus: 'CONFIRMED' },
  }
  const approved: ApprovedFirstPostMission = Object.freeze({
    id: 'appr-cta-1',
    workspaceId: payload.workspaceId,
    missionId: payload.missionId,
    approvalId: 'appr-rec-cta-1',
    status: 'APPROVED_FOR_PUBLISH',
    approvedFingerprint: calculateApprovalFingerprint(payload),
    payload,
    approvedByUserId: 'user-1',
    approvedAt: new Date().toISOString(),
  })
  return { approved, payload }
}

function adapterWithReadback(caption?: string): ChannelPublishAdapter {
  return {
    publish: async () => ({ providerAccepted: true, providerPostId: 'post-1', requestId: 'req-1' }),
    readback: async () => ({
      isLive: true,
      permalink: 'https://www.instagram.com/p/abc',
      verifiedAt: new Date().toISOString(),
      caption,
    }),
  }
}

const copiesWithCta: ExactApprovalPayload['copies'] = {
  instagram: { caption: '신메뉴 소식입니다.', hashtags: ['#가게'], cta: '매장에서 만나보세요.' },
  threads: { content: '신메뉴 소식입니다.', cta: '매장에서 만나보세요.' },
}

describe('executeDualProviderPublish — 게시 본문이 승인 원고와 같을 때만 VERIFIED', () => {
  it('게시 본문에 CTA 가 그대로 있으면 EXTERNALLY_VERIFIED', async () => {
    const { approved, payload } = fixture(copiesWithCta)
    const result = await executeDualProviderPublish({
      approvedMission: approved,
      currentPayload: payload,
      adapters: { instagram: adapterWithReadback(composeInstagramPublishText(copiesWithCta.instagram)) },
    })

    expect(result.receipts.instagram?.stage).toBe('EXTERNALLY_VERIFIED')
    expect(result.receipts.instagram?.permalink).toBe('https://www.instagram.com/p/abc')
  })

  it('게시 본문에서 CTA 가 빠졌으면 VERIFIED 로 올리지 않는다', async () => {
    const { approved, payload } = fixture(copiesWithCta)
    // CTA 를 빼고 caption + hashtags 만 게시된 경우(이번 결함의 실제 모양)
    const result = await executeDualProviderPublish({
      approvedMission: approved,
      currentPayload: payload,
      adapters: { instagram: adapterWithReadback('신메뉴 소식입니다.\n\n#가게') },
    })

    expect(result.receipts.instagram?.stage).toBe('PROVIDER_ACCEPTED')
    expect(result.receipts.instagram?.errorMessage).toContain('PUBLISHED_COPY_MISMATCH')
    expect(result.receipts.instagram?.permalink).toBeUndefined()
    expect(result.overallStatus).toBe('FAILED')
  })

  it('승인 CTA 가 있는데 인스타그램 readback 본문이 없으면 COPY_UNVERIFIED 로 막는다', async () => {
    const { approved, payload } = fixture(copiesWithCta)
    const result = await executeDualProviderPublish({
      approvedMission: approved,
      currentPayload: payload,
      adapters: { instagram: adapterWithReadback(undefined) },
    })

    expect(result.receipts.instagram?.stage).toBe('PROVIDER_ACCEPTED')
    expect(result.receipts.instagram?.errorMessage).toContain('COPY_UNVERIFIED')
    // permalink·verifiedAt 을 만들지 않는다.
    expect(result.receipts.instagram?.permalink).toBeUndefined()
    expect(result.receipts.instagram?.verifiedAt).toBeUndefined()
    expect(result.overallStatus).toBe('FAILED')
  })

  it('승인 CTA 가 있는데 스레드 readback 본문이 없으면 COPY_UNVERIFIED 로 막는다', async () => {
    const threadsOnly: ExactApprovalPayload['copies'] = {
      instagram: { caption: '신메뉴 소식입니다.' },
      threads: { content: '신메뉴 소식입니다.', cta: '매장에서 만나보세요.' },
    }
    const payload: ExactApprovalPayload = {
      ...fixture(threadsOnly).payload,
      channels: [{ provider: 'threads', handle: '@shop' }],
    }
    const approved: ApprovedFirstPostMission = Object.freeze({
      ...fixture(threadsOnly).approved,
      approvedFingerprint: calculateApprovalFingerprint(payload),
      payload,
    })

    const result = await executeDualProviderPublish({
      approvedMission: approved,
      currentPayload: payload,
      adapters: { threads: adapterWithReadback(undefined) },
    })

    expect(result.receipts.threads?.stage).toBe('PROVIDER_ACCEPTED')
    expect(result.receipts.threads?.errorMessage).toContain('COPY_UNVERIFIED')
    expect(result.receipts.threads?.permalink).toBeUndefined()
    expect(result.receipts.threads?.verifiedAt).toBeUndefined()
  })

  it('CTA 가 없는 원고는 본문이 없어도 기존 permalink 계약으로 판정한다', async () => {
    const plain: ExactApprovalPayload['copies'] = {
      instagram: { caption: '신메뉴 소식입니다.' },
      threads: { content: '신메뉴 소식입니다.' },
    }
    const { approved, payload } = fixture(plain)
    const result = await executeDualProviderPublish({
      approvedMission: approved,
      currentPayload: payload,
      adapters: { instagram: adapterWithReadback(undefined) },
    })

    expect(result.receipts.instagram?.stage).toBe('EXTERNALLY_VERIFIED')
    expect(result.receipts.instagram?.permalink).toBe('https://www.instagram.com/p/abc')
  })

  it('CTA 가 없는 초안은 게시 본문도 CTA 없이 그대로다', async () => {
    const plain: ExactApprovalPayload['copies'] = {
      instagram: { caption: '신메뉴 소식입니다.' },
      threads: { content: '신메뉴 소식입니다.' },
    }
    const { approved, payload } = fixture(plain)
    const result = await executeDualProviderPublish({
      approvedMission: approved,
      currentPayload: payload,
      adapters: { instagram: adapterWithReadback('신메뉴 소식입니다.') },
    })

    expect(result.receipts.instagram?.stage).toBe('EXTERNALLY_VERIFIED')
  })
})
