import {
  CONNECTOR_CATALOG,
  getConnectorDefinition,
  type ConnectorConnectionSummary,
  type ConnectorHubSnapshot,
  type ConnectorId,
  type ConnectorStatus,
} from '../catalog';
import { getMetaRequiredScopes } from '@/features/channels/oauth/meta-oauth';
import { normalizeChannelScopes } from '@/features/channels/dual-channel-verification';

export interface MarketingConnectorGateway {
  getMarketingConnections(workspaceId: string): Promise<{
    data: Array<{
      workspace_id: string;
      connector_id: string;
      status: string;
      last_sync_at?: string | null;
      capabilities?: string[];
    }> | null;
    error: { code?: string; message: string } | null;
  }>;
  getChannelConnections(workspaceId: string): Promise<{
    data: Array<{
      id: string;
      workspace_id: string;
      channel: string;
      status: string;
      updated_at?: string | null;
    }> | null;
    error: { code?: string; message: string } | null;
  }>;
  getMetaCredentials(workspaceId: string): Promise<{
    data: Array<{
      workspace_id?: string;
      channel_connection_id: string;
      provider: string;
      status: string;
      granted_scopes?: string[];
      token_expires_at?: string | null;
    }> | null;
    error: { code?: string; message: string } | null;
  }>;
  disconnectConnectorRpc(params: {
    p_workspace_id: string;
    p_connector_id: string;
    p_actor_user_id: string;
  }): Promise<{
    data: {
      connector_id: string;
      consent_generation: number;
      status: string;
      pending_deletion: boolean;
    } | null;
    error: { code?: string; message: string } | null;
  }>;
  getDeletionJobs?(workspaceId: string): Promise<{
    data: Array<{
      workspace_id: string;
      connector_id: string;
      consent_generation: number;
      status: string;
    }> | null;
    error: { code?: string; message: string } | null;
  }>;
  checkWorkspaceRole(
    workspaceId: string,
    userId: string
  ): Promise<{ ok: boolean; role?: string }>;
}

export class MarketingConnectorError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'MarketingConnectorError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Loads the marketing connector snapshot for a workspace.
 * Resolves all 11 catalog connectors, social credentials, and productivity states.
 */
export async function loadConnectorHubSnapshot(
  workspaceId: string,
  gateway: MarketingConnectorGateway
): Promise<ConnectorHubSnapshot> {
  if (!workspaceId || typeof workspaceId !== 'string') {
    throw new MarketingConnectorError(400, 'INVALID_WORKSPACE_ID', '유효한 작업공간 식별자가 필요합니다.');
  }

  const [marketingRes, channelRes, metaCredsRes] = await Promise.all([
    gateway.getMarketingConnections(workspaceId),
    gateway.getChannelConnections(workspaceId),
    gateway.getMetaCredentials(workspaceId),
  ]);

  if (channelRes.error) {
    throw new MarketingConnectorError(
      500,
      'DATABASE_ERROR',
      '채널 연결 정보 조회 중 데이터베이스 오류가 발생했습니다.'
    );
  }

  if (metaCredsRes.error) {
    throw new MarketingConnectorError(
      500,
      'DATABASE_ERROR',
      '채널 인증 정보 조회 중 데이터베이스 오류가 발생했습니다.'
    );
  }

  let storageReady = true;
  if (marketingRes.error) {
    if (
      marketingRes.error.code === '42P01' ||
      marketingRes.error.code === 'PGRST205' ||
      marketingRes.error.message.includes('does not exist') ||
      marketingRes.error.message.includes('schema cache')
    ) {
      storageReady = false;
    } else {
      throw new MarketingConnectorError(
        500,
        'DATABASE_ERROR',
        '마케팅 커넥터 조회 중 데이터베이스 오류가 발생했습니다.'
      );
    }
  }

  const marketingMap = new Map<string, { status: ConnectorStatus; lastSyncAt: string | null; capabilities: string[] }>();
  if (storageReady && Array.isArray(marketingRes.data)) {
    for (const row of marketingRes.data) {
      if (row.workspace_id !== workspaceId) continue;
      if (marketingMap.has(row.connector_id)) {
        throw new MarketingConnectorError(
          500,
          'DUPLICATE_CONNECTOR',
          '작업공간에 중복된 마케팅 커넥터가 존재합니다.'
        );
      }
      const rawStatus = row.status;
      let status: ConnectorStatus = 'disconnected';
      if (rawStatus === 'connected') {
        status = 'connected';
      } else if (
        rawStatus === 'reauth_required' ||
        rawStatus === 'token_expired' ||
        rawStatus === 'refresh_required' ||
        rawStatus === 'scope_incomplete'
      ) {
        status = 'reauth_required';
      } else if (rawStatus === 'error' || rawStatus === 'failed') {
        status = 'error';
      } else {
        status = 'disconnected';
      }

      // Non-connected status must not carry active capabilities
      const capabilities =
        status === 'connected' && Array.isArray(row.capabilities)
          ? [...row.capabilities]
          : [];

      marketingMap.set(row.connector_id, {
        status,
        lastSyncAt: row.last_sync_at ?? null,
        capabilities,
      });
    }
  }

  const rawChannels = Array.isArray(channelRes.data) ? channelRes.data.filter((c) => c.workspace_id === workspaceId) : [];

  // Fail-closed against duplicate channels in workspace (violates unique workspace_id, channel)
  const igChannels = rawChannels.filter((c) => c.channel === 'instagram');
  if (igChannels.length > 1) {
    throw new MarketingConnectorError(500, 'DUPLICATE_CHANNEL', '작업공간에 중복된 Instagram 채널이 존재합니다.');
  }
  const thChannels = rawChannels.filter((c) => c.channel === 'threads');
  if (thChannels.length > 1) {
    throw new MarketingConnectorError(500, 'DUPLICATE_CHANNEL', '작업공간에 중복된 Threads 채널이 존재합니다.');
  }

  const igConn = igChannels[0] ?? null;
  const thConn = thChannels[0] ?? null;

  // Verify tenant stamp on all privileged credentials
  if (Array.isArray(metaCredsRes.data)) {
    for (const cred of metaCredsRes.data) {
      if (!cred.workspace_id) {
        throw new MarketingConnectorError(
          500,
          'UNSTAMPED_CREDENTIAL',
          '자격증명 테넌트 정보가 누락되었습니다.'
        );
      }
    }
  }

  const metaCreds = Array.isArray(metaCredsRes.data)
    ? metaCredsRes.data.filter((cred) => cred.workspace_id === workspaceId)
    : [];

  const igCred = igConn ? metaCreds.find((cred) => cred.channel_connection_id === igConn.id && cred.provider === 'instagram') : null;
  const thCred = thConn ? metaCreds.find((cred) => cred.channel_connection_id === thConn.id && cred.provider === 'threads') : null;

  const isIgCredValid = Boolean(
    igCred &&
    igCred.status === 'active' &&
    (!igCred.token_expires_at || Date.parse(igCred.token_expires_at) > Date.now())
  );

  const isThCredValid = Boolean(
    thCred &&
    thCred.status === 'active' &&
    (!thCred.token_expires_at || Date.parse(thCred.token_expires_at) > Date.now())
  );

  const normalizedIgScopes = isIgCredValid
    ? normalizeChannelScopes('instagram', igCred?.granted_scopes ?? [])
    : [];

  const normalizedThScopes = isThCredValid
    ? normalizeChannelScopes('threads', thCred?.granted_scopes ?? [])
    : [];

  const resolveChannelStatus = (
    conn: { status: string } | null | undefined,
    cred: { status: string; token_expires_at?: string | null } | null | undefined
  ): 'connected' | 'reauth_required' | 'error' | 'disconnected' => {
    if (!conn) {
      return 'disconnected';
    }

    if (
      conn.status === 'disconnected' ||
      conn.status === 'revoked' ||
      cred?.status === 'revoked'
    ) {
      return 'disconnected';
    }

    if (conn.status === 'error' || cred?.status === 'error') {
      return 'error';
    }

    const isTokenExpired = Boolean(
      cred?.token_expires_at && Date.parse(cred.token_expires_at) <= Date.now()
    );

    const isReauthRequired =
      conn.status === 'reauth_required' ||
      conn.status === 'token_expired' ||
      conn.status === 'scope_incomplete' ||
      !cred ||
      cred.status !== 'active' ||
      isTokenExpired;

    if (isReauthRequired) {
      return 'reauth_required';
    }

    return 'connected';
  };

  const connections: ConnectorConnectionSummary[] = CONNECTOR_CATALOG.map((def) => {
    if (def.id === 'instagram') {
      const baseStatus = resolveChannelStatus(igConn, igCred);
      if (baseStatus !== 'connected') {
        return {
          connectorId: 'instagram',
          status: baseStatus,
          lastSyncAt: null,
          capabilities: [],
        };
      }

      const requiredRead = getMetaRequiredScopes('instagram', 'read');
      const hasRead = requiredRead.every((scope) => normalizedIgScopes.includes(scope));
      const requiredPublish = getMetaRequiredScopes('instagram', 'publish');
      const hasPublish = requiredPublish.every((scope) => normalizedIgScopes.includes(scope));

      const capabilities: string[] = [];
      if (hasRead) capabilities.push('feed_read');
      if (hasPublish) capabilities.push('post_publish');

      if (capabilities.length === 0) {
        return {
          connectorId: 'instagram',
          status: 'reauth_required',
          lastSyncAt: null,
          capabilities: [],
        };
      }

      return {
        connectorId: 'instagram',
        status: 'connected',
        lastSyncAt: null,
        capabilities,
      };
    }

    if (def.id === 'threads') {
      const baseStatus = resolveChannelStatus(thConn, thCred);
      if (baseStatus !== 'connected') {
        return {
          connectorId: 'threads',
          status: baseStatus,
          lastSyncAt: null,
          capabilities: [],
        };
      }

      const requiredRead = getMetaRequiredScopes('threads', 'read');
      const hasRead = requiredRead.every((scope) => normalizedThScopes.includes(scope));
      const requiredPublish = getMetaRequiredScopes('threads', 'publish');
      const hasPublish = requiredPublish.every((scope) => normalizedThScopes.includes(scope));

      const capabilities: string[] = [];
      if (hasRead) capabilities.push('threads_read');
      if (hasPublish) capabilities.push('threads_publish');

      if (capabilities.length === 0) {
        return {
          connectorId: 'threads',
          status: 'reauth_required',
          lastSyncAt: null,
          capabilities: [],
        };
      }

      return {
        connectorId: 'threads',
        status: 'connected',
        lastSyncAt: null,
        capabilities,
      };
    }

    if (def.id === 'instagram_messages') {
      const baseStatus = resolveChannelStatus(igConn, igCred);
      if (baseStatus !== 'connected') {
        return {
          connectorId: 'instagram_messages',
          status: baseStatus,
          lastSyncAt: null,
          capabilities: [],
        };
      }

      const requiredDmScopes = getMetaRequiredScopes('instagram', 'message');
      const hasDmScope = requiredDmScopes.every((scope) => normalizedIgScopes.includes(scope));

      if (hasDmScope) {
        return {
          connectorId: 'instagram_messages',
          status: 'connected',
          lastSyncAt: null,
          capabilities: ['direct_messages'],
        };
      }

      return {
        connectorId: 'instagram_messages',
        status: 'reauth_required',
        lastSyncAt: null,
        capabilities: [],
      };
    }

    // Productivity connectors
    const found = marketingMap.get(def.id);
    if (found) {
      return {
        connectorId: def.id,
        status: found.status,
        lastSyncAt: found.lastSyncAt,
        capabilities: Object.freeze([...found.capabilities]),
      };
    }

    return {
      connectorId: def.id,
      status: 'disconnected',
      lastSyncAt: null,
      capabilities: [],
    };
  });

  let pendingDeletions: readonly ConnectorId[] | undefined = undefined;
  if (storageReady && typeof gateway.getDeletionJobs === 'function') {
    const deletionJobsRes = await gateway.getDeletionJobs(workspaceId);
    if (deletionJobsRes.error) {
      throw new MarketingConnectorError(
        500,
        'DATABASE_ERROR',
        '삭제 작업 목록 조회 중 데이터베이스 오류가 발생했습니다.'
      );
    }

    const pendingSet = new Set<ConnectorId>();
    if (Array.isArray(deletionJobsRes.data)) {
      for (const job of deletionJobsRes.data) {
        if (job.workspace_id !== workspaceId) continue;
        const def = getConnectorDefinition(job.connector_id);
        if (!def) continue;

        if (
          typeof job.consent_generation !== 'number' ||
          !Number.isSafeInteger(job.consent_generation) ||
          job.consent_generation <= 0
        ) {
          throw new MarketingConnectorError(
            500,
            'MALFORMED_DELETION_JOB',
            '유효하지 않은 삭제 작업 동의 세대 정보가 존재합니다.'
          );
        }

        if (job.status === 'pending' || job.status === 'running' || job.status === 'failed') {
          pendingSet.add(def.id);
        }
      }
    }
    pendingDeletions = Object.freeze(Array.from(pendingSet));
  }

  return {
    workspaceId,
    connections: Object.freeze(connections),
    storageReady,
    ...(pendingDeletions !== undefined ? { pendingDeletions } : {}),
  };
}

/**
 * Disconnects a marketing connector atomically using RPC.
 * Rejects social connectors (must be handled via /app/channels).
 * Rejects non-manager/owner roles.
 */
export async function disconnectMarketingConnector(
  input: {
    workspaceId: string;
    connectorId: ConnectorId;
    actorUserId: string;
  },
  gateway: MarketingConnectorGateway
): Promise<{
  success: boolean;
  connectorId: ConnectorId;
  consentGeneration: number;
  pendingDeletion: boolean;
}> {
  const { workspaceId, connectorId, actorUserId } = input;

  const def = getConnectorDefinition(connectorId);
  if (!def) {
    throw new MarketingConnectorError(
      400,
      'INVALID_CONNECTOR_ID',
      `유효하지 않은 커넥터 식별자입니다: ${String(connectorId)}`
    );
  }

  // Social connectors must not return pseudo-success without existing ledger integration
  if (def.category === 'social' || connectorId === 'instagram' || connectorId === 'threads' || connectorId === 'instagram_messages') {
    throw new MarketingConnectorError(
      400,
      'SOCIAL_CHANNEL_MANAGEMENT_REQUIRED',
      '소셜 채널 연결 해제는 기존 채널 관리(/app/channels)에서 진행해야 합니다.'
    );
  }

  // Role guard
  const roleCheck = await gateway.checkWorkspaceRole(workspaceId, actorUserId);
  if (!roleCheck.ok || !roleCheck.role || (roleCheck.role !== 'owner' && roleCheck.role !== 'manager')) {
    throw new MarketingConnectorError(
      403,
      'FORBIDDEN',
      '커넥터 연결 해제 권한이 없습니다. 소유자 또는 관리자 권한이 필요합니다.'
    );
  }

  const rpcRes = await gateway.disconnectConnectorRpc({
    p_workspace_id: workspaceId,
    p_connector_id: connectorId,
    p_actor_user_id: actorUserId,
  });

  if (rpcRes.error) {
    if (rpcRes.error.code === 'P0002') {
      throw new MarketingConnectorError(404, 'NOT_FOUND', '커넥터 연결을 찾을 수 없습니다.');
    }
    throw new MarketingConnectorError(
      500,
      'RPC_DISCONNECT_FAILED',
      '커넥터 해제 처리 중 오류가 발생했습니다.'
    );
  }

  if (!rpcRes.data) {
    throw new MarketingConnectorError(
      500,
      'RPC_DISCONNECT_FAILED',
      '커넥터 해제 처리 중 오류가 발생했습니다.'
    );
  }

  const receipt = rpcRes.data;
  if (
    receipt.connector_id !== connectorId ||
    receipt.status !== 'revoked' ||
    typeof receipt.consent_generation !== 'number' ||
    !Number.isInteger(receipt.consent_generation) ||
    receipt.consent_generation < 1 ||
    typeof receipt.pending_deletion !== 'boolean'
  ) {
    throw new MarketingConnectorError(
      500,
      'INVALID_RECEIPT',
      '커넥터 해제 영수증 검증에 실패했습니다.'
    );
  }

  return {
    success: true,
    connectorId,
    consentGeneration: receipt.consent_generation,
    pendingDeletion: receipt.pending_deletion,
  };
}
