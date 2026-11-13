import { SupabaseClient } from '@supabase/supabase-js';
import { DuplicateBindingError } from '@/features/channels/oauth/meta-oauth';
import crypto from 'crypto';

export interface CreateOAuthTransactionParams {
  workspaceId: string;
  userId: string;
  provider: 'META' | 'NAVER' | 'DAANGN';
  channel: 'INSTAGRAM' | 'THREADS' | 'NAVER_BLOG' | 'DAANGN';
  requestedScopes: string[];
  redirectUri: string;
  returnPath?: string;
  codeVerifier?: string;
}

export interface OAuthTransaction {
  id: string;
  workspaceId: string;
  userId: string;
  provider: string;
  channel: string;
  stateHash: string;
  redirectUri: string;
  requestedScopes: string[];
  returnPath: string;
  correlationId: string;
  expiresAt: string;
  consumedAt: string | null;
}

export function hashState(state: string): string {
  return crypto.createHash('sha256').update(state).digest('hex');
}

/**
 * Single-use OAuth Transaction 생성 (ANI-625)
 * - 10분 유효기간
 * - 암호학적 난수 state 생성 및 SHA-256 해시 저장
 */
export async function createOAuthTransaction(
  supabase: SupabaseClient,
  params: CreateOAuthTransactionParams
): Promise<{ state: string; transactionId: string; correlationId: string }> {
  const rawState = crypto.randomBytes(32).toString('hex');
  const stateHash = hashState(rawState);
  const correlationId = `oauth_${params.channel.toLowerCase()}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10분 TTL

  const { data, error } = await (supabase as any)
    .from('oauth_transactions')
    .insert({
      workspace_id: params.workspaceId,
      user_id: params.userId,
      provider: params.provider,
      channel: params.channel,
      state_hash: stateHash,
      code_verifier: params.codeVerifier || null,
      redirect_uri: params.redirectUri,
      requested_scopes: params.requestedScopes,
      return_path: params.returnPath || '/app/settings/channels',
      correlation_id: correlationId,
      expires_at: expiresAt
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`OAuth 트랜잭션 생성 실패: ${error?.message || 'DB 에러'}`);
  }

  return {
    state: rawState,
    transactionId: data.id,
    correlationId
  };
}

/**
 * OAuth Callback 시 Single-Use State 검증 및 원자적 소비 (ANI-625)
 * - Replay 방지 (이미 소비된 state는 거부)
 * - 만료 시간 검증
 * - 테넌트 격리 검증 (세션 워크스페이스/유저 일치)
 */
export async function consumeOAuthTransaction(
  supabase: SupabaseClient,
  rawState: string,
  sessionWorkspaceId: string,
  sessionUserId: string
): Promise<OAuthTransaction> {
  const stateHash = hashState(rawState);

  // 1. Fetch transaction by state_hash
  const { data: tx, error } = await (supabase as any)
    .from('oauth_transactions')
    .select('*')
    .eq('state_hash', stateHash)
    .maybeSingle();

  if (error || !tx) {
    throw new Error('유효하지 않거나 위조된 OAuth 상태값(state)입니다.');
  }

  // 2. Check Expiration
  if (new Date(tx.expires_at).getTime() < Date.now()) {
    throw new Error('OAuth 트랜잭션 유효 시간(10분)이 만료되었습니다. 다시 시도해 주세요.');
  }

  // 3. Check Single-Use / Replay Attack Prevention
  if (tx.consumed_at) {
    throw new Error('이미 사용된 일회용 OAuth 상태값입니다. 중복 요청(Replay Attack)이 차단되었습니다.');
  }

  // 4. Multi-Tenant Isolation: 세션 유저 및 워크스페이스 대조
  if (tx.workspace_id !== sessionWorkspaceId || tx.user_id !== sessionUserId) {
    throw new Error('OAuth 요청 주체와 현재 로그인 세션이 일치하지 않습니다. (Cross-Tenant 침범 차단)');
  }

  // 5. 원자적 소비 기록 (Mark as Consumed)
  const { error: updateErr } = await (supabase as any)
    .from('oauth_transactions')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', tx.id);

  if (updateErr) {
    throw new Error(`OAuth 트랜잭션 무효화 갱신 실패: ${updateErr.message}`);
  }

  return {
    id: tx.id,
    workspaceId: tx.workspace_id,
    userId: tx.user_id,
    provider: tx.provider,
    channel: tx.channel,
    stateHash: tx.state_hash,
    redirectUri: tx.redirect_uri,
    requestedScopes: tx.requested_scopes,
    returnPath: tx.return_path,
    correlationId: tx.correlation_id,
    expiresAt: tx.expires_at,
    consumedAt: new Date().toISOString()
  };
}

/**
 * Cross-Workspace 중복 바인딩 차단 검증 (ANI-625)
 */
export async function assertNoCrossWorkspaceBinding(
  supabase: SupabaseClient,
  channel: string,
  providerAccountId: string,
  currentWorkspaceId: string
): Promise<void> {
  if (!providerAccountId) return;

  const { data: existing } = await (supabase as any)
    .from('channel_connections')
    .select('workspace_id, account_label')
    .eq('channel', channel)
    .eq('provider_account_id', providerAccountId)
    .neq('workspace_id', currentWorkspaceId)
    .in('status', ['connected', 'configured'])
    .maybeSingle();

  if (existing) {
    throw new DuplicateBindingError(`DUPLICATE_BINDING: 해당 SNS 계정(@${existing.account_label || providerAccountId})은 이미 다른 매장(워크스페이스)에 연결되어 있습니다. 타 매장에서 먼저 연결을 해제해야 합니다.`);
  }
}
