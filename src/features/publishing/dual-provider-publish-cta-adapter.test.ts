/**
 * ANI-1775: 실제 게시 어댑터가 승인한 CTA 를 provider payload 에 싣는가.
 *
 * 앞선 순수 테스트는 직렬화 함수만 검증한다. 여기서는 기본 프로덕션 어댑터가
 * provider 에 넘기는 인자를 직접 잡아, 승인 지문에 묶인 본문과 같은지 확인한다.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadCredential: vi.fn(),
  igPublish: vi.fn(),
  thPublish: vi.fn(),
}))

vi.mock('@/features/channels/credential-repository', () => ({
  loadChannelCredentialByChannel: mocks.loadCredential,
}))

vi.mock('@/lib/providers/meta-api', () => ({
  createInstagramProvider: () => ({ publish: mocks.igPublish }),
  createThreadsProvider: () => ({ publish: mocks.thPublish }),
}))

import {
  createDefaultProductionAdapter,
  composeInstagramPublishText,
  composeThreadsPublishText,
} from './dual-provider-publish-service'
import { calculateApprovalFingerprint } from '@/lib/evidence/approval-fingerprint'
import type { ExactApprovalPayload } from '@/features/missions/conversational-first-post'

function payloadWith(copies: ExactApprovalPayload['copies']): ExactApprovalPayload {
  return {
    workspaceId: 'ws-cta-adapter',
    missionId: 'mission-cta-adapter',
    channels: [
      { provider: 'instagram', handle: '@shop' },
      { provider: 'threads', handle: '@shop' },
    ],
    copies,
    imageIds: ['https://cdn.example.com/a.jpg'],
    boundVersions: {
      knowledgeVersion: 1,
      textHarnessVersion: 1,
      imageHarnessVersion: 1,
      operatingPolicyVersion: 1,
    },
    rights: { rightsStatus: 'OWNED', consentStatus: 'CONFIRMED' },
  }
}

const copiesWithCta: ExactApprovalPayload['copies'] = {
  instagram: { caption: '신메뉴 소식입니다.', hashtags: ['#가게'], cta: '매장에서 속눈썹 연장 만나보세요.' },
  threads: { content: '신메뉴 소식입니다.', cta: '매장에서 속눈썹 연장 만나보세요.' },
}

describe('기본 게시 어댑터 — 승인한 CTA 를 provider 에 그대로 보낸다', () => {
  let origAllowlist: string | undefined

  beforeEach(() => {
    origAllowlist = process.env.META_LIVE_WORKSPACE_ALLOWLIST
    process.env.META_LIVE_WORKSPACE_ALLOWLIST = '*'
    mocks.loadCredential.mockResolvedValue({ accessToken: 'token-1234567890', externalAccountId: 'acct-1' })
    mocks.igPublish.mockResolvedValue({ providerPostId: 'ig-post-1' })
    mocks.thPublish.mockResolvedValue({ providerPostId: 'th-post-1' })
  })

  afterEach(() => {
    if (origAllowlist !== undefined) process.env.META_LIVE_WORKSPACE_ALLOWLIST = origAllowlist
    else delete process.env.META_LIVE_WORKSPACE_ALLOWLIST
    vi.clearAllMocks()
  })

  it('인스타그램 caption 에 CTA 와 해시태그가 함께 실린다', async () => {
    const payload = payloadWith(copiesWithCta)
    const adapter = createDefaultProductionAdapter('instagram')

    const result = await adapter.publish('instagram', payload)

    expect(result.providerAccepted).toBe(true)
    const sent = mocks.igPublish.mock.calls[0][0].caption as string
    expect(sent).toContain('매장에서 속눈썹 연장 만나보세요.')
    expect(sent).toContain('#가게')
    expect(sent).not.toContain('##')
    expect(sent).toBe(composeInstagramPublishText(payload.copies.instagram))
  })

  it('스레드 text 에 CTA 가 실린다', async () => {
    const payload = payloadWith(copiesWithCta)
    const adapter = createDefaultProductionAdapter('threads')

    const result = await adapter.publish('threads', payload)

    expect(result.providerAccepted).toBe(true)
    const sent = mocks.thPublish.mock.calls[0][0].text as string
    expect(sent).toBe(composeThreadsPublishText(payload.copies.threads))
    expect(sent).toContain('매장에서 속눈썹 연장 만나보세요.')
  })

  it('보낸 본문은 승인 지문에 묶인 원고와 같은 문자열이다', () => {
    const payload = payloadWith(copiesWithCta)
    // 지문은 payload.copies 전체(cta 포함)를 묶는다. 직렬화가 cta 를 빼면
    // 승인한 원고와 게시 본문이 달라진다 — 그 간극이 이 테스트의 대상이다.
    const before = calculateApprovalFingerprint(payload)
    const withoutCta = payloadWith({
      instagram: { caption: '신메뉴 소식입니다.', hashtags: ['#가게'] },
      threads: { content: '신메뉴 소식입니다.' },
    })

    expect(before).not.toBe(calculateApprovalFingerprint(withoutCta))
    expect(composeInstagramPublishText(payload.copies.instagram)).toContain(
      payload.copies.instagram.cta as string,
    )
    expect(composeThreadsPublishText(payload.copies.threads)).toContain(
      payload.copies.threads.cta as string,
    )
  })

  it('CTA 가 없는 초안은 CTA 없이 그대로 게시된다(구분자도 붙지 않는다)', async () => {
    const plain = payloadWith({
      instagram: { caption: '신메뉴 소식입니다.', hashtags: ['#가게'] },
      threads: { content: '신메뉴 소식입니다.' },
    })
    await createDefaultProductionAdapter('instagram').publish('instagram', plain)
    await createDefaultProductionAdapter('threads').publish('threads', plain)

    expect(mocks.igPublish.mock.calls[0][0].caption).toBe('신메뉴 소식입니다.\n\n#가게')
    expect(mocks.thPublish.mock.calls[0][0].text).toBe('신메뉴 소식입니다.')
  })
})
