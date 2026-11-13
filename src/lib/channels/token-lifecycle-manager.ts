import { SupabaseClient } from '@supabase/supabase-js';

export type TokenHealthStatus =
  | 'HEALTHY'
  | 'EXPIRING_SOON'
  | 'TOKEN_EXPIRED'
  | 'PERMISSION_REVOKED'
  | 'REAUTH_REQUIRED'
  | 'DISCONNECTED';

export interface TokenStatusEvaluation {
  status: TokenHealthStatus;
  canPublish: boolean;
  expiresAt: string | null;
  daysRemaining: number | null;
  reason: string;
}

/**
 * 토큰 수명 주기 및 상태 평가 (ANI-626)
 */
export function evaluateTokenHealth(connection: {
  status: string;
  token_expires_at?: string | null;
  token_vault_ref?: string | null;
}): TokenStatusEvaluation {
  if (connection.status === 'disconnected' || !connection.token_vault_ref) {
    return {
      status: 'DISCONNECTED',
      canPublish: false,
      expiresAt: null,
      daysRemaining: null,
      reason: '계정이 연결 해제 상태입니다.'
    };
  }

  if (connection.status === 'reauth_required') {
    return {
      status: 'REAUTH_REQUIRED',
      canPublish: false,
      expiresAt: connection.token_expires_at || null,
      daysRemaining: 0,
      reason: '세션 또는 권한이 만료되어 재인증이 필요합니다.'
    };
  }

  if (!connection.token_expires_at) {
    // 만료일 정보가 없는 영구/장기 토큰
    return {
      status: 'HEALTHY',
      canPublish: true,
      expiresAt: null,
      daysRemaining: null,
      reason: '정상 연결됨 (장기 토큰)'
    };
  }

  const expiresMs = new Date(connection.token_expires_at).getTime();
  const nowMs = Date.now();
  const diffMs = expiresMs - nowMs;

  if (diffMs <= 0) {
    return {
      status: 'TOKEN_EXPIRED',
      canPublish: false,
      expiresAt: connection.token_expires_at,
      daysRemaining: 0,
      reason: '토큰 유효기간이 만료되었습니다. 재인증이 필요합니다.'
    };
  }

  const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (daysRemaining <= 7) {
    return {
      status: 'EXPIRING_SOON',
      canPublish: true,
      expiresAt: connection.token_expires_at,
      daysRemaining,
      reason: `토큰 만료가 ${daysRemaining}일 남았습니다. 자동 갱신 또는 재인증을 권장합니다.`
    };
  }

  return {
    status: 'HEALTHY',
    canPublish: true,
    expiresAt: connection.token_expires_at,
    daysRemaining,
    reason: `정상 연결됨 (만료까지 ${daysRemaining}일)`
  };
}

/**
 * 채널 연결 해제 및 큐잉 액션 안전 취소 (ANI-626)
 */
export async function disconnectChannelSafe(
  supabase: SupabaseClient,
  workspaceId: string,
  channel: string,
  operatorUserId?: string
): Promise<{ success: boolean; actionsCancelled: number }> {
  // 1. Mark channel connection as disconnected
  const { error: connErr } = await (supabase as any)
    .from('channel_connections')
    .update({
      status: 'disconnected',
      token_vault_ref: null,
      token_expires_at: null,
      verification_status: 'UNVERIFIED',
      updated_at: new Date().toISOString()
    })
    .eq('workspace_id', workspaceId)
    .eq('channel', channel);

  if (connErr) {
    throw new Error(`채널 연결 해제 실패: ${connErr.message}`);
  }

  // 2. Cancel all queued/scheduled content_items for this channel
  const { data: cancelledItems, error: itemsErr } = await (supabase as any)
    .from('content_items')
    .update({
      status: 'CANCELLED_CHANNEL_DISCONNECTED',
      updated_at: new Date().toISOString()
    })
    .eq('workspace_id', workspaceId)
    .eq('channel', channel)
    .in('status', ['SCHEDULED', 'PENDING_APPROVAL'])
    .select('id');

  const actionsCancelled = cancelledItems ? cancelledItems.length : 0;

  // 3. Revoke all channel consents
  await (supabase as any)
    .from('channel_consents')
    .update({
      is_granted: false,
      revoked_at: new Date().toISOString()
    })
    .eq('workspace_id', workspaceId)
    .eq('channel', channel);

  // 4. Log Audit Event
  await (supabase as any).from('audit_events').insert({
    workspace_id: workspaceId,
    entity_type: 'channel_connection',
    entity_id: `${workspaceId}:${channel}`,
    event_type: 'channel_disconnected',
    metadata: {
      channel,
      actionsCancelled,
      disconnected_by: operatorUserId || 'user'
    }
  }).catch((e: any) => console.warn('[disconnectChannelSafe] audit warning:', e));

  return { success: true, actionsCancelled };
}
