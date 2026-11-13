// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildMoreSnapshot, countChannels, isMoreSnapshot, roleOf } from './more-snapshot'
import type { MobileChannelDto } from '@/features/mobile-channels/channel-readiness'

const WS = '11111111-1111-4111-8111-111111111111'
const NOW = '2026-10-24T04:00:00.000Z'

const ok = <T,>(value: T) => ({ ok: true, value })
const failed = () => ({ ok: false, value: null })

function input(overrides: Partial<Parameters<typeof buildMoreSnapshot>[0]> = {}) {
  return {
    workspaceId: WS,
    workspaceName: '바이름 청라',
    membershipRole: 'owner',
    now: NOW,
    profile: ok({ businessName: '바이름' }),
    channels: ok({ publishable: 2, needsCheck: 0, unchecked: 0 }),
    billing: ok({ needsAttention: false }),
    ...overrides,
  }
}

describe('더보기(M25) 스냅샷 조립', () => {
  it('세 원천이 모두 확인되면 정상으로 표시하고 가게 이름·역할을 세션 값에서 가져온다', () => {
    const snap = buildMoreSnapshot(input())
    expect(snap.loadState).toBe('ready')
    expect(snap.workspaces).toEqual([{ id: WS, name: '바이름 청라', role: 'owner' }])
    expect(snap.sections.find(s => s.id === 'store')?.status).toBe('ok')
    expect(snap.sections.find(s => s.id === 'channels')?.status).toBe('ok')
    expect(snap.checkedAt).toBe(NOW)
  })

  it('조회 실패한 섹션은 정상이 아니라 확인하지 못함으로 남긴다', () => {
    const snap = buildMoreSnapshot(input({ profile: failed(), channels: failed(), billing: failed() }))
    expect(snap.loadState).toBe('error')
    expect(snap.checkedAt).toBeNull()
    for (const id of ['store', 'channels', 'billing'] as const) {
      expect(snap.sections.find(s => s.id === id)).toEqual({ id, status: 'unknown', summary: null })
    }
  })

  it('일부만 실패하면 실패한 섹션만 확인하지 못함이고 나머지는 그대로 보여준다', () => {
    const snap = buildMoreSnapshot(input({ billing: failed() }))
    expect(snap.loadState).toBe('ready')
    expect(snap.sections.find(s => s.id === 'store')?.status).toBe('ok')
    expect(snap.sections.find(s => s.id === 'billing')?.status).toBe('unknown')
  })

  it('게시 가능한 채널만 있으면 확인 필요로 올리지 않는다', () => {
    const snap = buildMoreSnapshot(input())
    expect(snap.sections.find(s => s.id === 'channels')).toEqual({ id: 'channels', status: 'ok', summary: '게시 가능한 채널 2개' })
  })

  it('연결만 된 채널·확인이 필요한 크레딧은 확인 필요로 올린다', () => {
    const snap = buildMoreSnapshot(input({ channels: ok({ publishable: 1, needsCheck: 3, unchecked: 0 }), billing: ok({ needsAttention: true }) }))
    expect(snap.sections.find(s => s.id === 'channels')).toEqual({ id: 'channels', status: 'attention', summary: '확인이 필요한 채널 3개' })
    expect(snap.sections.find(s => s.id === 'billing')?.status).toBe('attention')
  })

  it('게시 가능한 채널이 하나도 없으면 정상으로 표시하지 않는다', () => {
    const snap = buildMoreSnapshot(input({ channels: ok({ publishable: 0, needsCheck: 0, unchecked: 0 }) }))
    expect(snap.sections.find(s => s.id === 'channels')).toEqual({ id: 'channels', status: 'attention', summary: '게시할 수 있는 채널이 없어요' })
  })

  // ANI-1714: 판정 불가를 '채널 없음'으로 단정하지 않는다(fail-closed).
  it('상태를 확인하지 못한 채널만 있으면 게시 가능한 채널이 없다고 단정하지 않는다', () => {
    const snap = buildMoreSnapshot(input({ channels: ok({ publishable: 0, needsCheck: 0, unchecked: 2 }) }))
    expect(snap.sections.find(s => s.id === 'channels')).toEqual({
      id: 'channels', status: 'unknown', summary: '채널 2개 상태를 확인하지 못했어요',
    })
  })

  it('확인하지 못한 채널이 섞여 있어도 검증된 채널이 있으면 그 수를 보여준다', () => {
    const snap = buildMoreSnapshot(input({ channels: ok({ publishable: 1, needsCheck: 0, unchecked: 2 }) }))
    expect(snap.sections.find(s => s.id === 'channels')).toEqual({
      id: 'channels', status: 'ok', summary: '게시 가능한 채널 1개',
    })
  })

  it('원천이 없는 자동 업무·알림·보안은 값을 만들지 않고 확인하지 못함으로 둔다', () => {
    const snap = buildMoreSnapshot(input())
    for (const id of ['automation', 'notifications', 'security'] as const) {
      expect(snap.sections.find(s => s.id === id)).toEqual({ id, status: 'unknown', summary: null })
    }
  })

  it('상세와 같은 자동 업무 설정·최근 알림 조회 근거를 보여주되 실제 실행·푸시 수신으로 승격하지 않는다', () => {
    const snap = buildMoreSnapshot(input({
      automation: ok({ mode: 'RUNNING', checkedAt: NOW }),
      notifications: ok({ recentCount: 14, unreadCount: 5, checkedAt: NOW }),
    }))
    expect(snap.sections.find(s => s.id === 'automation')).toEqual({ id: 'automation', status: 'checked', summary: '자동 업무 설정 켜짐 · 실제 실행은 상세에서 확인해 주세요', checkedAt: NOW })
    expect(snap.sections.find(s => s.id === 'notifications')).toEqual({ id: 'notifications', status: 'checked', summary: '최근 조회 14개 중 읽지 않음 5개 · 기기 수신은 별도 확인', checkedAt: NOW })
  })

  it('자동 업무가 꺼진 상태를 정상 가동이나 조회 실패로 바꾸지 않는다', () => {
    const snap = buildMoreSnapshot(input({ automation: ok({ mode: 'OFF', checkedAt: NOW }) }))
    expect(snap.sections.find(s => s.id === 'automation')).toMatchObject({ status: 'inactive', summary: '자동 업무 설정 꺼짐' })
  })

  it('조회된 알림 0개와 알림 조회 실패를 구분한다', () => {
    const snap = buildMoreSnapshot(input({ notifications: ok({ recentCount: 0, unreadCount: 0, checkedAt: NOW }) }))
    expect(snap.sections.find(s => s.id === 'notifications')).toMatchObject({ status: 'checked', summary: '최근 조회된 알림이 없어요 · 기기 수신은 별도 확인' })
    expect(buildMoreSnapshot(input({ notifications: failed() })).sections.find(s => s.id === 'notifications')?.status).toBe('unknown')
  })

  it('개인정보 요청 상태는 읽을 근거가 없으므로 단정하지 않는다', () => {
    const snap = buildMoreSnapshot(input())
    expect(snap.privacy).toEqual({ export: 'unknown', withdraw: 'unknown' })
  })

  it('가게 이름을 확인하지 못하면 지어내지 않고 그렇게 표시한다', () => {
    const snap = buildMoreSnapshot(input({ workspaceName: null, profile: ok({ businessName: null }) }))
    expect(snap.workspaces[0].name).toBe('이름을 확인하지 못했어요')
  })

  it('가게 이름은 세션 값 우선, 없으면 가게 정보의 사업체명을 쓴다', () => {
    const snap = buildMoreSnapshot(input({ workspaceName: null, profile: ok({ businessName: '바이름 본점' }) }))
    expect(snap.workspaces[0].name).toBe('바이름 본점')
  })

  it('모르는 멤버십 역할은 가장 낮은 권한으로 닫는다', () => {
    expect(roleOf('owner')).toBe('owner')
    expect(roleOf('manager')).toBe('manager')
    expect(roleOf('admin')).toBe('reviewer')
    expect(roleOf('')).toBe('reviewer')
  })

  it('다른 가게 스냅샷은 그리지 않는다', () => {
    const snap = buildMoreSnapshot(input())
    expect(isMoreSnapshot(snap, WS)).toBe(true)
    expect(isMoreSnapshot(snap, '22222222-2222-4222-8222-222222222222')).toBe(false)
    expect(isMoreSnapshot({ loadState: 'ready' }, WS)).toBe(false)
  })
})

const channel = (o: Partial<MobileChannelDto> = {}): MobileChannelDto => ({
  id: 'instagram', level: 'publish_verified', publishSupported: true, expired: false, restricted: false,
  needsExternalCheck: false, requiresDesktopConnector: false, connectedAccountMatches: true,
  lastCheckedAt: '2026-10-24T03:00:00.000Z', ...o,
})

describe('채널 집계(countChannels)', () => {
  it('검증된 채널만 게시 가능으로 센다', () => {
    expect(countChannels([channel(), channel({ id: 'threads' })])).toEqual({ publishable: 2, needsCheck: 0, unchecked: 0 })
  })

  it('연결은 됐지만 검증 전인 채널은 확인 필요로 센다', () => {
    expect(countChannels([channel({ level: 'account_connected' }), channel({ level: 'permission_granted' })]))
      .toEqual({ publishable: 0, needsCheck: 2, unchecked: 0 })
  })

  it('상태를 확인하지 못한 채널은 확인 필요가 아니라 미확인으로 센다', () => {
    expect(countChannels([channel({ level: 'unknown' })])).toEqual({ publishable: 0, needsCheck: 0, unchecked: 1 })
  })

  it('연결 안 된 채널은 어느 쪽에도 세지 않는다(확인했고 게시 불가)', () => {
    expect(countChannels([channel({ level: 'not_connected' })])).toEqual({ publishable: 0, needsCheck: 0, unchecked: 0 })
  })

  it('세 갈래가 겹치지 않는다', () => {
    const counts = countChannels([
      channel(), channel({ level: 'account_connected' }), channel({ level: 'unknown' }), channel({ level: 'not_connected' }),
    ])
    expect(counts).toEqual({ publishable: 1, needsCheck: 1, unchecked: 1 })
  })
})
