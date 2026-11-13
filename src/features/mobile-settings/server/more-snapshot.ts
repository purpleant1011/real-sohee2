import { publishability, type MobileChannelDto } from '@/features/mobile-channels/channel-readiness'
import type { MoreSectionDto, MoreViewSnapshot, WorkspaceOption } from '../more-model'

/** 조회 결과 한 갈래. ok=false 는 '값이 없음'이 아니라 '확인 실패'다. */
export interface SourceResult<T> { ok: boolean; value: T | null }

export interface MoreSnapshotInput {
  workspaceId: string
  /** 서버 인증이 확정한 가게 이름. 없으면 null(지어내지 않는다). */
  workspaceName: string | null
  /** 세션의 멤버십 역할. 모르는 값은 가장 낮은 권한으로 닫는다. */
  membershipRole: string
  now: string
  profile: SourceResult<{ businessName: string | null }>
  channels: SourceResult<ChannelCounts>
  billing: SourceResult<{ needsAttention: boolean }>
  automation?: SourceResult<{ mode: 'OFF' | 'PAUSED' | 'RUNNING' | 'ARMING' | 'BLOCKED' | 'DEGRADED'; checkedAt: string }>
  notifications?: SourceResult<{ recentCount: number; unreadCount: number; checkedAt: string }>
}

/**
 * 채널 응답에서 셀 수 있는 세 가지를 센다(집계는 호출 측이 `publishability()` 로 한다).
 * - publishable: 지금 게시할 수 있다고 서버가 검증한 채널
 * - needsCheck: 연결 근거는 있으나 아직 게시할 수 없는 채널
 * - unchecked: 상태를 확인하지 못한 채널(level === 'unknown')
 * 확인하지 못한 채널은 publishable·needsCheck 어느 쪽에도 넣지 않는다(단정 금지).
 * 대신 unchecked 로 남겨 "게시 가능한 채널이 없음"과 구분한다.
 */
export interface ChannelCounts { publishable: number; needsCheck: number; unchecked: number }

/**
 * 채널 DTO 목록을 세 갈래로 센다. 게시 가능 여부는 `publishability()` 계약 하나로만 판정한다.
 * `not_connected` 는 '확인했고 게시할 수 없음'이라 확인 필요에도 미확인에도 넣지 않는다.
 */
export function countChannels(channels: readonly MobileChannelDto[]): ChannelCounts {
  return channels.reduce<ChannelCounts>((acc, channel) => {
    if (publishability(channel).publishable) acc.publishable += 1
    else if (channel.level === 'unknown') acc.unchecked += 1
    else if (channel.level !== 'not_connected') acc.needsCheck += 1
    return acc
  }, { publishable: 0, needsCheck: 0, unchecked: 0 })
}

export function roleOf(membershipRole: string): WorkspaceOption['role'] {
  if (membershipRole === 'owner' || membershipRole === 'manager' || membershipRole === 'reviewer') return membershipRole
  return 'reviewer'
}

/** 가게 전환 목록을 내려주는 서버 API 가 아직 없다. 지금 보는 가게 하나만 정확히 표시한다. */
function workspacesOf(input: MoreSnapshotInput): WorkspaceOption[] {
  const name = input.workspaceName ?? input.profile.value?.businessName ?? '이름을 확인하지 못했어요'
  return [{ id: input.workspaceId, name, role: roleOf(input.membershipRole) }]
}

function section<T>(
  id: MoreSectionDto['id'],
  source: SourceResult<T>,
  describe: (value: T) => { status: MoreSectionDto['status']; summary: string | null },
): MoreSectionDto {
  // 조회 실패를 '정상'으로 올리지 않는다. 근거가 없으면 확인하지 못함.
  if (!source.ok || source.value === null) return { id, status: 'unknown', summary: null }
  return { id, ...describe(source.value) }
}

/**
 * 더보기(M25) 스냅샷 조립 — 가게 정보·채널·크레딧 및 기존 상세와 같은 자동 업무·알림 원천을 사용한다.
 * 자동 업무 설정 조회는 실제 worker 실행 증거가 아니고, 알림 조회는 기기 수신 확인이 아니다.
 * 개인정보 요청 상태는 `data_deletion_requests` 를 authenticated 롤에서 select 할 수 없게 RLS 가 막고 있어
 * (마이그레이션 20260814005734) 상태를 단정하지 않고 둘 다 unknown 으로 둔다. 요청도 이 화면에서 만들지 않는다.
 */
export function buildMoreSnapshot(input: MoreSnapshotInput): MoreViewSnapshot {
  const anyOk = input.profile.ok || input.channels.ok || input.billing.ok || input.automation?.ok || input.notifications?.ok
  const unknownSource = { ok: false, value: null }
  const sections: MoreSectionDto[] = [
    section('store', input.profile, v => ({ status: 'ok', summary: v.businessName })),
    // 게시 가능한 채널과 '연결만 된' 채널을 섞지 않는다. 검증된 채널을 확인 필요로 올리지 않는다.
    section('channels', input.channels, v => {
      if (v.needsCheck > 0) return { status: 'attention', summary: `확인이 필요한 채널 ${v.needsCheck}개` }
      if (v.publishable > 0) return { status: 'ok', summary: `게시 가능한 채널 ${v.publishable}개` }
      // 확인하지 못한 채널이 남아 있으면 그건 '채널 없음'이 아니라 '판정 불가'다(ANI-1714).
      if (v.unchecked > 0) return { status: 'unknown', summary: `채널 ${v.unchecked}개 상태를 확인하지 못했어요` }
      return { status: 'attention', summary: '게시할 수 있는 채널이 없어요' }
    }),
    section('automation', input.automation ?? unknownSource, v => ({
      status: v.mode === 'OFF' || v.mode === 'PAUSED' ? 'inactive' : v.mode === 'BLOCKED' || v.mode === 'DEGRADED' ? 'attention' : 'checked',
      summary: {
        OFF: '자동 업무 설정 꺼짐', PAUSED: '자동 업무 일시 중지',
        RUNNING: '자동 업무 설정 켜짐 · 실제 실행은 상세에서 확인해 주세요',
        ARMING: '자동 업무 시작 준비 중 · 상세에서 확인해 주세요',
        BLOCKED: '안전 제어에 따라 자동 업무가 멈춰 있어요', DEGRADED: '자동 업무 상태를 상세에서 확인해 주세요',
      }[v.mode],
      checkedAt: v.checkedAt,
    })),
    section('notifications', input.notifications ?? unknownSource, v => ({
      status: 'checked',
      summary: v.recentCount === 0 ? '최근 조회된 알림이 없어요 · 기기 수신은 별도 확인' : `최근 조회 ${v.recentCount}개 중 읽지 않음 ${v.unreadCount}개 · 기기 수신은 별도 확인`,
      checkedAt: v.checkedAt,
    })),
    section('billing', input.billing, v => ({
      status: v.needsAttention ? 'attention' : 'ok',
      summary: v.needsAttention ? '크레딧 확인이 필요해요' : '크레딧 잔액 확인됨',
    })),
    { id: 'security', status: 'unknown', summary: null },
  ]

  return {
    loadState: anyOk ? 'ready' : 'error',
    workspaceId: input.workspaceId,
    workspaces: workspacesOf(input),
    sections,
    privacy: { export: 'unknown', withdraw: 'unknown' },
    lastReauthAt: null,
    now: input.now,
    checkedAt: anyOk ? input.now : null,
  }
}

/** 다른 가게 스냅샷·형식 불일치는 그리지 않고 error 로 닫는다. */
export function isMoreSnapshot(value: unknown, workspaceId: string): value is MoreViewSnapshot {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.loadState === 'string'
    && v.workspaceId === workspaceId
    && Array.isArray(v.workspaces)
    && Array.isArray(v.sections)
    && !!v.privacy && typeof v.privacy === 'object'
    && typeof v.now === 'string'
}
