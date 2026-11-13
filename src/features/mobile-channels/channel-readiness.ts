export type ChannelId = 'instagram' | 'threads' | 'naver_blog' | 'naver_place' | 'daangn'
export type ConnectionLevel = 'not_connected' | 'account_connected' | 'permission_granted' | 'publish_verified' | 'unknown'

export interface MobileChannelDto {
  id: ChannelId
  /** 서버가 확인한 현재 계정명만 표시한다. */
  username?: string | null
  level: ConnectionLevel
  /**
   * 서버가 이 채널의 게시(외부 write) 기능 자체를 지원하는지.
   * "지금 게시 가능한지"와 다른 축이다 — 연결·검증은 level 이 답한다.
   */
  publishSupported: boolean
  expired: boolean
  restricted: boolean
  needsExternalCheck: boolean
  /** 서버가 게시 가능 여부를 점검하는 중 */
  verifying?: boolean
  requiresDesktopConnector: boolean
  connectedAccountMatches: boolean | null // OAuth 복귀 후 의도한 계정과 일치?
  lastCheckedAt: string | null
  webhook_status?: string | null
}

/** 새 댓글·메시지 수신 연결 상태를 사장님 언어로 변환한다 (기술 용어·크레딧 제외). */
export function webhookStatusText(status?: string | null): string {
  return status === 'healthy'
    ? '새 댓글·메시지 받기 켜져 있어요'
    : '새 댓글·메시지 받기 확인 중'
}

export type Publishability =
  | { publishable: true }
  | { publishable: false; label: string; action: 'connect' | 'reconnect' | 'check_external' | 'use_pc' | 'manual' | 'verify' | 'wait'; reason: string }

/** 모바일 채널 화면이 사는 경로. OAuth 복귀도 여기로 돌아온다. */
export const MOBILE_CHANNELS_PATH = '/app/channels'

/** 네이버 블로그 등 직접 게시 채널에서 원고를 준비하러 가는 작업/콘텐츠 목록 경로 */
export const MOBILE_WORK_CONTENT_PATH = '/app/content'

/** 서버에 OAuth 연결 라우트가 있는 채널만. 나머지는 시작 경로 자체가 없어 링크를 만들지 않는다. */
const OAUTH_CONNECT_CHANNELS: ReadonlySet<ChannelId> = new Set(['instagram', 'threads'])

/**
 * 다시 연결·계정 연결을 실제로 시작할 수 있는 주소. 없으면 null.
 * 화면은 null일 때 링크를 만들지 않는다 — 눌러도 아무 일도 없는 가짜 링크를 두지 않는다.
 */
export function channelConnectHref(id: ChannelId): string | null {
  if (!OAUTH_CONNECT_CHANNELS.has(id)) return null
  return `/api/channels/${id}/connect?returnPath=${encodeURIComponent(MOBILE_CHANNELS_PATH)}`
}

export const LEVEL_LABEL: Record<ConnectionLevel, string> = {
  not_connected: '아직 연결 안 됨', account_connected: '계정 연결됨', permission_granted: '권한 승인됨', publish_verified: '게시 가능 검증됨', unknown: '상태를 확인하지 못함',
}

/** 초록 아이콘이 아니라 서버가 검증한 최고 단계에서만 게시 가능. 모호하면 비활성. */
export function publishability(c: MobileChannelDto): Publishability {
  if (c.requiresDesktopConnector) {
    const isNaverDirect = c.id === 'naver_blog' && !c.publishSupported
    return {
      publishable: false,
      label: isNaverDirect ? '직접 게시' : 'PC 작업 필요',
      action: 'use_pc',
      reason: isNaverDirect
        ? '소희는 네이버에 자동으로 올리지 않아요. 원고와 사진을 준비해 드리면 복사해서 네이버 글쓰기에서 직접 올려 주세요.'
        : c.publishSupported
          ? '이 채널은 PC 연결 도구가 필요해요. PC에서 올리는 방법을 안내해 드려요.'
          : '네이버 정책에 따라 자동 게시를 지원하지 않아요. 소희에서 작성한 원고와 이미지를 복사하여 네이버 블로그에 직접 올려 주세요.',
    }
  }
  if (c.level === 'unknown') {
    // 근거가 없는 채널과 "잠시 뒤 다시 확인하면 되는" 상태는 다르다. 지원 자체가 없으면 기다리라고 하지 않는다.
    if (!c.publishSupported) return { publishable: false, label: '아직 확인할 수 없어요', action: 'manual', reason: '이 채널은 소희가 연결 상태를 확인할 수 없어요. 직접 올려 주세요.' }
    return { publishable: false, label: LEVEL_LABEL.unknown, action: 'wait', reason: '연결 상태를 확인하지 못해서 게시하지 않아요. 잠시 뒤 다시 확인해 주세요.' }
  }
  if (c.level === 'not_connected') return { publishable: false, label: LEVEL_LABEL.not_connected, action: 'connect', reason: '계정을 연결하면 게시 가능 여부를 확인할 수 있어요.' }
  if (c.connectedAccountMatches === false) return { publishable: false, label: '다른 계정에 연결됨', action: 'reconnect', reason: '의도한 계정이 아니에요. 다시 연결해 주세요.' }
  if (c.expired || c.restricted) return { publishable: false, label: c.expired ? '연결 만료' : '이용 제한', action: 'reconnect', reason: '다시 연결하기 전에는 게시하지 않아요.' }
  if (c.verifying) return { publishable: false, label: '검증 중', action: 'wait', reason: '게시 가능한지 확인하고 있어요. 끝나기 전에는 게시하지 않아요.' }
  if (c.needsExternalCheck) return { publishable: false, label: '외부 확인 필요', action: 'check_external', reason: '채널 쪽 확인이 끝나면 알려 드려요.' }
  if (c.level === 'account_connected') {
    if (!c.publishSupported) return { publishable: false, label: '계정 연결됨 · 직접 복사하여 등록', action: 'manual', reason: '네이버 정책을 준수하여 자동 게시 기능을 제공하지 않아요. 소희에서 글과 사진을 복사해 직접 블로그에 등록하는 수동 작성만 지원해요.' }
    return { publishable: false, label: '연결됨 · 게시 권한 없음', action: 'verify', reason: '계정은 연결됐지만 게시 권한 승인이 확인되지 않았어요.' }
  }
  if (c.level === 'permission_granted') return { publishable: false, label: LEVEL_LABEL.permission_granted, action: 'verify', reason: '게시 가능 여부 검증이 필요해요.' }
  // 게시 기능이 없는 채널은 검증 단계가 와도 게시 가능으로 올리지 않는다.
  if (!c.publishSupported) return { publishable: false, label: '아직 확인할 수 없어요', action: 'manual', reason: '이 채널은 소희가 연결 상태를 확인할 수 없어요. 직접 올려 주세요.' }
  return { publishable: true }
}
