import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SyncEngine,
  type SyncHandler,
  type SyncExecutionResult,
} from './sync-engine';
import {
  createInMemorySyncJobGateway,
  enqueueSyncJob,
  type SyncJobGateway,
  type SyncJobRecord,
} from './sync-job-repository';
import type {
  ConsentLedgerGateway,
  MarketingConsentRecord,
} from '../consent/consent-ledger';

describe('SyncEngine (ANI-2152 / F05)', () => {
  let syncGateway: SyncJobGateway;
  let consentGateway: ConsentLedgerGateway;
  let engine: SyncEngine;
  const fixedNow = '2026-11-11T12:00:00.000Z';
  const workerId = 'worker-engine-1';

  beforeEach(() => {
    syncGateway = createInMemorySyncJobGateway();

    let storedConsent: MarketingConsentRecord | null = {
      workspaceId: 'ws-test',
      connectorId: 'google_calendar',
      consentGeneration: 1,
      allowedSourceIds: ['cal-primary'],
      purpose: 'marketing',
      validUntil: '2026-11-20T00:00:00.000Z',
      aiProcessingApproved: true,
      status: 'active',
      updatedAt: fixedNow,
      updatedBy: 'user-admin',
    };

    consentGateway = {
      async getLatestConsent(workspaceId, connectorId) {
        if (
          storedConsent &&
          storedConsent.workspaceId === workspaceId &&
          storedConsent.connectorId === connectorId
        ) {
          return storedConsent;
        }
        return null;
      },
      async saveConsentRecord(record) {
        storedConsent = record;
      },
    };

    engine = new SyncEngine({
      syncGateway,
      consentGateway,
      workerId,
      leaseDurationSeconds: 900,
      now: () => fixedNow,
    });
  });

  it('작업을 선점하고 정상적으로 동기화 핸들러를 실행한 뒤 완료(completed) 처리한다', async () => {
    const job = await enqueueSyncJob(
      {
        workspaceId: 'ws-test',
        connectorId: 'google_calendar',
        sourceId: 'cal-primary',
        consentGeneration: 1,
        now: fixedNow,
      },
      syncGateway,
    );

    const handler: SyncHandler = {
      async execute(j: SyncJobRecord): Promise<SyncExecutionResult> {
        expect(j.id).toBe(job.id);
        return {
          stats: { syncedEvents: 5 },
          nextSyncToken: 'token_google_v1',
          cursor: 'cur_123',
        };
      },
    };

    engine.registerHandler('google_calendar', handler);

    const result = await engine.runSyncCycle();
    expect(result.processed).toBe(true);
    expect(result.jobId).toBe(job.id);
    expect(result.status).toBe('completed');
    expect(result.stats).toEqual({ syncedEvents: 5 });

    const inDb = await syncGateway.getJobById(job.id);
    expect(inDb?.status).toBe('completed');
    expect(inDb?.nextSyncToken).toBe('token_google_v1');
    expect(inDb?.cursor).toBe('cur_123');
    expect(inDb?.stats).toEqual({ syncedEvents: 5 });
  });

  it('선점 가능한 작업이 없으면 processed=false를 반환한다', async () => {
    const result = await engine.runSyncCycle();
    expect(result.processed).toBe(false);
  });

  it('동의가 철회된 경우(consent status=revoked) 핸들러를 호출하지 않고 작업을 cancelled 처리한다', async () => {
    // 동의 철회 상태로 설정
    await consentGateway.saveConsentRecord({
      workspaceId: 'ws-test',
      connectorId: 'google_calendar',
      consentGeneration: 2,
      allowedSourceIds: [],
      purpose: 'marketing',
      validUntil: fixedNow,
      aiProcessingApproved: false,
      status: 'revoked',
      updatedAt: fixedNow,
      updatedBy: 'user-admin',
    });

    const job = await enqueueSyncJob(
      {
        workspaceId: 'ws-test',
        connectorId: 'google_calendar',
        sourceId: 'cal-primary',
        consentGeneration: 1,
        now: fixedNow,
      },
      syncGateway,
    );

    const handlerSpy = vi.fn();
    engine.registerHandler('google_calendar', { execute: handlerSpy });

    const result = await engine.runSyncCycle();

    expect(result.processed).toBe(true);
    expect(result.status).toBe('cancelled');
    expect(handlerSpy).not.toHaveBeenCalled();

    const inDb = await syncGateway.getJobById(job.id);
    expect(inDb?.status).toBe('cancelled');
  });

  it('핸들러 실행 중 429 발생 시 failSyncJob을 통해 retryAfter를 설정하고 pending으로 유지한다', async () => {
    const job = await enqueueSyncJob(
      {
        workspaceId: 'ws-test',
        connectorId: 'google_calendar',
        sourceId: 'cal-primary',
        consentGeneration: 1,
        now: fixedNow,
      },
      syncGateway,
    );

    const rateLimitError = {
      statusCode: 429,
      message: 'Google Calendar API rate limit exceeded',
      retryAfter: 60,
    };

    engine.registerHandler('google_calendar', {
      async execute() {
        throw rateLimitError;
      },
    });

    const result = await engine.runSyncCycle();
    expect(result.processed).toBe(true);
    expect(result.status).toBe('pending');
    expect(result.error).toBeDefined();

    const inDb = await syncGateway.getJobById(job.id);
    expect(inDb?.status).toBe('pending');
    expect(inDb?.attempts).toBe(1);
    expect(inDb?.retryAfter).toBe(new Date(Date.parse(fixedNow) + 60 * 1000).toISOString());
  });

  it('heartbeat / lease 연장(renewLease)을 수행한다', async () => {
    const job = await enqueueSyncJob(
      {
        workspaceId: 'ws-test',
        connectorId: 'google_calendar',
        sourceId: 'cal-primary',
        consentGeneration: 1,
        now: fixedNow,
      },
      syncGateway,
    );

    // claim
    await syncGateway.claimJob?.(workerId, 900, fixedNow);

    // 100초 후 15분 추가 연장
    const renewNow = new Date(Date.parse(fixedNow) + 100 * 1000).toISOString();
    const renewed = await engine.renewJobLease(job.id, 900, renewNow);

    const expectedExpiry = new Date(Date.parse(renewNow) + 900 * 1000).toISOString();
    expect(renewed.leaseExpiresAt).toBe(expectedExpiry);
  });
});
