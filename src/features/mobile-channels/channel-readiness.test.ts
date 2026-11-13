import { describe, expect, it } from 'vitest'
import { channelConnectHref, publishability, webhookStatusText, type MobileChannelDto } from './channel-readiness'

const ch = (o: Partial<MobileChannelDto> = {}): MobileChannelDto => ({ id: 'instagram', level: 'publish_verified', publishSupported: true, expired: false, restricted: false, needsExternalCheck: false, requiresDesktopConnector: false, connectedAccountMatches: true, lastCheckedAt: '2026-10-22T00:00:00Z', ...o })

describe('채널 게시 가능성', () => {
  it('검증 완료만 게시 가능', () => expect(publishability(ch()).publishable).toBe(true))
  it('계정 연결/권한 승인만으로는 불가', () => {
    expect(publishability(ch({ level: 'account_connected' })).publishable).toBe(false)
    expect(publishability(ch({ level: 'permission_granted' })).publishable).toBe(false)
  })
  it('토큰 만료 후 게시 비활성', () => expect(publishability(ch({ expired: true }))).toMatchObject({ publishable: false, action: 'reconnect' }))
  it('다른 계정 복귀는 게시 불가', () => expect(publishability(ch({ connectedAccountMatches: false })).publishable).toBe(false))
  it('PC 커넥터 채널은 모바일에서 PC 안내', () => expect(publishability(ch({ id: 'daangn', publishSupported: true, requiresDesktopConnector: true }))).toMatchObject({ action: 'use_pc' }))
  it('네이버 블로그(publishSupported=false)는 PC 문구 없이 직접 게시 라벨과 정직한 본문을 준다', () => {
    const verdict = publishability(ch({ id: 'naver_blog', publishSupported: false, requiresDesktopConnector: true }))
    expect(verdict).toMatchObject({
      publishable: false,
      label: '직접 게시',
      action: 'use_pc',
      reason: '소희는 네이버에 자동으로 올리지 않아요. 원고와 사진을 준비해 드리면 복사해서 네이버 글쓰기에서 직접 올려 주세요.',
    })
    if (!verdict.publishable) {
      expect(verdict.label).not.toContain('PC')
      expect(verdict.reason).not.toContain('PC')
    }
  })
  it('PC 커넥터가 필요한 타 채널(당근 등)은 기존 PC 안내를 유지한다', () => {
    const verdict = publishability(ch({ id: 'daangn', publishSupported: true, requiresDesktopConnector: true }))
    expect(verdict).toMatchObject({
      publishable: false,
      label: 'PC 작업 필요',
      action: 'use_pc',
      reason: '이 채널은 PC 연결 도구가 필요해요. PC에서 올리는 방법을 안내해 드려요.',
    })
  })
  it('외부 확인 필요 시 불가', () => expect(publishability(ch({ needsExternalCheck: true })).publishable).toBe(false))
  it('검증 중이면 게시 불가·대기 안내', () => expect(publishability(ch({ verifying: true }))).toMatchObject({ publishable: false, label: '검증 중', action: 'wait' }))
  it('서버 소스를 모르면(unknown) fail-closed', () => expect(publishability(ch({ level: 'unknown' }))).toMatchObject({ publishable: false, action: 'wait' }))
  it('계정만 연결되면 게시 권한 없음으로 구분', () => expect(publishability(ch({ level: 'account_connected' }))).toMatchObject({ label: '연결됨 · 게시 권한 없음' }))
  it('미연결은 연결 안내', () => expect(publishability(ch({ level: 'not_connected' }))).toMatchObject({ action: 'connect' }))

  it('게시 기능이 없는 채널은 검증 단계가 와도 게시 가능이 아니다', () => {
    expect(publishability(ch({ id: 'naver_place', level: 'publish_verified', publishSupported: false })).publishable).toBe(false)
  })

  it('게시 기능이 없는 채널의 상태 미확인은 "기다리기"가 아니라 직접 올리기 안내', () => {
    const p = publishability(ch({ id: 'naver_place', level: 'unknown', publishSupported: false }))
    expect(p).toMatchObject({ publishable: false, label: '아직 확인할 수 없어요', action: 'manual' })
  })

  it('게시 기능이 없는 채널이 연결만 되어 있으면 직접 복사 안내로 구분', () => {
    const p = publishability(ch({ id: 'naver_blog', level: 'account_connected', publishSupported: false }))
    expect(p).toMatchObject({ publishable: false, label: '계정 연결됨 · 직접 복사하여 등록', action: 'manual' })
  })

  it('게시 지원 채널의 상태 미확인은 그대로 재확인 안내', () => {
    expect(publishability(ch({ level: 'unknown', publishSupported: true }))).toMatchObject({ action: 'wait' })
  })
})

describe('채널 연결 경로', () => {
  it('OAuth 연결 라우트가 있는 채널은 모바일 채널 화면으로 돌아오는 주소를 준다', () => {
    expect(channelConnectHref('instagram')).toBe('/api/channels/instagram/connect?returnPath=%2Fapp%2Fchannels')
    expect(channelConnectHref('threads')).toBe('/api/channels/threads/connect?returnPath=%2Fapp%2Fchannels')
  })

  it('서버에 연결 라우트가 없는 채널은 가짜 링크를 만들지 않는다', () => {
    for (const id of ['naver_blog', 'naver_place', 'daangn'] as const) {
      expect(channelConnectHref(id)).toBeNull()
    }
  })
})

describe('webhookStatusText', () => {
  it('healthy일 때 새 댓글·메시지 받기 켜져 있어요를 반환한다', () => {
    expect(webhookStatusText('healthy')).toBe('새 댓글·메시지 받기 켜져 있어요')
  })

  it('그 외 상태(pending, stale, error, null, undefined)일 때 확인 중 안내를 반환한다', () => {
    expect(webhookStatusText('pending')).toBe('새 댓글·메시지 받기 확인 중')
    expect(webhookStatusText('stale')).toBe('새 댓글·메시지 받기 확인 중')
    expect(webhookStatusText('error')).toBe('새 댓글·메시지 받기 확인 중')
    expect(webhookStatusText(null)).toBe('새 댓글·메시지 받기 확인 중')
    expect(webhookStatusText(undefined)).toBe('새 댓글·메시지 받기 확인 중')
    expect(webhookStatusText('')).toBe('새 댓글·메시지 받기 확인 중')
  })
})
