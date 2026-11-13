import { SupabaseClient } from '@supabase/supabase-js';

export interface BrowserSessionVaultItem {
  workspaceId: string;
  channel: 'NAVER_BLOG' | 'DAANGN';
  accountIdentifier: string;
  sessionStatus: 'CONNECTED' | 'DISCONNECTED' | 'REAUTH_REQUIRED';
  cookiesVaultRef?: string;
  userAgent?: string;
  lastHealthCheckedAt?: string;
}

/**
 * 네이버 블로그 / 당근마켓 브라우저 위임 세션 관리자 (ANI-620, ANI-627)
 * - Plaintext ID/PW 수집 금지 원칙 준수
 * - 암호화된 세션 레퍼런스(Vault Ref)만을 DB에 저장
 */
export async function saveBrowserDelegationSession(
  supabase: SupabaseClient,
  item: BrowserSessionVaultItem
): Promise<void> {
  const { error } = await (supabase as any)
    .from('browser_channel_connections')
    .upsert({
      workspace_id: item.workspaceId,
      channel: item.channel,
      session_status: item.sessionStatus,
      account_identifier: item.accountIdentifier,
      cookies_vault_ref: item.cookiesVaultRef || null,
      user_agent: item.userAgent || null,
      last_health_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'workspace_id,channel' });

  if (error) {
    throw new Error(`브라우저 세션 정보 저장 실패: ${error.message}`);
  }

  // channel_connections에도 상태 동기화
  await (supabase as any)
    .from('channel_connections')
    .upsert({
      workspace_id: item.workspaceId,
      channel: item.channel,
      status: item.sessionStatus === 'CONNECTED' ? 'connected' : 'disconnected',
      account_label: item.accountIdentifier,
      provider_account_id: item.accountIdentifier,
      token_vault_ref: item.cookiesVaultRef || `vault:browser:${item.channel.toLowerCase()}:${item.accountIdentifier}`,
      verification_status: item.sessionStatus === 'CONNECTED' ? 'CONFIGURED' : 'UNVERIFIED',
      updated_at: new Date().toISOString()
    }, { onConflict: 'workspace_id,channel' });

  // Browser Delegation Consent 원장 등록 (ANI-617)
  if (item.sessionStatus === 'CONNECTED') {
    await (supabase as any)
      .from('channel_consents')
      .upsert({
        workspace_id: item.workspaceId,
        channel: item.channel,
        consent_type: 'BROWSER_DELEGATION',
        is_granted: true,
        granted_at: new Date().toISOString()
      }, { onConflict: 'workspace_id,channel,consent_type' });
  }
}

/**
 * 브라우저 위임 세션 헬스 검증
 */
export async function getBrowserSessionHealth(
  supabase: SupabaseClient,
  workspaceId: string,
  channel: 'NAVER_BLOG' | 'DAANGN'
): Promise<{
  connected: boolean;
  status: 'CONNECTED' | 'DISCONNECTED' | 'REAUTH_REQUIRED' | 'PENDING';
  accountIdentifier: string | null;
  reason: string;
}> {
  if (channel === 'DAANGN') {
    return {
      connected: false,
      status: 'PENDING',
      accountIdentifier: null,
      reason: '당근 비즈프로필 브라우저 커넥터는 현재 자동화 정책 검증 준비 중입니다.'
    };
  }

  const { data: conn } = await (supabase as any)
    .from('browser_channel_connections')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('channel', channel)
    .maybeSingle();

  if (!conn || conn.session_status === 'DISCONNECTED') {
    return {
      connected: false,
      status: 'DISCONNECTED',
      accountIdentifier: null,
      reason: '네이버 계정이 연결되지 않았습니다. [브라우저 로그인 연동]이 필요합니다.'
    };
  }

  if (conn.session_status === 'REAUTH_REQUIRED') {
    return {
      connected: false,
      status: 'REAUTH_REQUIRED',
      accountIdentifier: conn.account_identifier,
      reason: '네이버 로그인 세션이 만료되었습니다. 다시 로그인해 주세요.'
    };
  }

  return {
    connected: true,
    status: 'CONNECTED',
    accountIdentifier: conn.account_identifier,
    reason: '네이버 블로그 브라우저 세션 정상 연결됨'
  };
}
