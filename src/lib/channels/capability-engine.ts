import { SupabaseClient } from '@supabase/supabase-js';
import { ChannelId, OFFICIAL_CHANNELS } from './channel-registry';
import { checkKillSwitchPreflight } from '@/lib/safety/kill-switch-guard';

export type EffectiveCapabilityStatus =
  | 'AVAILABLE'
  | 'LIMITED'
  | 'REQUIRES_CONNECTION'
  | 'REQUIRES_REAUTH'
  | 'BLOCKED_BY_KILL_SWITCH'
  | 'CAPABILITY_PENDING';

export interface EffectiveChannelCapability {
  channelId: ChannelId;
  displayName: string;
  status: EffectiveCapabilityStatus;
  canPublish: boolean;
  requiresUserAction: boolean;
  reason: string;
  executionPlane: string;
  lastVerifiedAt?: string;
  catalogStatus?: string;
}

export async function calculateEffectiveCapability(
  supabase: SupabaseClient,
  workspaceId: string,
  channelId: ChannelId
): Promise<EffectiveChannelCapability> {
  const official = OFFICIAL_CHANNELS[channelId] || {
    displayName: channelId,
    executionPlane: 'UNKNOWN',
    provider: channelId
  };

  // 1. Check Global/Channel Kill Switches with Fail-Closed Guard (ANI-599, ANI-605)
  const killCheck = await checkKillSwitchPreflight(supabase, {
    workspaceId,
    channel: channelId,
    provider: (official as any).provider || channelId
  });

  if (killCheck.blocked) {
    return {
      channelId,
      displayName: official.displayName,
      status: 'BLOCKED_BY_KILL_SWITCH',
      canPublish: false,
      requiresUserAction: false,
      reason: killCheck.reason || '운영자 긴급 킬스위치에 의해 발행이 일시 차단되었습니다.',
      executionPlane: official.executionPlane
    };
  }

  // 2. Query DB Canonical channel_capabilities catalog (ANI-605)
  const defaultActionType = channelId === 'NAVER_BLOG'
    ? 'PUBLISH_POST'
    : (channelId === 'DAANGN' ? 'BIZ_PROFILE_POST' : 'PUBLISH_FEED');

  let dbCap: any = null;
  try {
    const query = (supabase as any)
      .from('channel_capabilities')
      .select('*')
      .eq('channel', channelId);

    const chained = typeof query.eq === 'function' ? query.eq('action_type', defaultActionType) : query;
    const res = typeof chained?.maybeSingle === 'function' ? await chained.maybeSingle() : await chained;
    dbCap = res?.data;
  } catch (e) {
    console.warn('[capability-engine] channel_capabilities read fallback:', e);
  }

  const catalogStatus = dbCap?.status || (channelId === 'DAANGN' ? 'CAPABILITY_PENDING' : 'SUPPORTED');
  const executionPlane = dbCap?.execution_plane || official.executionPlane;

  if (catalogStatus === 'CAPABILITY_PENDING') {
    return {
      channelId,
      displayName: official.displayName,
      status: 'CAPABILITY_PENDING',
      canPublish: false,
      requiresUserAction: true,
      reason: dbCap?.description || `${official.displayName}은 현재 자동화 검증 준비 중입니다. 수동 보조 모드로 동작합니다.`,
      executionPlane,
      catalogStatus
    };
  }

  // 3. Check Channel Connection in DB
  const { data: conn } = await (supabase as any)
    .from('channel_connections')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('channel', channelId)
    .maybeSingle();

  // 4. Naver Blog Browser Connection fallback
  let isNaverConnected = false;
  let browserConnUpdatedAt: string | undefined;
  if (channelId === 'NAVER_BLOG') {
    const { data: browserConn } = await (supabase as any)
      .from('browser_channel_connections')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('channel', 'NAVER_BLOG')
      .maybeSingle();
    isNaverConnected = Boolean(browserConn && browserConn.status === 'connected');
    browserConnUpdatedAt = browserConn?.updated_at;
  }

  const isConnected = Boolean(conn && (conn.status === 'connected' || conn.status === 'configured')) || isNaverConnected;

  if (!isConnected) {
    return {
      channelId,
      displayName: official.displayName,
      status: 'REQUIRES_CONNECTION',
      canPublish: false,
      requiresUserAction: true,
      reason: '공식 계정이 아직 연결되지 않았습니다. [계정 연동하기]를 먼저 완료해 주세요.',
      executionPlane,
      catalogStatus
    };
  }

  if (conn?.status === 'reauth_required') {
    return {
      channelId,
      displayName: official.displayName,
      status: 'REQUIRES_REAUTH',
      canPublish: false,
      requiresUserAction: true,
      reason: '세션 또는 토큰이 만료되어 재인증이 필요합니다.',
      executionPlane,
      catalogStatus,
      lastVerifiedAt: conn.updated_at || undefined
    };
  }

  // 5. Available or Limited to publish (Never synthesize fake current timestamp: ANI-605)
  const finalStatus = catalogStatus === 'LIMITED' ? 'LIMITED' : 'AVAILABLE';
  const verifiedTimestamp = conn?.updated_at || browserConnUpdatedAt || undefined;

  return {
    channelId,
    displayName: official.displayName,
    status: finalStatus,
    canPublish: true,
    requiresUserAction: false,
    reason: finalStatus === 'LIMITED'
      ? '보조 자동화 모드로 정상 연결됨 (브라우저 발행 보조).'
      : '정상 연결됨. 소희가 자율적으로 콘텐츠를 발행할 수 있습니다.',
    executionPlane,
    catalogStatus,
    lastVerifiedAt: verifiedTimestamp
  };
}
