import { describe, expect, it } from 'vitest'
import { getChannelDisplay, getConnectNotice } from './channel-display'

describe('채널 상태 문구 (서버 검증 결과 우선)', () => {
  it('검증되거나 연결된 계정만 핸들과 연결됨 문구를 표시한다', () => {
    expect(getChannelDisplay({ status: 'VERIFIED', verified: true, username: '@owner' }, { status: 'connected', account_label: '@owner' })).toEqual({ label: '연결됨 @owner', action: null, kind: 'connected' })
    expect(getChannelDisplay({ status: 'CONNECTED_UNVERIFIED', verified: false }, { status: 'authorized', account_label: 'shop' })).toEqual({ label: '연결됨 @shop', action: null, kind: 'connected' })
  })

  it('자격 정보가 없다면 콜백 성공을 주장하지 않고 연결 필요로 남긴다', () => {
    expect(getChannelDisplay({ status: 'NOT_CONNECTED', verified: false }, undefined)).toEqual({ label: '연결 필요', action: '연결하기', kind: 'disconnected' })
    expect(getChannelDisplay({ status: 'NOT_CONNECTED', verified: false }, { status: 'not_connected', account_label: '@old' })).toEqual({ label: '연결 필요', action: '연결하기', kind: 'disconnected' })
  })

  it('만료 및 재인증 상태는 저장된 계정이 있어도 다시 연결로 표시한다', () => {
    expect(getChannelDisplay({ status: 'READY_DEGRADED', verified: false }, { status: 'connected', account_label: '@old' })).toEqual({ label: '다시 연결 필요', action: '다시 연결', kind: 'reauth' })
    expect(getChannelDisplay({ status: 'SCOPE_INSUFFICIENT', verified: false }, { status: 'reauth_required' })).toEqual({ label: '다시 연결 필요', action: '다시 연결', kind: 'reauth' })
  })

  it('계정 ID가 유실된 연결(CONNECTION_IDENTITY_MISSING)은 재연결 필요 배지와 함께 다시 연결로 표시한다', () => {
    expect(getChannelDisplay({ status: 'CONNECTED_UNVERIFIED', verified: false }, { status: 'connected', account_label: '@shop', external_account_id: null })).toEqual({
      label: '다시 연결 필요',
      action: '다시 연결',
      kind: 'reauth',
      badgeLabel: '재연결 필요',
    })
    expect(getChannelDisplay({ status: 'CONNECTION_IDENTITY_MISSING', verified: false }, { status: 'connected', account_label: '@shop' })).toEqual({
      label: '다시 연결 필요',
      action: '다시 연결',
      kind: 'reauth',
      badgeLabel: '재연결 필요',
    })
  })

  it('조회 불가/차단은 연결 필요로 오인하지 않는다', () => {
    expect(getChannelDisplay({ status: 'UNKNOWN', verified: false }, { status: 'connected', account_label: '@owner' })).toEqual({ label: '상태를 확인할 수 없어요', action: null, kind: 'unknown' })
    expect(getChannelDisplay(null, undefined)).toEqual({ label: '상태를 확인할 수 없어요', action: null, kind: 'unknown' })
  })
})

describe('연결 결과 안내', () => {
  it('Meta 인증 실패는 다른 계정 로그인과 재시도를 안내하고 기존 연결 삭제를 주장하지 않는다', () => {
    const notice = getConnectNotice('unavailable', 'META_OAUTH_TOKEN_EXCHANGE', { channel: 'instagram' })
    expect(notice?.message).toContain('비즈니스 또는 크리에이터')
    expect(notice?.action?.href).toBe('/api/channels/instagram/connect?returnPath=%2Fapp%2Fchannels')
    const cancelled = getConnectNotice('cancelled', null, { channel: 'threads' })
    expect(cancelled?.message).toContain('기존 연결은 변경하지 않았어요')
    expect(cancelled?.action?.href).toContain('/api/channels/threads/connect')
  })

  it('권한 부족은 매장 관리자에게 요청하도록 안내한다', () => {
    expect(getConnectNotice('forbidden', null)?.message).toContain('매장 대표 또는 관리자')
  })

  it('Meta 연결 실패와 안전 코드별로 원인과 해결 방법을 제공한다', () => {
    expect(getConnectNotice('unavailable', 'META_OAUTH_TOKEN_EXCHANGE')?.message).toContain('소희 운영팀에 문의')
    expect(getConnectNotice('unavailable', 'META_OAUTH_ACCOUNT_LOOKUP')?.message).toContain('계정 정보를 확인')
    expect(getConnectNotice('invalid', null)?.message).toContain('다시 연결')
    expect(getConnectNotice('cancelled', null)?.message).toContain('취소')
    expect(getConnectNotice('unavailable', 'UNSAFE_SECRET')?.message).not.toContain('UNSAFE_SECRET')
  })

  it('SCOPE_MISSING 오류 시 게시 권한 안내 및 다시 연결 버튼을 제공한다', () => {
    const notice = getConnectNotice('unavailable', 'SCOPE_MISSING', {
      channel: 'threads',
      returnPath: '/start?step=channels',
    })
    expect(notice?.title).toBe('게시 권한을 허용해 주세요')
    expect(notice?.message).toBe(
      '소희가 사장님 대신 글을 올리려면 "게시물 작성" 권한이 필요해요. 다시 연결하면서 게시 권한을 허용해 주세요.',
    )
    expect(notice?.kind).toBe('error')
    expect(notice?.action).toEqual({
      label: '다시 연결하기',
      href: '/api/channels/threads/connect?returnPath=%2Fstart%3Fstep%3Dchannels',
    })

    // error 쿼리로 직접 온 경우도 동일하게 처리
    const noticeFromError = getConnectNotice('SCOPE_MISSING', null, {
      channel: 'instagram',
      returnPath: '/app/channels',
    })
    expect(noticeFromError?.title).toBe('게시 권한을 허용해 주세요')
    expect(noticeFromError?.action?.label).toBe('다시 연결하기')
    expect(noticeFromError?.action?.href).toBe('/api/channels/instagram/connect?returnPath=%2Fapp%2Fchannels')
  })

  it('SCOPE_VERIFICATION_UNAVAILABLE 오류 시 권한 확인 불가 안내 및 다시 연결 버튼을 제공한다', () => {
    const notice = getConnectNotice('unavailable', 'SCOPE_VERIFICATION_UNAVAILABLE', {
      channel: 'threads',
      returnPath: '/app/channels',
    })
    expect(notice?.title).toBe('권한을 확인하지 못했어요')
    expect(notice?.message).toBe('잠시 후 다시 시도해 주세요.')
    expect(notice?.kind).toBe('error')
    expect(notice?.action).toEqual({
      label: '다시 연결하기',
      href: '/api/channels/threads/connect?returnPath=%2Fapp%2Fchannels',
    })
  })

  it('ACCOUNT_ALREADY_CONNECTED 오류 시 중복 바인딩 안내 및 다른 계정 연결 버튼을 제공한다', () => {
    const notice = getConnectNotice('unavailable', 'ACCOUNT_ALREADY_CONNECTED', {
      channel: 'threads',
      returnPath: '/app/channels',
    })
    expect(notice?.title).toBe('이미 다른 소희 계정에 연결된 계정이에요')
    expect(notice?.message).toBe(
      '이 인스타그램/스레드 계정은 다른 소희 계정에서 사용 중이에요. 원래 사용하던 소희 계정으로 로그인하거나, 다른 계정으로 연결해 주세요. 도움이 필요하면 소희 운영팀에 문의해 주세요.',
    )
    expect(notice?.kind).toBe('error')
    expect(notice?.action).toEqual({
      label: '다른 계정으로 연결하기',
      href: '/api/channels/threads/connect?returnPath=%2Fapp%2Fchannels',
    })

    // error 쿼리로 직접 온 경우도 동일하게 처리
    const noticeFromError = getConnectNotice('ACCOUNT_ALREADY_CONNECTED', null, {
      channel: 'instagram',
      returnPath: '/start?step=channels',
    })
    expect(noticeFromError?.title).toBe('이미 다른 소희 계정에 연결된 계정이에요')
    expect(noticeFromError?.action?.label).toBe('다른 계정으로 연결하기')
    expect(noticeFromError?.action?.href).toBe('/api/channels/instagram/connect?returnPath=%2Fstart%3Fstep%3Dchannels')
  })

  it('성공 콜백은 서버 상태를 확인하도록만 안내하고 계정명을 신뢰하지 않는다', () => {
    expect(getConnectNotice('authorized', null)?.message).toContain('상태를 확인')
    expect(getConnectNotice(null, null)).toBeNull()
  })
})
