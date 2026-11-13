import { describe, expect, it } from 'vitest'
import { buildChannelCta } from '@/features/missions/first-post-cta'
import {
  CTA_CHANNELS,
  CTA_CHANNEL_NAME,
  CTA_SUPPORT,
  COPY_SPEC,
  copyLengthVerdict,
  generateChannelCtas,
  previewFingerprint,
  seedPreviewSet,
  type CtaFacts,
} from './preview-set'

const FACTS: CtaFacts = {
  storeName: '바이름',
  signatureServices: ['헤어 커트'],
  operatingHours: null,
  connectedChannels: [
    { provider: 'instagram', handle: '@byreum' },
    { provider: 'threads', handle: '@byreum' },
  ],
}

/** 근거 없는 과장·긴급 문구. CTA 는 이 표현들을 쓰지 않는다. */
const UNGROUNDED_CLAIMS = ['최고', '최저가', '1위', '마감', '한정', '무조건', '100%', '지금 바로'] as const

describe('ANI-1775 채널별 CTA 서버 생성', () => {
  it('채널 연결과 비즈니스 근거를 모두 갖춘 채널에만 CTA 를 만든다', () => {
    const { perChannel, copies } = generateChannelCtas(FACTS)

    for (const channel of ['instagram', 'threads'] as const) {
      const entry = perChannel.find((item) => item.channel === channel)
      expect(entry).toBeTruthy()
      expect(entry?.support).toBe('SUPPORTED')
      // 문구는 확인된 대표 서비스를 그대로 쓴다. 매장 이름은 근거 조건일 뿐 문구 재료가 아니다.
      expect(entry?.cta).toContain('헤어 커트')
      expect(entry?.basis).toEqual(['CONNECTED_CHANNEL', 'BUSINESS_EVIDENCE'])
      expect(copies[channel]?.cta).toBe(entry?.cta)
    }
  })

  it('문구는 운영 경로의 buildChannelCta 결과와 같다(같은 근거 → 같은 문장)', () => {
    const { copies } = generateChannelCtas(FACTS)
    const evidence = {
      businessName: '바이름',
      signatureServices: ['헤어 커트'],
      operatingHours: null,
      connectedChannels: FACTS.connectedChannels,
    }

    expect(copies.instagram?.cta).toBe(buildChannelCta('instagram', evidence))
    expect(copies.threads?.cta).toBe(buildChannelCta('threads', evidence))
    // 운영 경로는 채널마다 다른 문구를 만들지 않는다 — 같은 근거에서 같은 문장이 나온다.
    expect(copies.instagram?.cta).toBe(copies.threads?.cta)
  })

  it('채널 연결 근거가 없으면 매장 이름·서비스가 있어도 CTA 를 만들지 않는다', () => {
    const { perChannel, copies } = generateChannelCtas({ ...FACTS, connectedChannels: [] })

    for (const channel of ['instagram', 'threads'] as const) {
      const entry = perChannel.find((item) => item.channel === channel)
      expect(entry?.cta).toBeNull()
      expect(entry?.reason).toBe('NO_CONNECTED_CHANNEL')
      expect(entry?.basis).toEqual([])
    }
    expect(copies).toEqual({})
  })

  it('다른 채널만 연결됐거나 핸들이 비어 있으면 연결 근거로 보지 않는다', () => {
    const { copies } = generateChannelCtas({
      ...FACTS,
      connectedChannels: [
        { provider: 'instagram', handle: '   ' },
        { provider: 'threads', handle: '@byreum' },
      ],
    })
    expect(copies).not.toHaveProperty('instagram')
    expect(copies.threads?.cta).toBeTruthy()
  })

  it('비즈니스 근거(대표 서비스·영업시간)가 없으면 매장 이름만으로 만들지 않는다', () => {
    const { perChannel, copies } = generateChannelCtas({
      ...FACTS,
      signatureServices: null,
      operatingHours: null,
    })
    for (const channel of ['instagram', 'threads'] as const) {
      const entry = perChannel.find((item) => item.channel === channel)
      expect(entry?.cta).toBeNull()
      expect(entry?.reason).toBe('NO_BUSINESS_EVIDENCE')
      expect(entry?.basis).toEqual([])
    }
    expect(copies).toEqual({})
  })

  it('영업시간만으로도 CTA 를 만들 수 있다', () => {
    const { copies } = generateChannelCtas({
      ...FACTS,
      signatureServices: null,
      operatingHours: '평일 10:00-19:00',
    })
    expect(copies.instagram?.cta).toBe('영업시간 확인하고 편하게 방문해 주세요.')
  })

  it('매장 이름 근거가 없으면 CTA 를 만들지 않는다', () => {
    for (const storeName of [null, '', '   ']) {
      const { perChannel, copies } = generateChannelCtas({ ...FACTS, storeName })
      for (const channel of ['instagram', 'threads'] as const) {
        const entry = perChannel.find((item) => item.channel === channel)
        expect(entry?.cta).toBeNull()
        expect(entry?.reason).toBe('NO_STORE_NAME')
        expect(entry?.basis).toEqual([])
      }
      expect(copies).toEqual({})
    }
  })

  it('문구가 길이 제한을 넘으면 억지로 자르지 않고 CTA 를 접는다', () => {
    const { perChannel, copies } = generateChannelCtas({
      ...FACTS,
      signatureServices: ['가'.repeat(80)],
    })
    for (const channel of ['instagram', 'threads'] as const) {
      const entry = perChannel.find((item) => item.channel === channel)
      expect(entry?.cta).toBeNull()
      expect(entry?.reason).toBe('CTA_TOO_LONG')
    }
    expect(copies).toEqual({})
  })

  it('미지원 채널(네이버 블로그)은 CTA 없이 지원 안 함으로 남긴다', () => {
    const { perChannel, copies, unsupported } = generateChannelCtas(FACTS)
    const naver = perChannel.find((entry) => entry.channel === 'naver_blog')

    expect(CTA_SUPPORT.naver_blog).toBe('UNSUPPORTED')
    expect(naver?.support).toBe('UNSUPPORTED')
    expect(naver?.cta).toBeNull()
    expect(naver?.supportLabel).toBe('지원 안 함')
    expect(naver?.basis).toEqual([])
    expect(copies).not.toHaveProperty('naver_blog')
    expect(unsupported).toEqual(['naver_blog'])
  })

  it('확인된 사실 밖의 과장·긴급 문구를 넣지 않는다', () => {
    const { perChannel } = generateChannelCtas(FACTS)
    for (const entry of perChannel) {
      for (const claim of UNGROUNDED_CLAIMS) {
        expect(entry.cta ?? '').not.toContain(claim)
      }
    }
  })

  it('확인된 서비스의 앞뒤 공백·끝 문장부호는 정리해 문구에 넣는다', () => {
    const { copies } = generateChannelCtas({ ...FACTS, signatureServices: ['  헤어 커트.  '] })
    expect(copies.instagram?.cta).toBe('매장에서 헤어 커트 만나보세요.')
  })

  it('생성한 CTA 는 원고 규격에 바로 들어가고 승인 지문에 포함된다', () => {
    const { copies } = generateChannelCtas(FACTS)
    const instagramCta = copies.instagram?.cta ?? ''
    const threadsCta = copies.threads?.cta ?? ''

    expect(instagramCta.trim()).not.toBe('')
    expect(threadsCta.trim()).not.toBe('')
    expect(copyLengthVerdict('instagram', instagramCta).kind).toBe('OK')
    expect(copyLengthVerdict('threads', threadsCta).kind).toBe('OK')
    expect(instagramCta.length).toBeLessThanOrEqual(COPY_SPEC.instagram.maxLength)
    expect(threadsCta.length).toBeLessThanOrEqual(COPY_SPEC.threads.maxLength)

    const state = seedPreviewSet({
      channels: [
        { channel: 'instagram', copy: { text: '이번 주 예약 안내', cta: instagramCta } },
        { channel: 'threads', copy: { text: '이번 주 예약 안내', cta: threadsCta } },
      ],
    })
    expect(previewFingerprint(state)).toContain(instagramCta)
    expect(previewFingerprint(state)).toContain(threadsCta)
  })

  it('채널 목록은 지원 여부와 함께 고정 순서로 내려간다', () => {
    const { perChannel } = generateChannelCtas(FACTS)
    expect(perChannel.map((entry) => entry.channel)).toEqual([...CTA_CHANNELS])
    expect(perChannel.map((entry) => entry.supportLabel)).toEqual([
      '지원함',
      '지원함',
      '지원 안 함',
    ])
    expect(CTA_CHANNEL_NAME.naver_blog).toBe('네이버 블로그')
  })
})
