import 'server-only';
import { randomUUID } from 'node:crypto';
import type { ConnectorId } from '../catalog';

export type SyncJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface SyncJobRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly connectorId: ConnectorId;
  readonly sourceId: string;
  readonly consentGeneration: number;
  readonly status: SyncJobStatus;
  readonly attempts: number;
  readonly maxRetries: number;
  readonly lockedBy: string | null;
  readonly leaseExpiresAt: string | null;
  readonly cursor: string | null;
  readonly nextSyncToken: string | null;
  readonly stats: Record<string, unknown>;
  readonly lastError: Record<string, unknown> | null;
  readonly retryAfter: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SyncJobGateway {
  insertJob(job: SyncJobRecord): Promise<void>;
  getJobById(jobId: string): Promise<SyncJobRecord | null>;
  updateJob(jobId: string, updates: Partial<SyncJobRecord>): Promise<SyncJobRecord>;
  claimJob?(workerId: string, leaseDurationSeconds: number, now: string): Promise<SyncJobRecord | null>;
  listJobs?(filter?: {
    workspaceId?: string;
    connectorId?: ConnectorId;
    status?: SyncJobStatus;
  }): Promise<readonly SyncJobRecord[]>;
}

export interface EnqueueSyncJobParams {
  readonly workspaceId: string;
  readonly connectorId: ConnectorId;
  readonly sourceId: string;
  readonly consentGeneration: number;
  readonly cursor?: string | null;
  readonly maxRetries?: number;
  readonly now?: string;
}

export interface EnqueueSyncJobOptions {
  readonly cursor?: string | null;
  readonly maxRetries?: number;
  readonly now?: string;
}

export interface CompleteSyncJobOptions {
  readonly nextSyncToken?: string | null;
  readonly cursor?: string | null;
  readonly now?: string;
}

export interface FailSyncJobOptions {
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly isConsentRevoked?: boolean;
  readonly now?: string;
}

function isValidIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return false;
  }
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp);
}

/**
 * 인메모리 SyncJobGateway 구현체 (단위 테스트 및 로컬 에뮬레이션용)
 */
export function createInMemorySyncJobGateway(): SyncJobGateway {
  const store = new Map<string, SyncJobRecord>();

  return {
    async insertJob(job: SyncJobRecord): Promise<void> {
      store.set(job.id, Object.freeze({ ...job }));
    },

    async getJobById(jobId: string): Promise<SyncJobRecord | null> {
      const found = store.get(jobId);
      return found ? Object.freeze({ ...found }) : null;
    },

    async updateJob(jobId: string, updates: Partial<SyncJobRecord>): Promise<SyncJobRecord> {
      const existing = store.get(jobId);
      if (!existing) {
        throw new Error(`Sync job not found: ${jobId}`);
      }
      const updated: SyncJobRecord = Object.freeze({
        ...existing,
        ...updates,
      });
      store.set(jobId, updated);
      return updated;
    },

    async claimJob(
      workerId: string,
      leaseDurationSeconds: number,
      nowIso: string,
    ): Promise<SyncJobRecord | null> {
      const nowEpoch = Date.parse(nowIso);

      // 1. 현재 실행 중(running)이며 lease가 유효한 커넥터 집합(workspaceId:connectorId) 수집
      const activeRunningConnectors = new Set<string>();
      for (const job of Array.from(store.values())) {
        if (job.status === 'running' && job.leaseExpiresAt) {
          const expiresEpoch = Date.parse(job.leaseExpiresAt);
          if (expiresEpoch >= nowEpoch) {
            activeRunningConnectors.add(`${job.workspaceId}:${job.connectorId}`);
          }
        }
      }

      // 2. 선점 가능한 후보 작업 탐색 (FIFO order: createdAt 기준)
      const allJobs = Array.from(store.values()).sort(
        (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
      );

      for (const job of allJobs) {
        const connectorKey = `${job.workspaceId}:${job.connectorId}`;

        // 이미 동일 커넥터에 유효한 running 작업이 있으면 건너뜀 (단, 본인 작업의 lease 만료는 허용)
        const isSelfRunning =
          job.status === 'running' &&
          job.leaseExpiresAt !== null &&
          Date.parse(job.leaseExpiresAt) < nowEpoch;

        if (activeRunningConnectors.has(connectorKey) && !isSelfRunning) {
          continue;
        }

        let isEligible = false;

        // Pending 상태: retryAfter가 없거나 경과한 경우
        if (job.status === 'pending') {
          if (!job.retryAfter || Date.parse(job.retryAfter) <= nowEpoch) {
            isEligible = true;
          }
        } else if (isSelfRunning) {
          // Running 상태: lease가 이미 만료된 경우
          isEligible = true;
        }

        if (isEligible) {
          const leaseExpiresAt = new Date(nowEpoch + leaseDurationSeconds * 1000).toISOString();
          const claimed: SyncJobRecord = Object.freeze({
            ...job,
            status: 'running',
            lockedBy: workerId,
            leaseExpiresAt,
            updatedAt: nowIso,
          });
          store.set(job.id, claimed);
          return claimed;
        }
      }

      return null;
    },

    async listJobs(filter?: {
      workspaceId?: string;
      connectorId?: ConnectorId;
      status?: SyncJobStatus;
    }): Promise<readonly SyncJobRecord[]> {
      let result = Array.from(store.values());
      if (filter?.workspaceId) {
        result = result.filter((j) => j.workspaceId === filter.workspaceId);
      }
      if (filter?.connectorId) {
        result = result.filter((j) => j.connectorId === filter.connectorId);
      }
      if (filter?.status) {
        result = result.filter((j) => j.status === filter.status);
      }
      return Object.freeze(result.map((j) => Object.freeze({ ...j })));
    },
  };
}

/**
 * 큐에 신규 동기화 작업을 등록한다. (상태: pending)
 */
export async function enqueueSyncJob(
  params: EnqueueSyncJobParams,
  gateway: SyncJobGateway,
): Promise<SyncJobRecord>;
export async function enqueueSyncJob(
  workspaceId: string,
  connectorId: ConnectorId,
  sourceId: string,
  consentGeneration: number,
  gateway: SyncJobGateway,
  options?: EnqueueSyncJobOptions,
): Promise<SyncJobRecord>;
export async function enqueueSyncJob(
  paramOrWorkspaceId: EnqueueSyncJobParams | string,
  gatewayOrConnectorId: SyncJobGateway | ConnectorId,
  sourceIdMaybe?: string,
  consentGenerationMaybe?: number,
  gatewayMaybe?: SyncJobGateway,
  optionsMaybe?: EnqueueSyncJobOptions,
): Promise<SyncJobRecord> {
  let workspaceId: string;
  let connectorId: ConnectorId;
  let sourceId: string;
  let consentGeneration: number;
  let cursor: string | null = null;
  let maxRetries = 5;
  let now: string | undefined;
  let gateway: SyncJobGateway;

  if (typeof paramOrWorkspaceId === 'object' && paramOrWorkspaceId !== null) {
    workspaceId = paramOrWorkspaceId.workspaceId;
    connectorId = paramOrWorkspaceId.connectorId;
    sourceId = paramOrWorkspaceId.sourceId;
    consentGeneration = paramOrWorkspaceId.consentGeneration;
    cursor = paramOrWorkspaceId.cursor ?? null;
    maxRetries = paramOrWorkspaceId.maxRetries ?? 5;
    now = paramOrWorkspaceId.now;
    gateway = gatewayOrConnectorId as SyncJobGateway;
  } else if (typeof paramOrWorkspaceId === 'string') {
    workspaceId = paramOrWorkspaceId;
    connectorId = gatewayOrConnectorId as ConnectorId;
    sourceId = sourceIdMaybe as string;
    consentGeneration = consentGenerationMaybe as number;
    gateway = gatewayMaybe as SyncJobGateway;
    cursor = optionsMaybe?.cursor ?? null;
    maxRetries = optionsMaybe?.maxRetries ?? 5;
    now = optionsMaybe?.now;
  } else {
    throw new Error('Invalid workspaceId');
  }

  if (!workspaceId || typeof workspaceId !== 'string' || workspaceId.trim().length === 0) {
    throw new Error('Invalid workspaceId');
  }
  if (!connectorId || typeof connectorId !== 'string') {
    throw new Error('Invalid connectorId');
  }
  if (!sourceId || typeof sourceId !== 'string' || sourceId.trim().length === 0) {
    throw new Error('Invalid sourceId');
  }
  if (
    typeof consentGeneration !== 'number' ||
    consentGeneration < 1 ||
    !Number.isInteger(consentGeneration)
  ) {
    throw new Error('Invalid consentGeneration');
  }

  const effectiveNowIso = now ?? new Date().toISOString();
  if (!isValidIsoTimestamp(effectiveNowIso)) {
    throw new Error('Invalid now timestamp');
  }

  const job: SyncJobRecord = Object.freeze({
    id: randomUUID(),
    workspaceId,
    connectorId,
    sourceId,
    consentGeneration,
    status: 'pending',
    attempts: 0,
    maxRetries,
    lockedBy: null,
    leaseExpiresAt: null,
    cursor,
    nextSyncToken: null,
    stats: Object.freeze({}),
    lastError: null,
    retryAfter: null,
    createdAt: effectiveNowIso,
    updatedAt: effectiveNowIso,
  });

  await gateway.insertJob(job);
  return job;
}

/**
 * 작업을 15분 lease lock으로 선점(claim)한다.
 * status = 'pending' OR (status = 'running' AND lease_expires_at < now)
 * 동일 커넥터에 대해 유효한 running 작업이 있으면 동시 다중 수집을 방어한다.
 */
export async function claimSyncJob(
  workerId: string,
  leaseDurationSeconds = 900,
  gateway: SyncJobGateway,
  now?: string,
): Promise<SyncJobRecord | null> {
  if (!workerId || typeof workerId !== 'string' || workerId.trim().length === 0) {
    throw new Error('Invalid workerId');
  }

  const effectiveNowIso = now ?? new Date().toISOString();
  if (!isValidIsoTimestamp(effectiveNowIso)) {
    throw new Error('Invalid now timestamp');
  }

  if (gateway.claimJob) {
    return gateway.claimJob(workerId, leaseDurationSeconds, effectiveNowIso);
  }

  throw new Error('Gateway does not support claimJob');
}

/**
 * 작업 성공 시 상태를 completed로 갱신하고 cursor/nextSyncToken을 보존한다.
 */
export async function completeSyncJob(
  jobId: string,
  stats: Record<string, unknown>,
  gateway: SyncJobGateway,
  options?: CompleteSyncJobOptions,
): Promise<SyncJobRecord> {
  if (!jobId || typeof jobId !== 'string') {
    throw new Error('Invalid jobId');
  }

  const existing = await gateway.getJobById(jobId);
  if (!existing) {
    throw new Error(`Sync job not found: ${jobId}`);
  }

  const effectiveNowIso = options?.now ?? new Date().toISOString();
  if (!isValidIsoTimestamp(effectiveNowIso)) {
    throw new Error('Invalid now timestamp');
  }

  const updates: Partial<Record<keyof SyncJobRecord, unknown>> = {
    status: 'completed',
    stats: Object.freeze({ ...stats }),
    lockedBy: null,
    leaseExpiresAt: null,
    updatedAt: effectiveNowIso,
    ...(options?.nextSyncToken !== undefined ? { nextSyncToken: options.nextSyncToken } : {}),
    ...(options?.cursor !== undefined ? { cursor: options.cursor } : {}),
  };

  return gateway.updateJob(jobId, updates as Partial<SyncJobRecord>);
}

interface ErrorDetails {
  message: string;
  statusCode?: number;
  retryAfter?: number;
  code?: string;
  [key: string]: unknown;
}

function extractErrorDetails(error: unknown): ErrorDetails {
  if (error instanceof Error) {
    const details: ErrorDetails = {
      message: error.message,
    };
    const anyErr = error as unknown as Record<string, unknown>;
    if (typeof anyErr.statusCode === 'number') {
      details.statusCode = anyErr.statusCode;
    } else if (typeof anyErr.status === 'number') {
      details.statusCode = anyErr.status;
    }
    if (typeof anyErr.retryAfter === 'number') {
      details.retryAfter = anyErr.retryAfter;
    }
    if (typeof anyErr.code === 'string') {
      details.code = anyErr.code;
    }
    return details;
  }

  if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>;
    const details: ErrorDetails = {
      message: typeof obj.message === 'string' ? obj.message : 'Unknown error',
    };
    if (typeof obj.statusCode === 'number') {
      details.statusCode = obj.statusCode;
    } else if (typeof obj.status === 'number') {
      details.statusCode = obj.status;
    }
    if (typeof obj.retryAfter === 'number') {
      details.retryAfter = obj.retryAfter;
    }
    if (typeof obj.code === 'string') {
      details.code = obj.code;
    }
    return details;
  }

  return {
    message: String(error),
  };
}

/**
 * 작업 실패 시 에러 종류를 판별하여
 * - 동의 철회 시 즉시 cancelled 처리
 * - 429 Retry-After 또는 지수 백오프 계산
 * - maxRetries 초과 시 failed 처리
 */
export async function failSyncJob(
  jobId: string,
  error: unknown,
  gateway: SyncJobGateway,
  options?: FailSyncJobOptions,
): Promise<SyncJobRecord> {
  if (!jobId || typeof jobId !== 'string') {
    throw new Error('Invalid jobId');
  }

  const existing = await gateway.getJobById(jobId);
  if (!existing) {
    throw new Error(`Sync job not found: ${jobId}`);
  }

  const effectiveNowIso = options?.now ?? new Date().toISOString();
  if (!isValidIsoTimestamp(effectiveNowIso)) {
    throw new Error('Invalid now timestamp');
  }
  const nowEpoch = Date.parse(effectiveNowIso);

  const errorDetails = extractErrorDetails(error);

  // 동의 철회 확인 시 즉시 cancelled
  const isConsentRevoked =
    options?.isConsentRevoked === true ||
    errorDetails.code === 'CONSENT_REVOKED' ||
    errorDetails.code === 'EXPIRED_CONSENT' ||
    errorDetails.message.includes('CONSENT_REVOKED') ||
    errorDetails.message.toLowerCase().includes('consent has been revoked');

  if (isConsentRevoked) {
    return gateway.updateJob(jobId, {
      status: 'cancelled',
      lockedBy: null,
      leaseExpiresAt: null,
      retryAfter: null,
      lastError: Object.freeze(errorDetails),
      updatedAt: effectiveNowIso,
    });
  }

  const nextAttempts = existing.attempts + 1;
  const isMaxRetriesExceeded = nextAttempts >= existing.maxRetries;

  if (isMaxRetriesExceeded) {
    return gateway.updateJob(jobId, {
      status: 'failed',
      attempts: nextAttempts,
      lockedBy: null,
      leaseExpiresAt: null,
      retryAfter: null,
      lastError: Object.freeze(errorDetails),
      updatedAt: effectiveNowIso,
    });
  }

  // 백오프 계산
  let backoffMs: number;
  if (typeof errorDetails.retryAfter === 'number' && errorDetails.retryAfter > 0) {
    // 429 또는 명시적 Retry-After (초 단위)
    backoffMs = errorDetails.retryAfter * 1000;
  } else {
    // 지수 백오프: baseDelay * 2^(attempts-1) (초기 0회 실패 후 1회차는 2^0 = 1 * baseDelay)
    const baseDelayMs = options?.baseDelayMs ?? 1000;
    const maxDelayMs = options?.maxDelayMs ?? 300000; // 최대 5분
    const exponent = Math.max(0, existing.attempts);
    backoffMs = Math.min(baseDelayMs * Math.pow(2, exponent), maxDelayMs);
  }

  const retryAfterIso = new Date(nowEpoch + backoffMs).toISOString();

  return gateway.updateJob(jobId, {
    status: 'pending',
    attempts: nextAttempts,
    lockedBy: null,
    leaseExpiresAt: null,
    retryAfter: retryAfterIso,
    lastError: Object.freeze(errorDetails),
    updatedAt: effectiveNowIso,
  });
}
