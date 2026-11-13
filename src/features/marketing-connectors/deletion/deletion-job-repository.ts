import 'server-only';
import { randomUUID } from 'node:crypto';
import { CONNECTOR_CATALOG, type ConnectorId } from '../catalog';

export type DeletionJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface DeletionJobRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly connectorId: ConnectorId;
  readonly consentGeneration: number;
  readonly status: DeletionJobStatus;
  readonly requestedBy?: string | null;
  readonly encryptedCredentialRef?: string | null;
  readonly attempts: number;
  readonly maxRetries: number;
  readonly lockedBy: string | null;
  readonly leaseExpiresAt: string | null;
  readonly lastError: Record<string, unknown> | null;
  readonly retryAfter: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type DeletionJob = DeletionJobRecord;

export interface DeletionJobGateway {
  insertJob(job: DeletionJobRecord): Promise<void>;
  getJobById(jobId: string): Promise<DeletionJobRecord | null>;
  updateJob(jobId: string, updates: Partial<DeletionJobRecord>): Promise<DeletionJobRecord>;
  claimJob?(workerId: string, leaseDurationSeconds: number, now: string): Promise<DeletionJobRecord | null>;
  listJobs?(filter?: {
    workspaceId?: string;
    connectorId?: ConnectorId;
    status?: DeletionJobStatus;
  }): Promise<readonly DeletionJobRecord[]>;
}

export interface EnqueueDeletionJobParams {
  readonly workspaceId: string;
  readonly connectorId: ConnectorId;
  readonly consentGeneration: number;
  readonly requestedBy?: string | null;
  readonly encryptedCredentialRef?: string | null;
  readonly maxRetries?: number;
  readonly now?: string;
}

export interface EnqueueDeletionJobOptions {
  readonly requestedBy?: string | null;
  readonly encryptedCredentialRef?: string | null;
  readonly maxRetries?: number;
  readonly now?: string;
}

export interface FailDeletionJobOptions {
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly now?: string;
}

const KNOWN_CONNECTOR_IDS = new Set<string>(CONNECTOR_CATALOG.map((c) => c.id));

function isKnownConnectorId(value: unknown): value is ConnectorId {
  return typeof value === 'string' && KNOWN_CONNECTOR_IDS.has(value);
}

function isValidIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return false;
  }
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp);
}

/**
 * 인메모리 DeletionJobGateway 구현체 (단위 테스트 및 로컬 실행용)
 */
export function createInMemoryDeletionJobGateway(): DeletionJobGateway {
  const store = new Map<string, DeletionJobRecord>();

  return {
    async insertJob(job: DeletionJobRecord): Promise<void> {
      store.set(job.id, Object.freeze({ ...job }));
    },

    async getJobById(jobId: string): Promise<DeletionJobRecord | null> {
      const found = store.get(jobId);
      return found ? Object.freeze({ ...found }) : null;
    },

    async updateJob(jobId: string, updates: Partial<DeletionJobRecord>): Promise<DeletionJobRecord> {
      const existing = store.get(jobId);
      if (!existing) {
        throw new Error(`Deletion job not found: ${jobId}`);
      }
      const updated: DeletionJobRecord = Object.freeze({
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
    ): Promise<DeletionJobRecord | null> {
      const nowEpoch = Date.parse(nowIso);

      // 1. 현재 실행 중(running)이며 lease가 유효한 커넥터 식별 (workspaceId:connectorId)
      const activeRunningConnectors = new Set<string>();
      for (const job of Array.from(store.values())) {
        if (job.status === 'running' && job.leaseExpiresAt) {
          const expiresEpoch = Date.parse(job.leaseExpiresAt);
          if (expiresEpoch >= nowEpoch) {
            activeRunningConnectors.add(`${job.workspaceId}:${job.connectorId}`);
          }
        }
      }

      // 2. FIFO 순서로 선점 후보 탐색
      const allJobs = Array.from(store.values()).sort(
        (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
      );

      for (const job of allJobs) {
        const connectorKey = `${job.workspaceId}:${job.connectorId}`;

        const isSelfRunning =
          job.status === 'running' &&
          job.leaseExpiresAt !== null &&
          Date.parse(job.leaseExpiresAt) < nowEpoch;

        if (activeRunningConnectors.has(connectorKey) && !isSelfRunning) {
          continue;
        }

        let isEligible = false;

        if (job.status === 'pending') {
          if (!job.retryAfter || Date.parse(job.retryAfter) <= nowEpoch) {
            isEligible = true;
          }
        } else if (isSelfRunning) {
          isEligible = true;
        }

        if (isEligible) {
          const leaseExpiresAt = new Date(nowEpoch + leaseDurationSeconds * 1000).toISOString();
          const claimed: DeletionJobRecord = Object.freeze({
            ...job,
            status: 'running',
            attempts: job.attempts + 1,
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
      status?: DeletionJobStatus;
    }): Promise<readonly DeletionJobRecord[]> {
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
 * 삭제 작업 등록 (status = 'pending')
 */
export async function enqueueDeletionJob(
  params: EnqueueDeletionJobParams,
  gateway: DeletionJobGateway
): Promise<DeletionJobRecord>;
export async function enqueueDeletionJob(
  workspaceId: string,
  connectorId: ConnectorId,
  consentGeneration: number,
  gateway: DeletionJobGateway,
  options?: EnqueueDeletionJobOptions
): Promise<DeletionJobRecord>;
export async function enqueueDeletionJob(
  paramOrWorkspaceId: EnqueueDeletionJobParams | string,
  gatewayOrConnectorId: DeletionJobGateway | ConnectorId,
  consentGenerationMaybe?: number,
  gatewayMaybe?: DeletionJobGateway,
  optionsMaybe?: EnqueueDeletionJobOptions
): Promise<DeletionJobRecord> {
  let workspaceId: string;
  let connectorId: ConnectorId;
  let consentGeneration: number;
  let requestedBy: string | null = null;
  let encryptedCredentialRef: string | null = null;
  let maxRetries = 5;
  let now: string | undefined;
  let gateway: DeletionJobGateway;

  if (typeof paramOrWorkspaceId === 'object' && paramOrWorkspaceId !== null) {
    workspaceId = paramOrWorkspaceId.workspaceId;
    connectorId = paramOrWorkspaceId.connectorId;
    consentGeneration = paramOrWorkspaceId.consentGeneration;
    requestedBy = paramOrWorkspaceId.requestedBy ?? null;
    encryptedCredentialRef = paramOrWorkspaceId.encryptedCredentialRef ?? null;
    maxRetries = paramOrWorkspaceId.maxRetries ?? 5;
    now = paramOrWorkspaceId.now;
    gateway = gatewayOrConnectorId as DeletionJobGateway;
  } else {
    workspaceId = paramOrWorkspaceId;
    connectorId = gatewayOrConnectorId as ConnectorId;
    consentGeneration = consentGenerationMaybe!;
    gateway = gatewayMaybe!;
    if (optionsMaybe) {
      requestedBy = optionsMaybe.requestedBy ?? null;
      encryptedCredentialRef = optionsMaybe.encryptedCredentialRef ?? null;
      maxRetries = optionsMaybe.maxRetries ?? 5;
      now = optionsMaybe.now;
    }
  }

  if (!workspaceId || typeof workspaceId !== 'string' || workspaceId.trim().length === 0) {
    throw new Error('Invalid workspaceId');
  }

  if (!isKnownConnectorId(connectorId)) {
    throw new Error(`Invalid connectorId: ${String(connectorId)}`);
  }

  if (
    typeof consentGeneration !== 'number' ||
    !Number.isInteger(consentGeneration) ||
    consentGeneration <= 0
  ) {
    throw new Error('Invalid consentGeneration');
  }

  const effectiveNowIso = now ?? new Date().toISOString();
  if (!isValidIsoTimestamp(effectiveNowIso)) {
    throw new Error('Invalid now timestamp');
  }

  const job: DeletionJobRecord = Object.freeze({
    id: randomUUID(),
    workspaceId,
    connectorId,
    consentGeneration,
    status: 'pending',
    requestedBy,
    encryptedCredentialRef,
    attempts: 0,
    maxRetries,
    lockedBy: null,
    leaseExpiresAt: null,
    lastError: null,
    retryAfter: null,
    createdAt: effectiveNowIso,
    updatedAt: effectiveNowIso,
  });

  await gateway.insertJob(job);
  return job;
}

/**
 * 삭제 작업 선점 (15분 lease lock 기본값)
 */
export async function claimDeletionJob(
  workerId: string,
  leaseDurationSeconds = 900,
  gateway: DeletionJobGateway,
  now?: string
): Promise<DeletionJobRecord | null> {
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
 * 삭제 작업 완료 (status = 'completed')
 */
export async function completeDeletionJob(
  jobId: string,
  gateway: DeletionJobGateway,
  options?: { now?: string }
): Promise<DeletionJobRecord> {
  if (!jobId || typeof jobId !== 'string') {
    throw new Error('Invalid jobId');
  }

  const existing = await gateway.getJobById(jobId);
  if (!existing) {
    throw new Error(`Deletion job not found: ${jobId}`);
  }

  const effectiveNowIso = options?.now ?? new Date().toISOString();
  if (!isValidIsoTimestamp(effectiveNowIso)) {
    throw new Error('Invalid now timestamp');
  }

  const updates: Partial<DeletionJobRecord> = {
    status: 'completed',
    lockedBy: null,
    leaseExpiresAt: null,
    updatedAt: effectiveNowIso,
  };

  return gateway.updateJob(jobId, updates);
}

/**
 * 삭제 작업 실패 및 재시도 백오프 설정 (status = 'pending' or 'failed')
 */
export async function failDeletionJob(
  jobId: string,
  error: unknown,
  gateway: DeletionJobGateway,
  options?: FailDeletionJobOptions
): Promise<DeletionJobRecord> {
  if (!jobId || typeof jobId !== 'string') {
    throw new Error('Invalid jobId');
  }

  const existing = await gateway.getJobById(jobId);
  if (!existing) {
    throw new Error(`Deletion job not found: ${jobId}`);
  }

  const effectiveNowIso = options?.now ?? new Date().toISOString();
  if (!isValidIsoTimestamp(effectiveNowIso)) {
    throw new Error('Invalid now timestamp');
  }

  const currentAttempts = existing.attempts;
  const isPermanentlyFailed = currentAttempts >= existing.maxRetries;

  let lastErrorRecord: Record<string, unknown>;
  if (error instanceof Error) {
    lastErrorRecord = {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  } else if (typeof error === 'object' && error !== null) {
    lastErrorRecord = { ...error as Record<string, unknown> };
  } else {
    lastErrorRecord = { message: String(error) };
  }

  let retryAfterIso: string | null = null;
  if (!isPermanentlyFailed) {
    const baseDelayMs = options?.baseDelayMs ?? 2000;
    const maxDelayMs = options?.maxDelayMs ?? 300000;
    const delayMs = Math.min(
      baseDelayMs * Math.pow(2, Math.max(0, currentAttempts - 1)),
      maxDelayMs
    );
    const nowEpoch = Date.parse(effectiveNowIso);
    retryAfterIso = new Date(nowEpoch + delayMs).toISOString();
  }

  const updates: Partial<DeletionJobRecord> = {
    status: isPermanentlyFailed ? 'failed' : 'pending',
    lockedBy: null,
    leaseExpiresAt: null,
    lastError: Object.freeze(lastErrorRecord),
    retryAfter: retryAfterIso,
    updatedAt: effectiveNowIso,
  };

  return gateway.updateJob(jobId, updates);
}
