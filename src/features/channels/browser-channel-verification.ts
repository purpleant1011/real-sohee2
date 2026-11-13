/**
 * [ANI-1776] Browser-connector channel truth for GET /api/channels.
 *
 * 네이버 블로그·당근은 데스크톱 크롬 커넥터로 발행하므로, 서버에 남는 유일한 근거는
 * `browser_channel_connections` (활성 기기에서 register_browser_channel_connection 으로 기록) 이다.
 *
 * 연결 등록은 "브라우저 대상이 검증됨"까지만 증명한다. 게시 가능 여부는 증명하지 않으며
 * 두 채널의 발행은 보관 승인 정책에서 여전히 차단되어 있다(vault approval-policy).
 * 따라서 이 모듈은 절대 VERIFIED 를 반환하지 않는다 — 최고 단계는 CONNECTED_UNVERIFIED.
 *
 * 네이버 플레이스는 서버에 영속 근거가 없다(등록 경로·검증 경로 모두 없음) → 라우트에서 UNKNOWN 고정.
 */
import type { ChannelVerificationStatus } from './dual-channel-verification'

export type BrowserChannelId = 'naver_blog' | 'daangn_business'

export interface BrowserChannelRow {
  status?: string | null
  external_account_label?: string | null
  verified_at?: string | null
  last_seen_at?: string | null
}

export interface BrowserChannelState {
  status: ChannelVerificationStatus
  /** 연결 근거만으로 게시 가능을 주장하지 않는다. 항상 false. */
  verified: boolean
  blockerMessage?: string
  accountLabel: string | null
  connectedAccountMatches: boolean | null
  /** browser_channel_connections.verified_at — 브라우저 대상이 마지막으로 검증된 시각. 없으면 null. */
  lastCheckedAt: string | null
}

export interface BrowserChannelVerificationOptions {
  /** 테스트 주입용. 프로덕션에서는 항상 service-role 경계를 사용한다. */
  adminClient?: any
}

const CHANNEL_LABEL: Record<BrowserChannelId, string> = {
  naver_blog: '네이버 블로그',
  daangn_business: '당근',
}

function timestamp(value: string | null | undefined): string | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : value
}

/**
 * 영속 연결 행 → 채널 상태. 모르는 status 는 UNKNOWN 으로 닫는다(fail-closed).
 */
export function mapBrowserChannelRow(
  channel: BrowserChannelId,
  row: BrowserChannelRow | null | undefined
): BrowserChannelState {
  const label = CHANNEL_LABEL[channel]
  const base = {
    verified: false,
    accountLabel: row?.external_account_label ?? null,
    connectedAccountMatches: null as boolean | null,
    lastCheckedAt: timestamp(row?.verified_at),
  }

  if (!row) {
    return {
      ...base,
      status: 'NOT_CONNECTED',
      blockerMessage: `${label} 계정이 연결되지 않았습니다.`,
      lastCheckedAt: null,
    }
  }

  switch (row.status) {
    case 'connected':
      return {
        ...base,
        status: 'CONNECTED_UNVERIFIED',
        blockerMessage: `${label} 계정 연결은 확인되었으나 게시 가능 여부는 아직 확인되지 않았습니다.`,
      }
    case 'reauth_required':
      return {
        ...base,
        status: 'READY_DEGRADED',
        blockerMessage: `${label} 연결 인증이 만료되었습니다. 다시 연결해 주세요.`,
      }
    case 'target_mismatch':
      return {
        ...base,
        status: 'CONNECTED_UNVERIFIED',
        connectedAccountMatches: false,
        blockerMessage: `${label} 연결 대상이 의도한 계정과 다릅니다. 다시 연결해 주세요.`,
      }
    case 'revoked':
      return {
        ...base,
        status: 'NOT_CONNECTED',
        blockerMessage: `${label} 연결이 해제되었습니다.`,
        lastCheckedAt: null,
      }
    default:
      // 'unavailable' 및 스키마에 없는 값 — 상태를 단정하지 않는다.
      return {
        ...base,
        status: 'UNKNOWN',
        blockerMessage: `${label} 연결 상태를 확인하지 못했습니다.`,
        lastCheckedAt: null,
      }
  }
}

/**
 * 워크스페이스의 최신 브라우저 커넥터 연결을 읽어 채널 상태를 만든다.
 * `environment = 'production'` 행만 실제 연결로 인정한다(test 환경 연결은 fail-closed).
 */
export async function getPersistedBrowserChannelState(
  workspaceId: string,
  channel: BrowserChannelId,
  options?: BrowserChannelVerificationOptions
): Promise<BrowserChannelState> {
  const label = CHANNEL_LABEL[channel]
  let client: any = options?.adminClient ?? null

  if (!client) {
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    client = createAdminSupabaseClient()
  }

  try {
    const { data, error } = await client
      .from('browser_channel_connections')
      .select('status, external_account_label, verified_at, last_seen_at')
      .eq('workspace_id', workspaceId)
      .eq('channel', channel)
      .eq('environment', 'production')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error(`[getPersistedBrowserChannelState] Query error for ${channel}:`, error)
      return {
        status: 'UNKNOWN',
        verified: false,
        blockerMessage: `${label} 연결 상태를 확인하는 중 오류가 발생했습니다.`,
        accountLabel: null,
        connectedAccountMatches: null,
        lastCheckedAt: null,
      }
    }

    return mapBrowserChannelRow(channel, data as BrowserChannelRow | null)
  } catch (err) {
    console.error(`[getPersistedBrowserChannelState] Unexpected error for ${channel}:`, err)
    return {
      status: 'UNKNOWN',
      verified: false,
      blockerMessage: `${label} 연결 상태를 확인하는 중 오류가 발생했습니다.`,
      accountLabel: null,
      connectedAccountMatches: null,
      lastCheckedAt: null,
    }
  }
}
