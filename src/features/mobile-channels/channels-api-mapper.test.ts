import { describe, expect, it } from 'vitest'
import { publishability } from './channel-readiness'
import { mapApiChannel, mapChannelsApi } from './channels-api-mapper'

describe('채널 API → 화면 DTO', () => {
  it('서버에서 확인한 현재 계정명만 전달한다', () => {
    expect(mapApiChannel('instagram', { status: 'VERIFIED', verified: true, supportedPublish: true, username: 'shop' }).username).toBe('shop')
    expect(mapApiChannel('threads', { status: 'NOT_CONNECTED' }).username).toBeNull()
  })

  it('구형 검증 영수증을 갱신하지 못한 상태를 토큰 만료로 잘못 표시하지 않는다', () => {
    const c = mapApiChannel('instagram', { status: 'READY_DEGRADED', supportedPublish: true, degradedReason: 'verification_stale' })
    expect(c.expired).toBe(false)
    expect(c.level).toBe('permission_granted')
    expect(publishability(c)).toMatchObject({ publishable: false, action: 'verify' })
  })
  it('VERIFIED + verified=true + supportedPublish=true 만 게시 가능', () => {
    expect(publishability(mapApiChannel('instagram', { status: 'VERIFIED', verified: true, supportedPublish: true })).publishable).toBe(true)
    expect(publishability(mapApiChannel('instagram', { status: 'VERIFIED', verified: false, supportedPublish: true })).publishable).toBe(false)
  })

  it('supportedPublish 가 없거나 false 면 검증 문자열만으로 게시 가능이 되지 않는다', () => {
    for (const supportedPublish of [undefined, false]) {
      const c = mapApiChannel('instagram', { status: 'VERIFIED', verified: true, supportedPublish })
      expect(c.publishSupported).toBe(false)
      expect(c.level).not.toBe('publish_verified')
      expect(publishability(c).publishable).toBe(false)
    }
  })
  it.each(['CONNECTED_UNVERIFIED', 'SCOPE_INSUFFICIENT', 'READY_DEGRADED', 'NOT_CONNECTED', 'UNKNOWN', 'weird', undefined])('%s 는 게시 불가(fail-closed)', status => {
    expect(publishability(mapApiChannel('threads', { status })).publishable).toBe(false)
  })
  it('READY_DEGRADED 는 다시 연결 안내', () => {
    const p = publishability(mapApiChannel('threads', { status: 'READY_DEGRADED' }))
    expect(p.publishable === false && p.action).toBe('reconnect')
  })
  it('5개 채널을 모두 만들고 점검 시각을 지어내지 않는다', () => {
    const s = mapChannelsApi({ instagram: { status: 'NOT_CONNECTED' }, threads: { status: 'NOT_CONNECTED' } })
    expect(s.channels.map(c => c.id)).toEqual(['instagram', 'threads', 'naver_blog', 'naver_place', 'daangn'])
    expect(s.checkedAt).toBeNull()
    expect(s.channels.every(c => c.lastCheckedAt === null)).toBe(true)
  })

  it('서버가 준 점검 시각만 쓰고, 잘못된 값은 null 로 닫는다', () => {
    const s = mapChannelsApi({
      instagram: { status: 'VERIFIED', verified: true, lastCheckedAt: '2026-10-21T03:04:05.000Z' },
      threads: { status: 'VERIFIED', verified: true, lastCheckedAt: 'not-a-date' },
    })
    expect(s.channels.find(c => c.id === 'instagram')?.lastCheckedAt).toBe('2026-10-21T03:04:05.000Z')
    expect(s.channels.find(c => c.id === 'threads')?.lastCheckedAt).toBeNull()
  })

  it('네이버 블로그·당근은 연결 근거만으로 계정 연결까지만 인정한다', () => {
    const s = mapChannelsApi({
      naverBlog: { status: 'CONNECTED_UNVERIFIED', verified: false, lastCheckedAt: '2026-10-20T01:00:00.000Z' },
      daangn: { status: 'READY_DEGRADED', verified: false },
    })
    const blog = s.channels.find(c => c.id === 'naver_blog')!
    const daangn = s.channels.find(c => c.id === 'daangn')!

    expect(blog.level).toBe('account_connected')
    expect(blog.lastCheckedAt).toBe('2026-10-20T01:00:00.000Z')
    expect(publishability(blog).publishable).toBe(false)
    expect(daangn).toMatchObject({ level: 'account_connected', expired: true })
    expect(publishability(daangn).publishable).toBe(false)
  })

  it('브라우저 커넥터 채널은 VERIFIED 문자열로도 게시 가능이 되지 않는다', () => {
    const s = mapChannelsApi({
      naverBlog: { status: 'VERIFIED', verified: true },
      daangn: { status: 'VERIFIED', verified: true },
    })
    expect(s.channels.find(c => c.id === 'naver_blog')?.level).not.toBe('publish_verified')
    expect(s.channels.find(c => c.id === 'daangn')?.level).not.toBe('publish_verified')
    expect(s.channels.filter(c => publishability(c).publishable)).toHaveLength(0)
  })

  it('네이버 플레이스는 서버 상태와 무관하게 unknown(fail-closed)', () => {
    const s = mapChannelsApi({ naverPlace: { status: 'VERIFIED', verified: true } })
    const place = s.channels.find(c => c.id === 'naver_place')!
    expect(place.level).toBe('unknown')
    expect(place.publishSupported).toBe(false)
    expect(publishability(place).publishable).toBe(false)
  })

  it('확인 근거가 없는 채널은 "잠시 뒤 다시"가 아니라 직접 올리기를 안내한다', () => {
    const place = mapChannelsApi({ naverPlace: { status: 'UNKNOWN', verified: false, supportedPublish: false } })
      .channels.find(c => c.id === 'naver_place')!
    const p = publishability(place)
    expect(p).toMatchObject({ publishable: false, label: '아직 확인할 수 없어요', action: 'manual' })
    expect(p.publishable === false && p.reason).not.toContain('잠시 뒤')
  })

  it('연결은 살아 있지만 대신 올리기 기능이 없는 채널은 직접 게시 안내로 구분한다', () => {
    const s = mapChannelsApi({ naverBlog: { status: 'CONNECTED_UNVERIFIED', verified: false, supportedPublish: false } })
    const blog = s.channels.find(c => c.id === 'naver_blog')!
    expect(blog.publishSupported).toBe(false)
    const verdict = publishability(blog)
    expect(verdict).toMatchObject({ publishable: false, action: 'use_pc', label: '직접 게시' })
    expect(verdict.publishable === false && verdict.reason).toContain('소희는 네이버에 자동으로 올리지 않아요')
  })

  it('응답에 없는 채널도 unknown 으로 닫는다', () => {
    const s = mapChannelsApi({})
    expect(s.channels).toHaveLength(5)
    expect(s.channels.every(c => c.level === 'unknown')).toBe(true)
    expect(s.channels.every(c => publishability(c).publishable === false)).toBe(true)
  })

  it('payload의 extendedScopesAllowed boolean을 snapshot에 전달한다', () => {
    expect(mapChannelsApi({ extendedScopesAllowed: true }).extendedScopesAllowed).toBe(true)
    expect(mapChannelsApi({ extendedScopesAllowed: false }).extendedScopesAllowed).toBe(false)
    expect(mapChannelsApi({}).extendedScopesAllowed).toBe(false)
  })

  it('webhook_status 필드를 DTO로 올바르게 매핑한다', () => {
    const healthy = mapApiChannel('instagram', { status: 'VERIFIED', verified: true, supportedPublish: true, webhook_status: 'healthy' })
    expect(healthy.webhook_status).toBe('healthy')

    const pending = mapApiChannel('threads', { status: 'CONNECTED_UNVERIFIED', webhook_status: 'pending' })
    expect(pending.webhook_status).toBe('pending')

    const camelCase = mapApiChannel('instagram', { status: 'VERIFIED', verified: true, supportedPublish: true, webhookStatus: 'healthy' } as any)
    expect(camelCase.webhook_status).toBe('healthy')

    const empty = mapApiChannel('naver_blog', { status: 'NOT_CONNECTED' })
    expect(empty.webhook_status).toBeNull()
  })

  describe('PC 커넥터 안내는 실패 상태를 덮지 않는다', () => {
    const find = (s: ReturnType<typeof mapChannelsApi>, id: string) => s.channels.find(c => c.id === id)!

    it('연결이 살아 있고 게시 근거만 없을 때만 PC 안내를 붙인다', () => {
      const s = mapChannelsApi({ naverBlog: { status: 'CONNECTED_UNVERIFIED', verified: false } })
      const blog = find(s, 'naver_blog')
      expect(blog.requiresDesktopConnector).toBe(true)
      expect(publishability(blog)).toMatchObject({ publishable: false, action: 'use_pc' })
    })

    it('미연결은 PC 안내가 아니라 연결 안내를 보여준다', () => {
      // 서버 어댑터는 revoked 연결도 NOT_CONNECTED 로 내려준다(원시 status 는 DTO 계약이 아니다).
      const s = mapChannelsApi({ naverBlog: { status: 'NOT_CONNECTED' }, daangn: { status: 'NOT_CONNECTED' } })
      for (const id of ['naver_blog', 'daangn']) {
        const c = find(s, id)
        expect(c.requiresDesktopConnector).toBe(false)
        expect(publishability(c)).toMatchObject({ publishable: false, action: 'connect' })
      }
    })

    it('인증 만료는 PC 안내가 아니라 다시 연결 안내를 보여준다', () => {
      const s = mapChannelsApi({ naverBlog: { status: 'READY_DEGRADED' } })
      const blog = find(s, 'naver_blog')
      expect(blog.requiresDesktopConnector).toBe(false)
      expect(publishability(blog)).toMatchObject({ publishable: false, action: 'reconnect' })
    })

    it('다른 계정에 연결된 경우도 PC 안내로 숨기지 않는다', () => {
      const s = mapChannelsApi({ daangn: { status: 'CONNECTED_UNVERIFIED', verified: false, connectedAccountMatches: false } })
      const daangn = find(s, 'daangn')
      expect(daangn.requiresDesktopConnector).toBe(false)
      expect(publishability(daangn)).toMatchObject({ publishable: false, action: 'reconnect', label: '다른 계정에 연결됨' })
    })

    it('상태를 확인하지 못하면 PC 안내가 아니라 확인 불가를 보여준다', () => {
      const s = mapChannelsApi({})
      for (const id of ['naver_blog', 'daangn']) {
        const c = find(s, id)
        expect(c.requiresDesktopConnector).toBe(false)
        // 대신 올리기 기능이 없는 채널이라 "잠시 뒤 다시"가 아니라 직접 올리기를 안내한다.
        expect(publishability(c)).toMatchObject({ publishable: false, label: '아직 확인할 수 없어요', action: 'manual' })
      }
    })
  })
})
