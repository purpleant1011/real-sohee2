import 'server-only';
import { randomUUID } from 'node:crypto';
import {
  CONNECTOR_CATALOG,
  type ConnectorId,
  type ConnectorStatus,
} from '../catalog';
import {
  loadConnectorHubSnapshot,
  MarketingConnectorError,
  type MarketingConnectorGateway,
} from './connection-service';

export type ConnectorOperationalStatus =
  | 'connected'
  | 'reauth_required'
  | 'disconnected'
  | 'pending_deletion'
  | 'error';

export type ConsentOperationalStatus = 'active' | 'revoked' | 'none';

export type DeletionOperationalStatus =
  | 'none'
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed';

export interface ConnectorOperationalSummary {
  readonly connectorId: ConnectorId;
  readonly status: ConnectorOperationalStatus;
  readonly rawConnectionStatus: ConnectorStatus;
  readonly consentGeneration: number | null;
  readonly consentStatus: ConsentOperationalStatus;
  readonly lastSyncAt: string | null;
  readonly lastSyncSuccessAt: string | null;
  readonly lastSyncFailureAt: string | null;
  readonly lastSyncErrorCode?: string | null;
  readonly activeEvidenceCount: number;
  readonly deletionStatus: DeletionOperationalStatus;
  readonly deletionJobId?: string | null;
}

export interface WorkspaceConnectorsOperationalSummary {
  readonly workspaceId: string;
  readonly connectors: Record<ConnectorId, ConnectorOperationalSummary>;
  readonly generatedAt: string;
  readonly correlationId: string;
}

export interface OperationalProjectionGateway extends MarketingConnectorGateway {
  getConsents?(workspaceId: string): Promise<{
    data: Array<{
      connector_id: string;
      consent_generation: number;
      status: string;
      valid_until?: string | null;
    }> | null;
    error: { code?: string; message: string } | null;
  }>;
  getSyncJobs?(workspaceId: string): Promise<{
    data: Array<{
      id?: string;
      connector_id: string;
      status: string;
      created_at: string;
      updated_at?: string | null;
      last_error?: Record<string, unknown> | null;
    }> | null;
    error: { code?: string; message: string } | null;
  }>;
  getDeletionJobs?(workspaceId: string): Promise<{
    data: Array<{
      id?: string;
      workspace_id: string;
      connector_id: string;
      consent_generation: number;
      status: string;
      created_at?: string;
      updated_at?: string | null;
    }> | null;
    error: { code?: string; message: string } | null;
  }>;
  getEvidenceStats?(workspaceId: string): Promise<{
    data: Array<{
      connector_id: string;
      active_count: number;
    }> | Record<string, number> | null;
    error: { code?: string; message: string } | null;
  }>;
}

export interface ProjectOperationalStateOptions {
  readonly correlationId?: string;
  readonly now?: string;
}

const SAFE_ERROR_CODE_REGEX = /^[A-Z0-9_]{1,64}$/;

function extractSafeErrorCode(lastError: Record<string, unknown> | null | undefined): string | null {
  if (!lastError || typeof lastError !== 'object') {
    return null;
  }
  const rawCode = lastError.code;
  if (typeof rawCode === 'string') {
    const trimmed = rawCode.trim();
    if (SAFE_ERROR_CODE_REGEX.test(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

/**
 * MC/F08 11개 마케팅 커넥터 전수 운영 프로젝션 서비스
 *
 * 연결 상태, F04 동의 세대, 동기화 이력(성공/실패), 활성 근거 건수, 비동기 데이터 파기 진행 상태를 단일 DTO로 집계.
 * 토큰, 개인정보(PII), 원본 시트/이메일 내용 등 민감정보를 원천 배제한 안전한 운영 뷰를 제공.
 */
export async function projectConnectorOperationalState(
  workspaceId: string,
  gateway: OperationalProjectionGateway,
  options?: ProjectOperationalStateOptions
): Promise<WorkspaceConnectorsOperationalSummary> {
  if (!workspaceId || typeof workspaceId !== 'string') {
    throw new MarketingConnectorError(
      400,
      'INVALID_WORKSPACE_ID',
      '유효한 작업공간 식별자가 필요합니다.'
    );
  }

  const correlationId = options?.correlationId || randomUUID();
  const generatedAt = options?.now || new Date().toISOString();

  // 병렬 데이터 페치: 허브 스냅샷 및 운영 관련 추가 데이터
  const [hubSnapshot, consentsRes, syncJobsRes, deletionJobsRes, evidenceStatsRes] = await Promise.all([
    loadConnectorHubSnapshot(workspaceId, gateway),
    gateway.getConsents ? gateway.getConsents(workspaceId) : Promise.resolve({ data: null, error: null }),
    gateway.getSyncJobs ? gateway.getSyncJobs(workspaceId) : Promise.resolve({ data: null, error: null }),
    gateway.getDeletionJobs ? gateway.getDeletionJobs(workspaceId) : Promise.resolve({ data: null, error: null }),
    gateway.getEvidenceStats ? gateway.getEvidenceStats(workspaceId) : Promise.resolve({ data: null, error: null }),
  ]);

  // 1. Connection Map 구성
  const connectionMap = new Map<ConnectorId, { status: ConnectorStatus; lastSyncAt: string | null }>();
  for (const conn of hubSnapshot.connections) {
    connectionMap.set(conn.connectorId, {
      status: conn.status,
      lastSyncAt: conn.lastSyncAt,
    });
  }

  // 2. Consent Map 구성 (최신 세대 기준)
  const consentMap = new Map<ConnectorId, { generation: number; status: ConsentOperationalStatus }>();
  if (consentsRes && Array.isArray(consentsRes.data)) {
    for (const item of consentsRes.data) {
      const connId = item.connector_id as ConnectorId;
      const existing = consentMap.get(connId);
      const isHigherGeneration = !existing || item.consent_generation > existing.generation;
      if (isHigherGeneration) {
        const rawStatus = item.status === 'active' ? 'active' : item.status === 'revoked' ? 'revoked' : 'none';
        consentMap.set(connId, {
          generation: item.consent_generation,
          status: rawStatus,
        });
      }
    }
  }

  // 3. Deletion Jobs Map 구성 (최신 작업 기준)
  const deletionMap = new Map<
    ConnectorId,
    { status: DeletionOperationalStatus; jobId: string | null }
  >();
  if (deletionJobsRes && Array.isArray(deletionJobsRes.data)) {
    for (const job of deletionJobsRes.data) {
      const connId = job.connector_id as ConnectorId;
      const rawStatus = job.status;
      const mappedStatus: DeletionOperationalStatus =
        rawStatus === 'pending' ||
        rawStatus === 'running' ||
        rawStatus === 'completed' ||
        rawStatus === 'failed'
          ? rawStatus
          : 'none';

      // pending이나 running이 있으면 우선순위 높게 반영
      const current = deletionMap.get(connId);
      if (!current || mappedStatus === 'pending' || mappedStatus === 'running') {
        deletionMap.set(connId, {
          status: mappedStatus,
          jobId: job.id ?? null,
        });
      }
    }
  }

  // 4. Sync Jobs Map 구성 (성공/실패 시각 및 에러 코드)
  const syncJobStatsMap = new Map<
    ConnectorId,
    {
      lastSuccessAt: string | null;
      lastFailureAt: string | null;
      lastErrorCode: string | null;
    }
  >();
  if (syncJobsRes && Array.isArray(syncJobsRes.data)) {
    for (const job of syncJobsRes.data) {
      const connId = job.connector_id as ConnectorId;
      const current = syncJobStatsMap.get(connId) || {
        lastSuccessAt: null,
        lastFailureAt: null,
        lastErrorCode: null,
      };

      const jobTimestamp = job.updated_at || job.created_at;
      if (job.status === 'completed') {
        if (!current.lastSuccessAt || (jobTimestamp && jobTimestamp > current.lastSuccessAt)) {
          current.lastSuccessAt = jobTimestamp;
        }
      } else if (job.status === 'failed') {
        if (!current.lastFailureAt || (jobTimestamp && jobTimestamp > current.lastFailureAt)) {
          current.lastFailureAt = jobTimestamp;
          current.lastErrorCode = extractSafeErrorCode(job.last_error);
        }
      }
      syncJobStatsMap.set(connId, current);
    }
  }

  // 5. Evidence Counts Map 구성
  const evidenceCountMap = new Map<ConnectorId, number>();
  if (evidenceStatsRes && evidenceStatsRes.data) {
    if (Array.isArray(evidenceStatsRes.data)) {
      for (const item of evidenceStatsRes.data) {
        evidenceCountMap.set(item.connector_id as ConnectorId, item.active_count ?? 0);
      }
    } else if (typeof evidenceStatsRes.data === 'object') {
      for (const [key, val] of Object.entries(evidenceStatsRes.data)) {
        evidenceCountMap.set(key as ConnectorId, typeof val === 'number' ? val : 0);
      }
    }
  }

  // 6. 11개 카탈로그 커넥터 전수에 대해 Operational Summary 투영
  const connectors: Partial<Record<ConnectorId, ConnectorOperationalSummary>> = {};

  for (const catalogItem of CONNECTOR_CATALOG) {
    const connId = catalogItem.id;
    const connInfo = connectionMap.get(connId) || {
      status: 'disconnected' as ConnectorStatus,
      lastSyncAt: null,
    };
    const consentInfo = consentMap.get(connId);
    const deletionInfo = deletionMap.get(connId);
    const syncStats = syncJobStatsMap.get(connId);
    const activeEvidenceCount = evidenceCountMap.get(connId) ?? 0;

    // Operational Status 판정:
    // 1) 삭제 작업이 pending 또는 running 이면 무조건 pending_deletion
    // 2) 그 외에는 raw connection status 투영
    const isPendingDeletion =
      deletionInfo?.status === 'pending' || deletionInfo?.status === 'running';

    let operationalStatus: ConnectorOperationalStatus;
    if (isPendingDeletion) {
      operationalStatus = 'pending_deletion';
    } else {
      operationalStatus = connInfo.status;
    }

    const summary: ConnectorOperationalSummary = {
      connectorId: connId,
      status: operationalStatus,
      rawConnectionStatus: connInfo.status,
      consentGeneration: consentInfo ? consentInfo.generation : null,
      consentStatus: consentInfo ? consentInfo.status : 'none',
      lastSyncAt: connInfo.lastSyncAt || syncStats?.lastSuccessAt || null,
      lastSyncSuccessAt: syncStats?.lastSuccessAt || null,
      lastSyncFailureAt: syncStats?.lastFailureAt || null,
      lastSyncErrorCode: syncStats?.lastErrorCode || null,
      activeEvidenceCount,
      deletionStatus: deletionInfo?.status || 'none',
      deletionJobId: deletionInfo?.jobId || null,
    };

    connectors[connId] = summary;
  }

  return {
    workspaceId,
    connectors: connectors as Record<ConnectorId, ConnectorOperationalSummary>,
    generatedAt,
    correlationId,
  };
}
