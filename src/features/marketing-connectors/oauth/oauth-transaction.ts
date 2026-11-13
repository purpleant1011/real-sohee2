import 'server-only';

import crypto from 'node:crypto';
import type { ProviderId } from '../providers/registry';

export const OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1000; // 10 minutes

export type OAuthTransactionErrorCode =
  | 'TRANSACTION_NOT_FOUND'
  | 'ALREADY_CONSUMED'
  | 'EXPIRED_TRANSACTION'
  | 'TENANT_MISMATCH'
  | 'INVALID_PARAMS';

export class OAuthTransactionError extends Error {
  readonly code: OAuthTransactionErrorCode;
  readonly status: number;

  constructor(code: OAuthTransactionErrorCode, message: string, status = 400) {
    super(message);
    this.name = 'OAuthTransactionError';
    this.code = code;
    this.status = status;
  }
}

export type OAuthTransactionRecord = {
  id: string;
  workspaceId: string;
  userId: string;
  providerId: ProviderId;
  stateHash: string;
  codeVerifier: string;
  codeChallenge: string;
  requestedScopes: readonly string[];
  redirectUri: string;
  expiresAt: string; // ISO 8601
  consumedAt: string | null;
  createdAt: string;
};

export interface OAuthTransactionGateway {
  saveTransaction(record: OAuthTransactionRecord): Promise<void>;
  findByStateHash(stateHash: string): Promise<OAuthTransactionRecord | null>;
  consumeAtomic(id: string, stateHash: string, consumedAt: Date): Promise<boolean>;
}

export type CreateOAuthTransactionParams = {
  workspaceId: string;
  userId: string;
  providerId: ProviderId;
  requestedScopes: readonly string[];
  redirectUri: string;
  now?: Date;
  ttlMs?: number;
};

export type CreatedOAuthTransaction = {
  id: string;
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  expiresAt: string;
};

export type ConsumeSession = {
  workspaceId: string;
  userId: string;
};

export type ConsumedOAuthTransaction = {
  id: string;
  codeVerifier: string;
  code_verifier: string;
  requestedScopes: readonly string[];
  redirectUri: string;
  providerId: ProviderId;
  workspaceId: string;
  userId: string;
};

/**
 * Generates an RFC 7636 compliant PKCE code_verifier.
 * Uses 64 random bytes encoded as base64url (86 characters), satisfying the 43~128 char unreserved constraint.
 */
export function generatePkceVerifier(byteLength = 64): string {
  const safeLength = Math.max(32, Math.min(96, byteLength));
  return crypto.randomBytes(safeLength).toString('base64url');
}

/**
 * Computes S256 PKCE code_challenge from code_verifier.
 * code_challenge = BASE64URL-ENCODE(SHA256(code_verifier)) without padding.
 */
export function computePkceChallenge(codeVerifier: string): string {
  return crypto.createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
}

/**
 * Generates high-entropy OAuth state (32 random bytes = 64 hex characters) and its SHA-256 hash.
 */
export function generateOAuthState(byteLength = 32): { state: string; stateHash: string } {
  const safeLength = Math.max(16, byteLength);
  const state = crypto.randomBytes(safeLength).toString('hex');
  const stateHash = hashOAuthState(state);
  return { state, stateHash };
}

/**
 * Computes SHA-256 hex digest for lookup by state without exposing raw state.
 */
export function hashOAuthState(rawState: string): string {
  return crypto.createHash('sha256').update(rawState, 'utf8').digest('hex');
}

/**
 * Creates an ephemeral OAuth transaction with PKCE and 10-minute TTL.
 */
export async function createMarketingOAuthTransaction(
  params: CreateOAuthTransactionParams,
  gateway: OAuthTransactionGateway
): Promise<CreatedOAuthTransaction> {
  const { workspaceId, userId, providerId, requestedScopes, redirectUri } = params;

  if (!workspaceId || typeof workspaceId !== 'string') {
    throw new OAuthTransactionError('INVALID_PARAMS', '유효한 작업공간 식별자가 필요합니다.');
  }
  if (!userId || typeof userId !== 'string') {
    throw new OAuthTransactionError('INVALID_PARAMS', '유효한 사용자 식별자가 필요합니다.');
  }
  if (!providerId || typeof providerId !== 'string') {
    throw new OAuthTransactionError('INVALID_PARAMS', '유효한 공급자 식별자가 필요합니다.');
  }
  if (!redirectUri || typeof redirectUri !== 'string') {
    throw new OAuthTransactionError('INVALID_PARAMS', '유효한 리다이렉트 URI가 필요합니다.');
  }

  const now = params.now ?? new Date();
  const ttlMs = params.ttlMs ?? OAUTH_TRANSACTION_TTL_MS;
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const createdAt = now.toISOString();

  const codeVerifier = generatePkceVerifier();
  const codeChallenge = computePkceChallenge(codeVerifier);
  const { state, stateHash } = generateOAuthState();
  const id = crypto.randomUUID();

  const record: OAuthTransactionRecord = {
    id,
    workspaceId,
    userId,
    providerId,
    stateHash,
    codeVerifier,
    codeChallenge,
    requestedScopes: Array.isArray(requestedScopes) ? requestedScopes : [],
    redirectUri,
    expiresAt,
    consumedAt: null,
    createdAt,
  };

  await gateway.saveTransaction(record);

  return {
    id,
    state,
    codeVerifier,
    codeChallenge,
    expiresAt,
  };
}

/**
 * Consumes an OAuth transaction in an atomic single-use step.
 * Validates state hash, tenant/user session boundary, and expiration.
 * Prevents race condition replay attacks via conditional update.
 */
export async function consumeMarketingOAuthTransaction(
  rawState: string,
  session: ConsumeSession,
  gateway: OAuthTransactionGateway,
  now = new Date()
): Promise<ConsumedOAuthTransaction> {
  if (!rawState || typeof rawState !== 'string') {
    throw new OAuthTransactionError('INVALID_PARAMS', '유효한 state 문자열이 필요합니다.', 400);
  }
  if (!session?.workspaceId || !session?.userId) {
    throw new OAuthTransactionError('INVALID_PARAMS', '유효한 사용자 세션 정보가 필요합니다.', 400);
  }

  const stateHash = hashOAuthState(rawState);
  const record = await gateway.findByStateHash(stateHash);

  if (!record) {
    throw new OAuthTransactionError(
      'TRANSACTION_NOT_FOUND',
      '해당하는 OAuth 트랜잭션을 찾을 수 없습니다.',
      404
    );
  }

  // 1. Tenant & user boundary verification
  if (record.workspaceId !== session.workspaceId || record.userId !== session.userId) {
    throw new OAuthTransactionError(
      'TENANT_MISMATCH',
      '트랜잭션의 워크스페이스 또는 사용자가 세션과 일치하지 않습니다.',
      403
    );
  }

  // 2. Already consumed check
  if (record.consumedAt !== null) {
    throw new OAuthTransactionError(
      'ALREADY_CONSUMED',
      '이미 소비된 OAuth 트랜잭션입니다.',
      409
    );
  }

  // 3. Expiration check
  const expiresAtMs = new Date(record.expiresAt).getTime();
  if (expiresAtMs <= now.getTime()) {
    throw new OAuthTransactionError(
      'EXPIRED_TRANSACTION',
      '만료된 OAuth 트랜잭션입니다.',
      410
    );
  }

  // 4. Atomic conditional single-use consumption
  const consumed = await gateway.consumeAtomic(record.id, stateHash, now);
  if (!consumed) {
    throw new OAuthTransactionError(
      'ALREADY_CONSUMED',
      '동시 소비 시도로 인해 트랜잭션이 이미 소비되었습니다.',
      409
    );
  }

  return {
    id: record.id,
    codeVerifier: record.codeVerifier,
    code_verifier: record.codeVerifier,
    requestedScopes: record.requestedScopes,
    redirectUri: record.redirectUri,
    providerId: record.providerId,
    workspaceId: record.workspaceId,
    userId: record.userId,
  };
}

/**
 * Creates a Supabase-backed OAuth transaction gateway for production usage.
 */
export function createSupabaseOAuthTransactionGateway(supabase: {
  from: (table: string) => any;
}): OAuthTransactionGateway {
  return {
    async saveTransaction(record: OAuthTransactionRecord): Promise<void> {
      const { error } = await supabase.from('marketing_connector_oauth_transactions').insert({
        id: record.id,
        workspace_id: record.workspaceId,
        user_id: record.userId,
        provider_id: record.providerId,
        state_hash: record.stateHash,
        code_verifier: record.codeVerifier,
        code_challenge: record.codeChallenge,
        requested_scopes: [...record.requestedScopes],
        redirect_uri: record.redirectUri,
        expires_at: record.expiresAt,
        consumed_at: record.consumedAt,
        created_at: record.createdAt,
      });

      if (error) {
        throw new Error(`Failed to save OAuth transaction: ${error.message}`);
      }
    },

    async findByStateHash(stateHash: string): Promise<OAuthTransactionRecord | null> {
      const { data, error } = await supabase
        .from('marketing_connector_oauth_transactions')
        .select('*')
        .eq('state_hash', stateHash)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      return {
        id: data.id,
        workspaceId: data.workspace_id,
        userId: data.user_id,
        providerId: data.provider_id,
        stateHash: data.state_hash,
        codeVerifier: data.code_verifier,
        codeChallenge: data.code_challenge,
        requestedScopes: data.requested_scopes ?? [],
        redirectUri: data.redirect_uri,
        expiresAt: data.expires_at,
        consumedAt: data.consumed_at ?? null,
        createdAt: data.created_at,
      };
    },

    async consumeAtomic(id: string, stateHash: string, consumedAt: Date): Promise<boolean> {
      const { data, error } = await supabase
        .from('marketing_connector_oauth_transactions')
        .update({
          consumed_at: consumedAt.toISOString(),
          updated_at: consumedAt.toISOString(),
        })
        .eq('id', id)
        .eq('state_hash', stateHash)
        .is('consumed_at', null)
        .gt('expires_at', consumedAt.toISOString())
        .select('id');

      if (error || !data) {
        return false;
      }
      return data.length > 0;
    },
  };
}
