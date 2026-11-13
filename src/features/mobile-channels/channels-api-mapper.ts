import type { ChannelsViewSnapshot } from './channels-view'
import type { ChannelId, MobileChannelDto } from './channel-readiness'

/** GET /api/channels 가 내려주는 채널 항목. 모르는 필드는 무시한다. */
interface ApiChannel {
  status?: string
  username?: string | null
  degradedReason?: string
  verified?: boolean
  /** 서버가 게시 기능 자체를 지원하는 채널인지. 없으면 false(fail-closed). */
  supportedPublish?: boolean
  connectedAccountMatches?: boolean | null
  lastCheckedAt?: string | null
  webhook_status?: string | null
  webhookStatus?: string | null
}

export interface ChannelsApiPayload {
  workspaceId?: string
  extendedScopesAllowed?: boolean
  instagram?: ApiChannel | null
  threads?: ApiChannel | null
  naverBlog?: ApiChannel | null
  naverPlace?: ApiChannel | null
  daangn?: ApiChannel | null
}

/** 데스크톱 크롬 커넥터가 있어야 게시할 수 있는 채널(channel-registry: requiresBrowserSession). */
const DESKTOP_CONNECTOR_CHANNELS: ReadonlySet<ChannelId> = new Set(['naver_blog', 'daangn'])

const BASE = { expired: false, restricted: false, needsExternalCheck: false, requiresDesktopConnector: false, connectedAccountMatches: null as boolean | null, lastCheckedAt: null as string | null }

function lastChecked(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  return Number.isNaN(new Date(value).getTime()) ? null : value
}

/**
 * 서버 검증 상태 → 화면 DTO. 모르는 값은 unknown(게시 불가)으로 닫는다.
 * 게시 가능은 `status=VERIFIED` + `verified=true` + `supportedPublish=true` 세 조건이 모두 맞을 때만.
 * 점검 시각은 서버가 준 값만 쓰고, 없으면 null(지어내지 않는다).
 */
export function mapApiChannel(id: ChannelId, c: ApiChannel | null | undefined): MobileChannelDto {
  const publishSupported = c?.supportedPublish === true
  const webhookStatus = typeof c?.webhook_status === 'string'
    ? c.webhook_status
    : typeof c?.webhookStatus === 'string'
      ? c.webhookStatus
      : null

  const base: MobileChannelDto = {
    ...BASE,
    id,
    username: typeof c?.username === 'string' && c.username.trim() ? c.username.trim().replace(/^@+/, '').slice(0, 120) : null,
    level: 'unknown',
    publishSupported,
    connectedAccountMatches: typeof c?.connectedAccountMatches === 'boolean' ? c.connectedAccountMatches : null,
    lastCheckedAt: lastChecked(c?.lastCheckedAt),
    webhook_status: webhookStatus,
  }

  if (!publishSupported) {
    // 서버가 게시 기능 자체를 지원하지 않는 채널(네이버 블로그·당근·플레이스).
    // 연결 근거가 있어도 계정 연결까지만 인정하고, 그 외에는 unknown(fail-closed).
    switch (c?.status) {
      case 'NOT_CONNECTED': return { ...base, level: 'not_connected' }
      case 'CONNECTED_UNVERIFIED':
      case 'SCOPE_INSUFFICIENT': return { ...base, level: 'account_connected' }
      case 'READY_DEGRADED': return c.degradedReason === 'verification_stale'
        ? { ...base, level: publishSupported ? 'permission_granted' : 'account_connected', expired: false }
        : { ...base, level: 'account_connected', expired: true }
      default: return base
    }
  }

  switch (c?.status) {
    case 'VERIFIED': return { ...base, level: c.verified === true ? 'publish_verified' : 'unknown' }
    case 'NOT_CONNECTED': return { ...base, level: 'not_connected' }
    case 'CONNECTED_UNVERIFIED':
    case 'SCOPE_INSUFFICIENT': return { ...base, level: 'account_connected' }
    case 'READY_DEGRADED': return c.degradedReason === 'verification_stale'
        ? { ...base, level: publishSupported ? 'permission_granted' : 'account_connected', expired: false }
        : { ...base, level: 'account_connected', expired: true }
    default: return base
  }
}

/**
 * PC 커넥터 안내를 붙일지 판단한다.
 * `publishability()` 는 `requiresDesktopConnector` 를 가장 먼저 보므로, 이 플래그를 실패 상태
 * (미연결·만료·다른 계정·상태 미확인)에도 붙이면 "다시 연결"·"상태 확인 못 함" 안내가
 * 전부 "PC 작업 필요" 로 뭉개진다. 연결은 살아 있고 게시 근거만 없는 경우에만 붙인다.
 */
function needsDesktopConnector(channel: MobileChannelDto): boolean {
  if (!DESKTOP_CONNECTOR_CHANNELS.has(channel.id)) return false
  if (channel.expired || channel.restricted) return false
  if (channel.connectedAccountMatches === false) return false
  return channel.level === 'account_connected' || channel.level === 'permission_granted'
}

export function mapChannelsApi(payload: ChannelsApiPayload): ChannelsViewSnapshot {
  const channels: MobileChannelDto[] = [
    mapApiChannel('instagram', payload.instagram),
    mapApiChannel('threads', payload.threads),
    mapApiChannel('naver_blog', payload.naverBlog),
    mapApiChannel('naver_place', payload.naverPlace),
    mapApiChannel('daangn', payload.daangn),
  ].map(channel => ({ ...channel, requiresDesktopConnector: needsDesktopConnector(channel) }))

  return {
    loadState: 'ready',
    checkedAt: null,
    channels,
    extendedScopesAllowed: payload.extendedScopesAllowed === true,
  }
}
