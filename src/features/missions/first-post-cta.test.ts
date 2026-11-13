import { describe, expect, it } from 'vitest'
import {
  FIRST_POST_CTA_MAX_LENGTH,
  attachFirstPostCtas,
  buildChannelCta,
  type FirstPostCtaEvidence,
} from './first-post-cta'
import type { ExactApprovalCopies } from './conversational-first-post'
import { approvalBlockers } from '@/features/mobile-firstpost/approval-review'
import { draftApprovalInput, type DraftDto } from '@/features/mobile-firstpost/draft-mapper'

const bothChannels = [
  { provider: 'instagram', handle: '@shop' },
  { provider: 'threads', handle: '@shop' },
]

const baseCopies: ExactApprovalCopies = {
  instagram: { caption: '신메뉴 소식입니다.', hashtags: ['#가게'] },
  threads: { content: '신메뉴 소식입니다.' },
}

function evidence(overrides: Partial<FirstPostCtaEvidence> = {}): FirstPostCtaEvidence {
  return {
    businessName: '바이름',
    signatureServices: ['속눈썹 연장'],
    operatingHours: '10:00 - 20:00',
    connectedChannels: bothChannels,
    ...overrides,
  }
}

describe('buildChannelCta — 근거가 있을 때만 문구를 만든다', () => {
  it('연결된 채널 + 대표 서비스가 있으면 서비스 CTA 를 만든다', () => {
    expect(buildChannelCta('instagram', evidence())).toBe('매장에서 속눈썹 연장 만나보세요.')
    expect(buildChannelCta('threads', evidence())).toBe('매장에서 속눈썹 연장 만나보세요.')
  })

  it('대표 서비스가 없고 영업시간만 있으면 안내 CTA 로 넘어간다', () => {
    expect(buildChannelCta('instagram', evidence({ signatureServices: [] }))).toBe(
      '영업시간 확인하고 편하게 방문해 주세요.',
    )
    expect(buildChannelCta('instagram', evidence({ signatureServices: undefined }))).toBe(
      '영업시간 확인하고 편하게 방문해 주세요.',
    )
  })

  it('비즈니스 근거(서비스·영업시간)가 없으면 만들지 않는다', () => {
    expect(buildChannelCta('instagram', evidence({ signatureServices: [], operatingHours: '' }))).toBeNull()
    expect(buildChannelCta('instagram', evidence({ signatureServices: [], operatingHours: null }))).toBeNull()
  })

  it('매장명만으로는 만들지 않는다', () => {
    expect(buildChannelCta('instagram', evidence({ businessName: '' }))).toBeNull()
    expect(buildChannelCta('instagram', evidence({ businessName: '   ' }))).toBeNull()
  })

  it('채널 연결 근거(핸들)가 없으면 만들지 않는다', () => {
    expect(buildChannelCta('instagram', evidence({ connectedChannels: [{ provider: 'threads', handle: '@shop' }] }))).toBeNull()
    expect(buildChannelCta('instagram', evidence({ connectedChannels: [{ provider: 'instagram', handle: '  ' }] }))).toBeNull()
    expect(buildChannelCta('instagram', evidence({ connectedChannels: [] }))).toBeNull()
  })

  it('문구가 길이 제한을 넘으면 다음 근거로 넘어가고, 모두 넘으면 생략한다', () => {
    const longService = '아주'.repeat(FIRST_POST_CTA_MAX_LENGTH)
    expect(buildChannelCta('instagram', evidence({ signatureServices: [longService] }))).toBe(
      '영업시간 확인하고 편하게 방문해 주세요.',
    )
    expect(
      buildChannelCta('instagram', evidence({ signatureServices: [longService], operatingHours: '' })),
    ).toBeNull()
  })

  it('확인되지 않은 가격·할인·예약·후기 주장을 넣지 않는다', () => {
    const cta = buildChannelCta('instagram', evidence()) ?? ''
    expect(cta).not.toMatch(/\d/)
    expect(cta).not.toMatch(/할인|세일|쿠폰|예약|후기|마감|무료/)
  })
})

describe('attachFirstPostCtas — 채널별 가산, 근거 없으면 필드 생략', () => {
  it('연결된 채널에만 cta 를 붙이고 미연결 채널에는 키를 만들지 않는다', () => {
    const attached = attachFirstPostCtas(baseCopies, evidence({ connectedChannels: [{ provider: 'instagram', handle: '@shop' }] }))
    expect(attached.instagram.cta).toBe('매장에서 속눈썹 연장 만나보세요.')
    expect('cta' in attached.threads).toBe(false)
  })

  it('근거가 없으면 cta 키 자체가 없다(빈 문자열도 넣지 않는다)', () => {
    const attached = attachFirstPostCtas(baseCopies, evidence({ signatureServices: [], operatingHours: '' }))
    expect('cta' in attached.instagram).toBe(false)
    expect('cta' in attached.threads).toBe(false)
  })

  it('입력에 남아 있던 cta 도 근거가 없으면 제거한다', () => {
    const stale: ExactApprovalCopies = {
      instagram: { caption: '본문', cta: '지금 예약하세요' },
      threads: { content: '본문', cta: '지금 예약하세요' },
    }
    const attached = attachFirstPostCtas(stale, evidence({ connectedChannels: [] }))
    expect('cta' in attached.instagram).toBe(false)
    expect('cta' in attached.threads).toBe(false)
  })

  it('CTA 를 붙이면 provider 글자수 제한을 넘는 본문에서는 CTA 만 접는다', () => {
    // 스레드 500자 제한. 본문을 490자로 채우면 CTA 를 붙일 수 없다.
    const longThreads: ExactApprovalCopies = {
      instagram: { caption: '짧은 인스타 본문' },
      threads: { content: '가'.repeat(490) },
    }
    const attached = attachFirstPostCtas(longThreads, evidence())

    expect(attached.threads.content).toBe('가'.repeat(490))
    expect('cta' in attached.threads).toBe(false)
    // 인스타그램은 2,200자라 같은 근거로도 CTA 가 붙는다(채널별 독립 판정).
    expect(attached.instagram.cta).toBe('매장에서 속눈썹 연장 만나보세요.')
  })

  it('인스타그램도 2,200자를 넘기면 CTA 를 접는다', () => {
    const longInstagram: ExactApprovalCopies = {
      instagram: { caption: '가'.repeat(2_190) },
      threads: { content: '짧은 스레드' },
    }
    const attached = attachFirstPostCtas(longInstagram, evidence())
    expect('cta' in attached.instagram).toBe(false)
    expect(attached.threads.cta).toBe('매장에서 속눈썹 연장 만나보세요.')
  })

  it('입력 copies 를 변형하지 않는다', () => {
    const attached = attachFirstPostCtas(baseCopies, evidence())
    expect(attached).not.toBe(baseCopies)
    expect(attached.instagram).not.toBe(baseCopies.instagram)
    expect('cta' in baseCopies.instagram).toBe(false)
    expect(baseCopies.instagram.hashtags).toEqual(['#가게'])
  })
})

describe('M07 연결 — 서버 CTA 가 NO_CTA 차단을 실제로 해제한다', () => {
  function draft(copies: ExactApprovalCopies): DraftDto {
    return {
      copies,
      selectedImageIds: ['img1'],
      mediaPreviews: [{ id: 'img1', url: '/api/workspaces/w/media/img1', width: 800, height: 1000 }],
      rights: { rightsStatus: 'OWNED', consentStatus: 'NOT_APPLICABLE' },
      channels: [{ provider: 'instagram', handle: '@shop', connection: 'CONNECTED', publishPermission: 'GRANTED' }],
      approvalFingerprint: 'fp',
      costQuote: { amountKrw: 0, source: 'SERVER_QUOTE' },
      executionSurface: 'MOBILE_OK',
    }
  }

  it('서버가 CTA 를 내려주면 승인 차단 사유가 비어 있다', () => {
    const attached = attachFirstPostCtas(baseCopies, evidence())
    expect(approvalBlockers(draftApprovalInput(draft(attached), true))).toEqual([])
  })

  it('서버가 CTA 를 생략하면 M07 은 NO_CTA 로 승인을 막는다', () => {
    const omitted = attachFirstPostCtas(baseCopies, evidence({ signatureServices: [], operatingHours: '' }))
    expect(approvalBlockers(draftApprovalInput(draft(omitted), true))).toContain('NO_CTA')
  })
})
