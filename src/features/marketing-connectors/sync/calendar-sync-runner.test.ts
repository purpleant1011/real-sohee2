import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConnectorId } from '../catalog';
import {
  GoogleCalendarSyncHandler,
  ConsentAccessDeniedError,
} from './calendar-sync-runner';
import type { SyncJobRecord } from './sync-job-repository';
import { createInMemorySyncJobGateway, enqueueSyncJob } from './sync-job-repository';
import { SyncEngine } from './sync-engine';
import {
  saveConnectorCredential,
  type CredentialVaultGateway,
  type StoredCredentialRecord,
  type EncryptedToken,
} from '../credentials/credential-vault';
import type {
  ConsentLedgerGateway,
  MarketingConsentRecord,
} from '../consent/consent-ledger';
import {
  createInMemoryEvidenceGateway,
  type EvidenceGateway,
} from '../evidence/evidence-repository';
import type { CalendarEventsData, FetchCalendarEventsInput } from '../adapters/google-calendar';
import type { GoogleAdapterResult } from '../adapters/google-adapter-common';

// 32-byte valid Base64 test key (AES-256)
const TEST_KEY_BASE64 = 'k7L3yq0Q1f7Z_8P0N4m3vL6R1t9X2w4Z6A8c0E2G4I4';

class InMemoryVaultGateway implements CredentialVaultGateway {
  private store = new Map<string, StoredCredentialRecord>();

  async getCredential(workspaceId: string, connectorId: ConnectorId): Promise<StoredCredentialRecord | null> {
    const item = this.store.get(`${workspaceId}:${connectorId}`);
    return item ? { ...item } : null;
  }

  async saveCredential(record: StoredCredentialRecord): Promise<void> {
    this.store.set(`${record.workspaceId}:${record.connectorId}`, { ...record });
  }

  async updateCredentialTokens(params: {
    workspaceId: string;
    connectorId: ConnectorId;
    encryptedAccessToken: EncryptedToken;
    encryptedRefreshToken: EncryptedToken | null;
    expiresAt: string | null;
    updatedAt: string;
  }): Promise<void> {
    const key = `${params.workspaceId}:${params.connectorId}`;
    const existing = this.store.get(key);
    if (existing) {
      this.store.set(key, {
        ...existing,
        encryptedAccessToken: params.encryptedAccessToken,
        encryptedRefreshToken: params.encryptedRefreshToken,
        expiresAt: params.expiresAt,
        updatedAt: params.updatedAt,
      });
    }
  }
}

describe('GoogleCalendarSyncHandler (MC/G03 - ANI-2158)', () => {
  const fixedNow = '2026-11-11T12:00:00.000Z';
  const workspaceId = 'ws-test-123';
  const calendarId = 'business-cal-1';
  const consentGeneration = 1;

  let vaultGateway: CredentialVaultGateway;
  let consentGateway: ConsentLedgerGateway;
  let evidenceGateway: EvidenceGateway;
  let storedConsent: MarketingConsentRecord | null;

  beforeEach(async () => {
    vaultGateway = new InMemoryVaultGateway();
    evidenceGateway = createInMemoryEvidenceGateway();

    // F03 Vault에 유효한 access_token 저장
    await saveConnectorCredential(
      {
        workspaceId,
        connectorId: 'google_calendar',
        consentGeneration,
        accessToken: 'ya29.valid-test-access-token',
        refreshToken: 'refresh-test-token',
        expiresAt: '2026-12-01T00:00:00.000Z',
        grantedScopes: ['https://www.googleapis.com/auth/calendar.events.readonly'],
        keyBase64: TEST_KEY_BASE64,
      },
      vaultGateway,
    );

    // F04 동의 원장 기본 상태 설정
    storedConsent = {
      workspaceId,
      connectorId: 'google_calendar',
      consentGeneration,
      allowedSourceIds: [calendarId],
      purpose: 'marketing',
      validUntil: '2026-11-30T00:00:00.000Z',
      aiProcessingApproved: true,
      status: 'active',
      updatedAt: fixedNow,
      updatedBy: 'user-owner',
    };

    consentGateway = {
      async getLatestConsent(ws, conn) {
        if (storedConsent && storedConsent.workspaceId === ws && storedConsent.connectorId === conn) {
          return storedConsent;
        }
        return null;
      },
      async saveConsentRecord(record) {
        storedConsent = record;
      },
    };
  });

  function createBaseJob(overrides?: Partial<SyncJobRecord>): SyncJobRecord {
    return {
      id: 'job-cal-001',
      workspaceId,
      connectorId: 'google_calendar',
      sourceId: calendarId,
      consentGeneration,
      status: 'running',
      attempts: 0,
      maxRetries: 5,
      lockedBy: 'worker-1',
      leaseExpiresAt: '2026-11-11T12:15:00.000Z',
      cursor: null,
      nextSyncToken: null,
      stats: {},
      lastError: null,
      retryAfter: null,
      createdAt: fixedNow,
      updatedAt: fixedNow,
      ...overrides,
    };
  }

  it('1. job.cursor가 없을 때 mode="full"로 조회하고 이벤트를 marketing_connector_evidence에 영속화한다', async () => {
    const mockFetch = vi.fn(async (input: FetchCalendarEventsInput): Promise<GoogleAdapterResult<CalendarEventsData>> => {
      expect(input.mode).toBe('full');
      if (input.mode === 'full') {
        expect(input.calendarId).toBe(calendarId);
        expect(input.accessToken).toBe('ya29.valid-test-access-token');
        expect(input.timeMin).toBeDefined();
        expect(input.timeMax).toBeDefined();
      }
      return {
        ok: true,
        data: {
          items: [
            {
              kind: 'timed',
              id: 'event-timed-1',
              summary: '신제품 출시 세미나',
              start: '2026-11-15T14:00:00Z',
              end: '2026-11-15T16:00:00Z',
              status: 'confirmed',
            },
            {
              kind: 'all_day',
              id: 'event-allday-1',
              summary: '블랙프라이데이 프로모션',
              startDate: '2026-11-20',
              endDate: '2026-11-21',
              status: 'confirmed',
            },
          ],
          complete: true,
        },
        derivedFromGoogle: true,
        nextSyncToken: 'sync-token-alpha',
      };
    });

    const handler = new GoogleCalendarSyncHandler({
      credentialGateway: vaultGateway,
      consentGateway,
      evidenceGateway,
      keyBase64: TEST_KEY_BASE64,
      fetchEvents: mockFetch,
      now: () => fixedNow,
    });

    const job = createBaseJob({ cursor: null });
    const result = await handler.execute(job);

    expect(result.stats).toEqual({
      fetchedCount: 2,
      savedCount: 2,
      isFullResync: false,
    });
    expect(result.nextSyncToken).toBe('sync-token-alpha');
    expect(result.cursor).toBe('sync-token-alpha');

    // Evidence 원장 영속화 확인
    const savedEvidence = await evidenceGateway.listEvidence({
      workspaceId,
      connectorId: 'google_calendar',
      purpose: 'marketing',
    });

    expect(savedEvidence).toHaveLength(2);
    expect(savedEvidence.map((e) => e.sourceId).sort()).toEqual(['event-allday-1', 'event-timed-1']);
    expect(savedEvidence[0].derivedFromGoogle).toBe(true);
    expect(savedEvidence[0].purpose).toBe('marketing');
    expect(savedEvidence[0].consentGeneration).toBe(consentGeneration);
  });

  it('2. job.cursor가 있을 때 mode="incremental"로 조회하고 증분 수집을 완결한다', async () => {
    const mockFetch = vi.fn(async (input: FetchCalendarEventsInput): Promise<GoogleAdapterResult<CalendarEventsData>> => {
      expect(input.mode).toBe('incremental');
      if (input.mode === 'incremental') {
        expect(input.syncToken).toBe('prev-sync-token-123');
        expect(input.calendarId).toBe(calendarId);
      }
      return {
        ok: true,
        data: {
          items: [
            {
              kind: 'timed',
              id: 'event-timed-2',
              summary: '추가 고객 상담 세션',
              start: '2026-11-18T10:00:00Z',
              end: '2026-11-18T11:00:00Z',
              status: 'confirmed',
            },
          ],
          complete: true,
        },
        derivedFromGoogle: true,
        nextSyncToken: 'sync-token-beta',
      };
    });

    const handler = new GoogleCalendarSyncHandler({
      credentialGateway: vaultGateway,
      consentGateway,
      evidenceGateway,
      keyBase64: TEST_KEY_BASE64,
      fetchEvents: mockFetch,
      now: () => fixedNow,
    });

    const job = createBaseJob({ cursor: 'prev-sync-token-123' });
    const result = await handler.execute(job);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.stats).toEqual({
      fetchedCount: 1,
      savedCount: 1,
      isFullResync: false,
    });
    expect(result.nextSyncToken).toBe('sync-token-beta');
  });

  it('3. 410 sync_expired 발생 시 즉시 mode="full"로 fallback 전체 재동기화한다', async () => {
    const mockFetch = vi.fn(async (input: FetchCalendarEventsInput): Promise<GoogleAdapterResult<CalendarEventsData>> => {
      if (input.mode === 'incremental') {
        return {
          ok: false,
          error: {
            code: 'sync_expired',
            status: 410,
            message: 'Sync token has expired. Full sync required.',
          },
        };
      }
      // fallback full mode
      expect(input.mode).toBe('full');
      return {
        ok: true,
        data: {
          items: [
            {
              kind: 'timed',
              id: 'event-resync-1',
              summary: '전체 재동기화 일정',
              start: '2026-11-16T09:00:00Z',
              end: '2026-11-16T10:00:00Z',
              status: 'confirmed',
            },
          ],
          complete: true,
        },
        derivedFromGoogle: true,
        nextSyncToken: 'new-fresh-sync-token',
      };
    });

    const handler = new GoogleCalendarSyncHandler({
      credentialGateway: vaultGateway,
      consentGateway,
      evidenceGateway,
      keyBase64: TEST_KEY_BASE64,
      fetchEvents: mockFetch,
      now: () => fixedNow,
    });

    const job = createBaseJob({ cursor: 'expired-token-999' });
    const result = await handler.execute(job);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.stats).toEqual({
      fetchedCount: 1,
      savedCount: 1,
      isFullResync: true,
    });
    expect(result.nextSyncToken).toBe('new-fresh-sync-token');
    expect(result.cursor).toBe('new-fresh-sync-token');
  });

  it('4. status="cancelled" (tombstone) 일정을 revokedAt 설정으로 무효화 저장한다', async () => {
    const mockFetch = vi.fn(async (): Promise<GoogleAdapterResult<CalendarEventsData>> => {
      return {
        ok: true,
        data: {
          items: [
            {
              kind: 'tombstone',
              id: 'event-cancelled-1',
              status: 'cancelled',
            },
          ],
          complete: true,
        },
        derivedFromGoogle: true,
        nextSyncToken: 'next-token-tombstone',
      };
    });

    const handler = new GoogleCalendarSyncHandler({
      credentialGateway: vaultGateway,
      consentGateway,
      evidenceGateway,
      keyBase64: TEST_KEY_BASE64,
      fetchEvents: mockFetch,
      now: () => fixedNow,
    });

    const job = createBaseJob({ cursor: 'sync-token-prev' });
    const result = await handler.execute(job);

    expect(result.stats.fetchedCount).toBe(1);
    expect(result.stats.savedCount).toBe(1);

    const evidenceList = await evidenceGateway.listEvidence({
      workspaceId,
      connectorId: 'google_calendar',
      sourceId: 'event-cancelled-1',
    });

    expect(evidenceList).toHaveLength(1);
    const tombstoneRecord = evidenceList[0];
    expect(tombstoneRecord.revokedAt).toBe(fixedNow);
    expect(tombstoneRecord.metadata.status).toBe('cancelled');
    expect(tombstoneRecord.metadata.tombstone).toBe(true);
  });

  it('5. F04 동의 원장에서 허용되지 않은 calendarId는 ACCESS_DENIED로 차단하고 API 호출을 건너뛴다', async () => {
    const mockFetch = vi.fn();

    const handler = new GoogleCalendarSyncHandler({
      credentialGateway: vaultGateway,
      consentGateway,
      evidenceGateway,
      keyBase64: TEST_KEY_BASE64,
      fetchEvents: mockFetch,
      now: () => fixedNow,
    });

    // 허용 목록에 없는 다른 calendarId로 작업 생성
    const job = createBaseJob({ sourceId: 'unauthorized-calendar-999' });

    await expect(handler.execute(job)).rejects.toThrow(ConsentAccessDeniedError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('6. F03 Token Vault에서 해당 세대 자격증명이 없으면 실패 에러를 발생시킨다', async () => {
    const mockFetch = vi.fn();

    const handler = new GoogleCalendarSyncHandler({
      credentialGateway: vaultGateway,
      consentGateway,
      evidenceGateway,
      keyBase64: TEST_KEY_BASE64,
      fetchEvents: mockFetch,
      now: () => fixedNow,
    });

    // consentGeneration이 일치하지 않는 작업
    const job = createBaseJob({ consentGeneration: 99 });

    await expect(handler.execute(job)).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('7. F05 SyncEngine과 완벽히 연동되어 선점->핸들러 실행->completeSyncJob까지 완주한다', async () => {
    const syncGateway = createInMemorySyncJobGateway();

    // 큐에 작업 등록
    const enqueuedJob = await enqueueSyncJob(
      {
        workspaceId,
        connectorId: 'google_calendar',
        sourceId: calendarId,
        consentGeneration,
        cursor: null,
        now: fixedNow,
      },
      syncGateway,
    );

    const mockFetch = vi.fn(async (): Promise<GoogleAdapterResult<CalendarEventsData>> => {
      return {
        ok: true,
        data: {
          items: [
            {
              kind: 'timed',
              id: 'event-engine-1',
              summary: '엔진 연동 테스트 세미나',
              start: '2026-11-17T15:00:00Z',
              end: '2026-11-17T16:00:00Z',
              status: 'confirmed',
            },
          ],
          complete: true,
        },
        derivedFromGoogle: true,
        nextSyncToken: 'sync-token-engine-success',
      };
    });

    const handler = new GoogleCalendarSyncHandler({
      credentialGateway: vaultGateway,
      consentGateway,
      evidenceGateway,
      keyBase64: TEST_KEY_BASE64,
      fetchEvents: mockFetch,
      now: () => fixedNow,
    });

    const engine = new SyncEngine({
      syncGateway,
      consentGateway,
      workerId: 'worker-integration-1',
      leaseDurationSeconds: 900,
      now: () => fixedNow,
    });

    engine.registerHandler('google_calendar', handler);

    const cycleResult = await engine.runSyncCycle();

    expect(cycleResult.processed).toBe(true);
    expect(cycleResult.jobId).toBe(enqueuedJob.id);
    expect(cycleResult.status).toBe('completed');
    expect(cycleResult.stats).toEqual({
      fetchedCount: 1,
      savedCount: 1,
      isFullResync: false,
    });

    // 큐 상태 확인
    const completedJob = await syncGateway.getJobById(enqueuedJob.id);
    expect(completedJob?.status).toBe('completed');
    expect(completedJob?.nextSyncToken).toBe('sync-token-engine-success');
    expect(completedJob?.cursor).toBe('sync-token-engine-success');
  });
});
