import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { calculateApprovalFingerprint, type CanonicalApprovalInput } from './approval-fingerprint'

const base: CanonicalApprovalInput = {
  workspaceId: 'ws-1',
  missionId: 'mission-1',
  channels: [{ provider: 'instagram', handle: '@shop' }],
  copies: {
    instagram: { caption: '신메뉴 소식입니다.', hashtags: ['#가게'] },
    threads: { content: '신메뉴 소식입니다.' },
  },
  imageIds: ['img-1'],
  boundVersions: {
    knowledgeVersion: 1,
    textHarnessVersion: 2,
    imageHarnessVersion: 3,
    operatingPolicyVersion: 4,
  },
  rights: { rightsStatus: 'OWNED', consentStatus: 'NOT_APPLICABLE' },
}

/** ANI-1775 이전 canonical 직렬화. CTA 키가 없는 초안의 지문이 바뀌지 않았는지 비교한다. */
function legacyFingerprint(payload: CanonicalApprovalInput): string {
  const canonical = {
    workspaceId: payload.workspaceId,
    missionId: payload.missionId,
    channels: [...payload.channels]
      .sort((a, b) => a.provider.localeCompare(b.provider))
      .map((c) => ({ provider: c.provider, handle: c.handle })),
    copies: {
      instagram: {
        caption: payload.copies.instagram.caption,
        hashtags: payload.copies.instagram.hashtags ? [...payload.copies.instagram.hashtags] : [],
      },
      threads: { content: payload.copies.threads.content },
    },
    imageIds: [...payload.imageIds].sort(),
    boundVersions: payload.boundVersions,
    rights: payload.rights,
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

describe('승인 지문 — CTA 가산은 기존 지문을 바꾸지 않는다', () => {
  it('cta 가 없는 초안은 이전 canonical 지문과 같다', () => {
    expect(calculateApprovalFingerprint(base)).toBe(legacyFingerprint(base))
  })

  it('공백뿐인 cta 는 없는 것으로 취급한다', () => {
    const blank: CanonicalApprovalInput = {
      ...base,
      copies: {
        instagram: { ...base.copies.instagram, cta: '   ' },
        threads: { ...base.copies.threads, cta: '' },
      },
    }
    expect(calculateApprovalFingerprint(blank)).toBe(legacyFingerprint(base))
  })

  it('cta 가 있으면 지문에 묶이고, 값이 바뀌면 지문도 바뀐다', () => {
    const withCta: CanonicalApprovalInput = {
      ...base,
      copies: {
        instagram: { ...base.copies.instagram, cta: '매장에서 속눈썹 연장 만나보세요.' },
        threads: { content: base.copies.threads.content, cta: '매장에서 속눈썹 연장 만나보세요.' },
      },
    }
    expect(calculateApprovalFingerprint(withCta)).not.toBe(legacyFingerprint(base))

    const changed: CanonicalApprovalInput = {
      ...withCta,
      copies: {
        instagram: { ...withCta.copies.instagram, cta: '영업시간 확인하고 편하게 방문해 주세요.' },
        threads: { ...withCta.copies.threads },
      },
    }
    expect(calculateApprovalFingerprint(changed)).not.toBe(calculateApprovalFingerprint(withCta))

    const same: CanonicalApprovalInput = {
      ...withCta,
      copies: {
        instagram: { ...withCta.copies.instagram },
        threads: { ...withCta.copies.threads },
      },
    }
    expect(calculateApprovalFingerprint(same)).toBe(calculateApprovalFingerprint(withCta))
  })
})
