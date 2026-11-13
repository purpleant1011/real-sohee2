import 'server-only';
import type { ConnectorId } from '../catalog';
import {
  claimSyncJob,
  completeSyncJob,
  failSyncJob,
  type SyncJobGateway,
  type SyncJobRecord,
  type SyncJobStatus,
} from './sync-job-repository';
import {
  verifySourceAccess,
  type ConsentLedgerGateway,
} from '../consent/consent-ledger';

export interface SyncExecutionResult {
  readonly stats: Record<string, unknown>;
  readonly nextSyncToken?: string | null;
  readonly cursor?: string | null;
}

export interface SyncHandler {
  execute(job: SyncJobRecord): Promise<SyncExecutionResult>;
}

export interface SyncCycleResult {
  readonly processed: boolean;
  readonly jobId?: string;
  readonly status?: SyncJobStatus;
  readonly stats?: Record<string, unknown>;
  readonly error?: unknown;
}

export interface SyncEngineOptions {
  readonly syncGateway: SyncJobGateway;
  readonly consentGateway?: ConsentLedgerGateway;
  readonly workerId: string;
  readonly leaseDurationSeconds?: number;
  readonly now?: () => string;
}

export class SyncEngine {
  private readonly syncGateway: SyncJobGateway;
  private readonly consentGateway?: ConsentLedgerGateway;
  private readonly workerId: string;
  private readonly leaseDurationSeconds: number;
  private readonly nowProvider: () => string;
  private readonly handlers = new Map<ConnectorId, SyncHandler>();

  constructor(options: SyncEngineOptions) {
    this.syncGateway = options.syncGateway;
    this.consentGateway = options.consentGateway;
    this.workerId = options.workerId;
    this.leaseDurationSeconds = options.leaseDurationSeconds ?? 900;
    this.nowProvider = options.now ?? (() => new Date().toISOString());
  }

  registerHandler(connectorId: ConnectorId, handler: SyncHandler): void {
    this.handlers.set(connectorId, handler);
  }

  /**
   * 큐에서 작업을 1개 선점하여 동의 상태를 검증한 후 동기화 핸들러를 실행한다.
   */
  async runSyncCycle(): Promise<SyncCycleResult> {
    const nowIso = this.nowProvider();

    // 1. 작업 claim (15분 lease lock)
    const claimed = await claimSyncJob(
      this.workerId,
      this.leaseDurationSeconds,
      this.syncGateway,
      nowIso,
    );

    if (!claimed) {
      return { processed: false };
    }

    try {
      // 2. 동의 상태 검증 (ConsentLedgerGateway가 주입된 경우)
      if (this.consentGateway) {
        const consentCheck = await verifySourceAccess(
          {
            workspaceId: claimed.workspaceId,
            connectorId: claimed.connectorId,
            sourceId: claimed.sourceId,
            purpose: 'marketing',
            now: nowIso,
          },
          this.consentGateway,
        );

        if (!consentCheck.ok) {
          const denialCode = 'code' in consentCheck ? consentCheck.code : 'ACCESS_DENIED';
          const denialReason = 'reason' in consentCheck ? consentCheck.reason : 'Access denied';
          const cancelled = await failSyncJob(
            claimed.id,
            {
              code: denialCode,
              message: denialReason,
            },
            this.syncGateway,
            { isConsentRevoked: true, now: nowIso },
          );

          return {
            processed: true,
            jobId: claimed.id,
            status: cancelled.status,
            error: denialReason,
          };
        }
      }

      // 3. 커넥터 핸들러 실행
      const handler = this.handlers.get(claimed.connectorId);
      if (!handler) {
        throw new Error(`No sync handler registered for connector: ${claimed.connectorId}`);
      }

      const executionResult = await handler.execute(claimed);

      // 4. 완료 처리
      const completed = await completeSyncJob(
        claimed.id,
        executionResult.stats,
        this.syncGateway,
        {
          nextSyncToken: executionResult.nextSyncToken,
          cursor: executionResult.cursor,
          now: nowIso,
        },
      );

      return {
        processed: true,
        jobId: claimed.id,
        status: completed.status,
        stats: executionResult.stats,
      };
    } catch (error) {
      // 5. 실패 처리 (429, 지수 백오프, 최대 재시도)
      const failed = await failSyncJob(claimed.id, error, this.syncGateway, {
        now: nowIso,
      });

      return {
        processed: true,
        jobId: claimed.id,
        status: failed.status,
        error,
      };
    }
  }

  /**
   * 장시간 수행 중인 작업의 lease lock을 연장한다 (Heartbeat).
   */
  async renewJobLease(
    jobId: string,
    leaseDurationSeconds: number = this.leaseDurationSeconds,
    now?: string,
  ): Promise<SyncJobRecord> {
    const existing = await this.syncGateway.getJobById(jobId);
    if (!existing) {
      throw new Error(`Sync job not found: ${jobId}`);
    }

    if (existing.lockedBy !== this.workerId) {
      throw new Error(
        `Cannot renew lease: job is locked by ${existing.lockedBy}, not ${this.workerId}`,
      );
    }

    if (existing.status !== 'running') {
      throw new Error(`Cannot renew lease: job status is ${existing.status}, not running`);
    }

    const effectiveNowIso = now ?? this.nowProvider();
    const nowEpoch = Date.parse(effectiveNowIso);
    const leaseExpiresAt = new Date(nowEpoch + leaseDurationSeconds * 1000).toISOString();

    return this.syncGateway.updateJob(jobId, {
      leaseExpiresAt,
      updatedAt: effectiveNowIso,
    });
  }
}
