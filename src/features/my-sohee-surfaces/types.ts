/**
 * My Sohee Surfaces Types (HF-58 / ANI-1408)
 */

export type MySoheeChannel = 'instagram' | 'threads'

export interface ChannelConnectionInput {
  workspaceId: string
  channel: MySoheeChannel
  accountLabel: string
  isConnected: boolean
  isVerified: boolean
  tokenExpired?: boolean
  grantedScopes: string[]
  requiredScopes: string[]
  lastVerifiedAt?: string | null
  rawAccessToken?: string
  rawRefreshToken?: string
  encryptedIv?: string
}

export interface ChannelSurfaceItem {
  channel: MySoheeChannel
  accountLabel: string
  statusBadge: 'VERIFIED' | 'CONNECTED_NOT_VERIFIED' | 'REAUTH_REQUIRED' | 'DISCONNECTED'
  isVerified: boolean
  displayStatus: string
  needsReauth: boolean
  actionCta?: string
  hasMissingPermissions: boolean
  missingPermissions: string[]
  missingPermissionsSummary?: string
  lastVerifiedAt: string | null
}

export interface ConnectionsSurfaceView {
  workspaceId: string
  channels: ChannelSurfaceItem[]
  layoutConfig: {
    supportedBreakpoints: string[]
    compactOnMobile: boolean
  }
}

export interface VersionChangeEventInput {
  workspaceId: string
  domain: 'business_knowledge' | 'text_harness' | 'image_harness' | 'operating_policy'
  versionNumber: number
  summary: string
  actorName: string
  actorType: 'user' | 'system' | 'provider'
  isActive: boolean
  changedAt: string
}

export interface ChangeHistorySurfaceView {
  workspaceId: string
  activeVersions: Record<string, number>
  historyItems: VersionChangeEventInput[]
}
