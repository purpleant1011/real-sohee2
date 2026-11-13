/**
 * My Sohee Surfaces Service (HF-58 / ANI-1408)
 * Provides user-readable surfaces for Connections & Permissions,
 * Version Change History, Same-Truth across reader roles, and zero secret leakage.
 */

import type {
  ChannelConnectionInput,
  ChannelSurfaceItem,
  ConnectionsSurfaceView,
  VersionChangeEventInput,
  ChangeHistorySurfaceView,
  MySoheeChannel,
} from './types'

export class MySoheeSurfaceSecurityError extends Error {
  readonly code: string
  constructor(message: string, code = 'MY_SOHEE_SURFACE_SECURITY_ERROR') {
    super(`${code}: ${message}`)
    this.name = 'MySoheeSurfaceSecurityError'
    this.code = code
  }
}

export class MySoheeSurfacesService {
  private connections = new Map<string, ChannelConnectionInput>() // `${ws}:${channel}` -> conn
  private history = new Map<string, VersionChangeEventInput[]>() // ws -> events

  /**
   * 채널 연결 정보 등록
   */
  registerChannelConnection(input: ChannelConnectionInput): void {
    const key = `${input.workspaceId}:${input.channel}`
    this.connections.set(key, { ...input })
  }

  /**
   * 연결 및 권한 서피스 뷰 조회 (민감 토큰 완벽 제거 & 사용자 친화 언어 매핑)
   */
  getConnectionsSurface(
    workspaceId: string,
    _role: 'owner' | 'admin' | 'agent' = 'owner'
  ): ConnectionsSurfaceView {
    const channels: ChannelSurfaceItem[] = []

    for (const [key, conn] of this.connections.entries()) {
      if (!key.startsWith(`${workspaceId}:`)) continue

      const missing = conn.requiredScopes.filter((s) => !conn.grantedScopes.includes(s))
      const hasMissingPermissions = missing.length > 0

      let statusBadge: ChannelSurfaceItem['statusBadge'] = 'DISCONNECTED'
      let displayStatus = '연결되지 않음'
      let needsReauth = false
      let actionCta: string | undefined

      if (conn.tokenExpired) {
        statusBadge = 'REAUTH_REQUIRED'
        displayStatus = '인증 토큰이 만료되어 재인증이 필요합니다'
        needsReauth = true
        actionCta = '재인증하기'
      } else if (!conn.isConnected) {
        statusBadge = 'DISCONNECTED'
        displayStatus = '연결되지 않음'
        actionCta = '연결하기'
      } else if (!conn.isVerified) {
        statusBadge = 'CONNECTED_NOT_VERIFIED'
        displayStatus = '계정은 연결되었으나 추가 권한 또는 확인 필요 상태입니다'
        actionCta = '권한 확인하기'
      } else {
        statusBadge = 'VERIFIED'
        displayStatus = '정상 인증됨'
      }

      let missingPermissionsSummary: string | undefined
      if (hasMissingPermissions) {
        if (missing.includes('instagram_content_publish') || missing.includes('threads_content_publish')) {
          missingPermissionsSummary = '게시물 자동 발행 권한이 필요합니다'
        } else {
          missingPermissionsSummary = '일부 필수 권한이 누락되었습니다'
        }
      }

      // 민감 키(rawAccessToken, rawRefreshToken, encryptedIv)는 절대 전달하지 않음
      channels.push({
        channel: conn.channel,
        accountLabel: conn.accountLabel,
        statusBadge,
        isVerified: conn.isVerified && !conn.tokenExpired,
        displayStatus,
        needsReauth,
        actionCta,
        hasMissingPermissions,
        missingPermissions: missing,
        missingPermissionsSummary,
        lastVerifiedAt: conn.lastVerifiedAt ?? null,
      })
    }

    return {
      workspaceId,
      channels,
      layoutConfig: {
        supportedBreakpoints: ['375px', '768px', '1024px', '1440px'],
        compactOnMobile: true,
      },
    }
  }

  /**
   * 단일 채널 상세 조회 (테넌트 격리)
   */
  getChannelDetail(workspaceId: string, channel: MySoheeChannel): ChannelSurfaceItem {
    const key = `${workspaceId}:${channel}`
    const conn = this.connections.get(key)
    if (!conn) {
      // 다른 워크스페이스에 동일 채널이 있는지 검사
      for (const [otherKey] of this.connections.entries()) {
        if (otherKey.endsWith(`:${channel}`) && !otherKey.startsWith(`${workspaceId}:`)) {
          throw new MySoheeSurfaceSecurityError(
            `Access denied to channel ${channel} across tenants`,
            'CROSS_TENANT_ACCESS_DENIED'
          )
        }
      }
      throw new MySoheeSurfaceSecurityError(`Channel ${channel} not found in workspace`, 'NOT_FOUND')
    }

    const surface = this.getConnectionsSurface(workspaceId)
    const item = surface.channels.find((c) => c.channel === channel)
    if (!item) {
      throw new MySoheeSurfaceSecurityError(`Channel ${channel} item not found`, 'NOT_FOUND')
    }
    return item
  }

  /**
   * 버전 변경 이벤트 기록
   */
  recordVersionChangeEvent(event: VersionChangeEventInput): void {
    const list = this.history.get(event.workspaceId) || []
    list.push({ ...event })
    this.history.set(event.workspaceId, list)
  }

  /**
   * 변경 이력 서피스 뷰 조회
   */
  getChangeHistorySurface(workspaceId: string): ChangeHistorySurfaceView {
    const list = this.history.get(workspaceId) || []

    const activeVersions: Record<string, number> = {}
    for (const item of list) {
      if (item.isActive) {
        activeVersions[item.domain] = item.versionNumber
      }
    }

    return {
      workspaceId,
      activeVersions,
      historyItems: list.map((i) => ({ ...i })),
    }
  }
}
