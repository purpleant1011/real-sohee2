import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConnectorId } from '../catalog';
import {
  GmailSyncHandler,
  ConsentAccessDeniedError,
} from './gmail-sync-runner';
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
import type {
  GmailMessagesResult,
  GmailHistoryResult,
  GmailMessageItem,
} from '../adapters/gmail';
import { GmailError } from '../adapters/gmail';

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

describe('GmailSyncHandler (MC/M02 - ANI-2166)', () => {
  const fixedNow = '2026-11-11T12:00:00.000Z';
  const workspaceId = 'ws-test-gmail';
  const labelId = 'INBOX';
  const consentGeneration = 1;

  let vaultGateway: CredentialVaultGateway;
  let consentGateway: ConsentLedgerGateway;
  let evidenceGateway: EvidenceGateway;
  let storedConsent: MarketingConsentRecord | null;

  const sampleMessage: GmailMessageItem = {
    id: 'msg-101',
    threadId: 'th-101',
    historyId: 'hist-500',
    subject: '마케팅 대행 견적 의뢰',
    from: '박이사',
    senderName: '박이사',
    senderEmailMasked: 'p***k@client.com',
    date: '2026-11-10T10:00:00Z',
    internalDate: '1700000000000',
    bodyText: '11월 마케팅 견적서 송부 요청드립니다.',
    charCount: 24,
    truncated: false,
    labelIds: ['INBOX'],
  };

  beforeEach(async () => {
    vaultGateway = new InMemoryVaultGateway();
    evidenceGateway = createInMemoryEvidenceGateway();

    // F03 Vault 토큰 저장
    await saveConnectorCredential(
      {
        workspaceId,
        connectorId: 'gmail',
        consentGeneration,
        accessToken: 'ya29.test-gmail-access-token',
        refreshToken: 'refresh-token',
        expiresAt: '2026-12-01T00:00:00.000Z',
        grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
        keyBase64: TEST_KEY_BASE64,
      },
      vaultGateway
    );

    // F04 동의 원장 기본 상태 설정
    storedConsent = {
      workspaceId,
      connectorId: 'gmail',
      consentGeneration,
      allowedSourceIds: [labelId],
      purpose: 'marketing',
      status: 'active',
      validUntil: '2026-12-31T23:59:59.000Z',
      aiProcessingApproved: true,
      updatedAt: fixedNow,
      updatedBy: 'test-user',
    };

    consentGateway = {
      async getLatestConsent(ws: string, conn: ConnectorId) {
        if (storedConsent && storedConsent.workspaceId === ws && storedConsent.connectorId === conn) {
          return storedConsent;
        }
        return null;
      },
      async saveConsentRecord(record: MarketingConsentRecord) {
        storedConsent = record;
      },
    };
  });

  function createBaseJob(overrides?: Partial<SyncJobRecord>): SyncJobRecord {
    return {
      id: 'job-gmail-001',
      workspaceId,
      connectorId: 'gmail',
      sourceId: labelId,
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

  it('동의 원장에 소스(labelId)가 미등록된 경우 ConsentAccessDeniedError를 던진다', async () => {
    storedConsent = {
      ...storedConsent!,
      allowedSourceIds: ['SPAM'], // INBOX 없음
    };

    const handler = new GmailSyncHandler({
      credentialGateway: vaultGateway,
      consentGateway,
      evidenceGateway,
      keyBase64: TEST_KEY_BASE64,
      now: () => fixedNow,
    });

    const job = createBaseJob({ id: 'job-1' });

    await expect(handler.execute(job)).rejects.toThrowError(ConsentAccessDeniedError);
  });

  it('job.cursor가 없는 경우 Full Sync를 수행하고 증거 원장에 저장하며 cursor(historyId)를 반환한다', async () => {
    const mockFetchMessages = vi.fn().mockResolvedValue({
      messages: [sampleMessage],
      latestHistoryId: 'hist-500',
      warnings: [],
      derivedFromGoogle: true,
    } satisfies GmailMessagesResult);

    const handler = new GmailSyncHandler({
      credentialGateway: vaultGateway,
      consentGateway,
      evidenceGateway,
      keyBase64: TEST_KEY_BASE64,
      fetchMessages: mockFetchMessages,
      now: () => fixedNow,
    });

    const job = createBaseJob({ id: 'job-full' });

    const result = await handler.execute(job);

    expect(result.cursor).toBe('hist-500');
    expect(result.stats).toEqual({
      fetchedCount: 1,
      messageIds: ['msg-101'],
      deletedCount: 0,
    });

    // 원장에 영속화되었는지 확인
    const evidenceList = await evidenceGateway.listEvidence({
      workspaceId,
      connectorId: 'gmail',
    });
    expect(evidenceList).toHaveLength(1);
    expect(evidenceList[0].sourceId).toBe('msg-101');
    expect(evidenceList[0].text).toContain('마케팅 대행 견적 의뢰');
    expect(evidenceList[0].text).toContain('박이사');
    expect(evidenceList[0].derivedFromGoogle).toBe(true);
    expect(evidenceList[0].purpose).toBe('marketing');
  });

  it('job.cursor가 있는 경우 증분 History 조회를 수행하고 삭제 건은 원장에서 무효화(revoke)한다', async () => {
    // 미리 기존 증거 적재
    await evidenceGateway.upsertEvidence({
      id: 'ev-del-1',
      workspaceId,
      connectorId: 'gmail',
      sourceId: 'msg-to-delete',
      revision: 'rev-1',
      consentGeneration,
      observedAt: fixedNow,
      expiresAt: '2026-12-31T23:59:59.000Z',
      purpose: 'marketing',
      text: '삭제될 메시지',
      derivedFromGoogle: true,
      revokedAt: null,
      metadata: {},
    });

    const mockFetchHistory = vi.fn().mockResolvedValue({
      historyId: 'hist-600',
      history: [],
      addedMessageIds: ['msg-101'],
      deletedMessageIds: ['msg-to-delete'],
      derivedFromGoogle: true,
    } satisfies GmailHistoryResult);

    const mockFetchSingle = vi.fn().mockResolvedValue(sampleMessage);

    const handler = new GmailSyncHandler({
      credentialGateway: vaultGateway,
      consentGateway,
      evidenceGateway,
      keyBase64: TEST_KEY_BASE64,
      fetchHistory: mockFetchHistory,
      fetchSingleMessage: mockFetchSingle,
      now: () => fixedNow,
    });

    const job = createBaseJob({
      id: 'job-inc',
      cursor: 'hist-500',
    });

    const result = await handler.execute(job);

    expect(mockFetchHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        startHistoryId: 'hist-500',
        labelId,
      }),
      undefined
    );
    expect(result.cursor).toBe('hist-600');
    expect(result.stats.fetchedCount).toBe(1);
    expect(result.stats.deletedCount).toBe(1);

    // 삭제된 메시지가 revokedAt으로 무효화되었는지 확인
    const evidenceList = await evidenceGateway.listEvidence({
      workspaceId,
      connectorId: 'gmail',
    });
    const deletedRecord = evidenceList.find((e) => e.sourceId === 'msg-to-delete');
    expect(deletedRecord?.revokedAt).toBe(fixedNow);
  });

  it('History 만료(HISTORY_EXPIRED / 404) 발생 시 Full Resync로 자동 fallback한다', async () => {
    const mockFetchHistory = vi.fn().mockRejectedValue(
      new GmailError('HISTORY_EXPIRED', 'History record not found', 404)
    );

    const mockFetchMessages = vi.fn().mockResolvedValue({
      messages: [sampleMessage],
      latestHistoryId: 'hist-new-700',
      warnings: ['Full resync fallback from expired history'],
      derivedFromGoogle: true,
    } satisfies GmailMessagesResult);

    const handler = new GmailSyncHandler({
      credentialGateway: vaultGateway,
      consentGateway,
      evidenceGateway,
      keyBase64: TEST_KEY_BASE64,
      fetchHistory: mockFetchHistory,
      fetchMessages: mockFetchMessages,
      now: () => fixedNow,
    });

    const job = createBaseJob({
      id: 'job-expired',
      cursor: 'hist-very-old',
    });

    const result = await handler.execute(job);

    expect(mockFetchHistory).toHaveBeenCalled();
    expect(mockFetchMessages).toHaveBeenCalled();
    expect(result.cursor).toBe('hist-new-700');
    expect(result.stats.fetchedCount).toBe(1);
  });

  it('SyncEngine과 통합되어 runSyncCycle이 성공적으로 완료된다', async () => {
    const syncGateway = createInMemorySyncJobGateway();
    await enqueueSyncJob(
      {
        workspaceId,
        connectorId: 'gmail',
        sourceId: labelId,
        consentGeneration,
        now: fixedNow,
      },
      syncGateway
    );

    const mockFetchMessages = vi.fn().mockResolvedValue({
      messages: [sampleMessage],
      latestHistoryId: 'hist-engine-900',
      warnings: [],
      derivedFromGoogle: true,
    } satisfies GmailMessagesResult);

    const handler = new GmailSyncHandler({
      credentialGateway: vaultGateway,
      consentGateway,
      evidenceGateway,
      keyBase64: TEST_KEY_BASE64,
      fetchMessages: mockFetchMessages,
      now: () => fixedNow,
    });

    const engine = new SyncEngine({
      syncGateway,
      consentGateway,
      workerId: 'worker-gmail-1',
      now: () => fixedNow,
    });
    engine.registerHandler('gmail', handler);

    const cycleResult = await engine.runSyncCycle();
    expect(cycleResult.processed).toBe(true);
    expect(cycleResult.status).toBe('completed');
  });
});
