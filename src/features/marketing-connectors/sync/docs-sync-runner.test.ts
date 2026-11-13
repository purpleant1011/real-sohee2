import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConnectorId } from '../catalog';
import {
  GoogleDocsSyncHandler,
  ConsentAccessDeniedError,
} from './docs-sync-runner';
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
import {
  GoogleDocError,
  type GoogleDocResult,
} from '../adapters/google-docs';

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

describe('GoogleDocsSyncHandler (MC/D03 - ANI-2162)', () => {
  const fixedNow = '2026-11-11T12:00:00.000Z';
  const workspaceId = 'ws-test-docs-123';
  const documentId = '1dOcId_AbCdEfGhIjKlMnOpQrStUvWxYz-0123456789';
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
        connectorId: 'google_docs',
        consentGeneration,
        accessToken: 'ya29.valid-docs-test-token',
        refreshToken: 'refresh-docs-test-token',
        expiresAt: '2026-12-01T00:00:00.000Z',
        grantedScopes: ['https://www.googleapis.com/auth/documents.readonly'],
        keyBase64: TEST_KEY_BASE64,
      },
      vaultGateway
    );

    // F04 동의 원장 기본 상태 설정
    storedConsent = {
      workspaceId,
      connectorId: 'google_docs',
      consentGeneration,
      allowedSourceIds: [documentId],
      purpose: 'marketing',
      validUntil: '2027-11-11T12:00:00.000Z',
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

  const sampleDocResult: GoogleDocResult = {
    documentId,
    title: '매장 가이드 및 프로모션 안내',
    revisionId: 'rev-001-abc',
    tabs: [
      {
        tabId: 't.0',
        title: '소개',
        text: '저희 매장은 유기농 원두만을 사용합니다.\n',
        charCount: 22,
      },
      {
        tabId: 't.1',
        title: '11월 이벤트',
        text: '첫 방문 고객 아메리카노 1+1 쿠폰 증정.\n',
        charCount: 23,
      },
    ],
    totalCharCount: 45,
    truncated: false,
    warnings: [],
    derivedFromGoogle: true,
  };

  function createBaseJob(overrides?: Partial<SyncJobRecord>): SyncJobRecord {
    return {
      id: 'job-doc-001',
      workspaceId,
      connectorId: 'google_docs',
      sourceId: documentId,
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

  it('collects document content and saves evidence to K01 ledger on initial sync', async () => {
    const mockFetch = vi.fn().mockResolvedValue(sampleDocResult);

    const handler = new GoogleDocsSyncHandler({
      credentialGateway: vaultGateway,
      consentGateway,
      evidenceGateway,
      keyBase64: TEST_KEY_BASE64,
      fetchDoc: mockFetch,
      now: () => fixedNow,
    });

    const job = createBaseJob({ id: 'job-doc-init', cursor: null });
    const result = await handler.execute(job);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId,
        accessToken: 'ya29.valid-docs-test-token',
      }),
      undefined
    );

    expect(result).toMatchObject({
      stats: {
        fetchedTabCount: 2,
        totalCharCount: 45,
        isChanged: true,
      },
      cursor: 'rev-001-abc',
    });

    const records = await evidenceGateway.listEvidence({
      workspaceId,
      connectorId: 'google_docs',
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      workspaceId,
      connectorId: 'google_docs',
      sourceId: documentId,
      revision: 'rev-001-abc',
      purpose: 'marketing',
      derivedFromGoogle: true,
      revokedAt: null,
      metadata: expect.objectContaining({
        documentId,
        title: '매장 가이드 및 프로모션 안내',
        revisionId: 'rev-001-abc',
        derivedFromGoogle: true,
      }),
    });
    expect(records[0].text).toContain('매장 가이드 및 프로모션 안내');
    expect(records[0].text).toContain('유기농 원두');
  });

  it('skips saving evidence when document revision is unchanged', async () => {
    const mockFetch = vi.fn().mockResolvedValue(sampleDocResult);

    const handler = new GoogleDocsSyncHandler({
      credentialGateway: vaultGateway,
      consentGateway,
      evidenceGateway,
      keyBase64: TEST_KEY_BASE64,
      fetchDoc: mockFetch,
      now: () => fixedNow,
    });

    // cursor가 이미 'rev-001-abc'인 경우
    const job = createBaseJob({ id: 'job-doc-skip', cursor: 'rev-001-abc' });
    const result = await handler.execute(job);

    expect(mockFetch).toHaveBeenCalled();
    expect(result).toMatchObject({
      stats: {
        fetchedTabCount: 2,
        totalCharCount: 45,
        isChanged: false,
      },
      cursor: 'rev-001-abc',
    });

    // Evidence 저장소에 새로 쓰지 않음
    const records = await evidenceGateway.listEvidence({
      workspaceId,
      connectorId: 'google_docs',
    });
    expect(records).toHaveLength(0);
  });

  it('saves new revision evidence when revision has changed', async () => {
    const updatedDocResult: GoogleDocResult = {
      ...sampleDocResult,
      revisionId: 'rev-002-xyz',
      tabs: [
        {
          tabId: 't.0',
          title: '소개',
          text: '저희 매장은 최고급 스페셜티 원두만을 사용합니다.\n',
          charCount: 29,
        },
      ],
      totalCharCount: 29,
    };

    const mockFetch = vi.fn().mockResolvedValue(updatedDocResult);

    const handler = new GoogleDocsSyncHandler({
      credentialGateway: vaultGateway,
      consentGateway,
      evidenceGateway,
      keyBase64: TEST_KEY_BASE64,
      fetchDoc: mockFetch,
      now: () => fixedNow,
    });

    const job = createBaseJob({ id: 'job-doc-update', cursor: 'rev-001-abc' });
    const result = await handler.execute(job);

    expect(result).toMatchObject({
      stats: {
        fetchedTabCount: 1,
        totalCharCount: 29,
        isChanged: true,
      },
      cursor: 'rev-002-xyz',
    });

    const records = await evidenceGateway.listEvidence({
      workspaceId,
      connectorId: 'google_docs',
    });
    expect(records).toHaveLength(1);
    expect(records[0].revision).toBe('rev-002-xyz');
    expect(records[0].text).toContain('최고급 스페셜티 원두');
  });

  it('rejects with ConsentAccessDeniedError if documentId is not in allowedSourceIds', async () => {
    const handler = new GoogleDocsSyncHandler({
      credentialGateway: vaultGateway,
      consentGateway,
      evidenceGateway,
      keyBase64: TEST_KEY_BASE64,
      now: () => fixedNow,
    });

    const job = createBaseJob({
      id: 'job-doc-denied',
      sourceId: 'unauthorized-doc-id-999',
    });

    await expect(handler.execute(job)).rejects.toThrow(ConsentAccessDeniedError);
  });

  it('invalidates existing evidence in K01 ledger when file is deleted (404)', async () => {
    // 먼저 기존 근거가 원장에 존재한다고 가정
    await evidenceGateway.upsertEvidence({
      id: 'existing-ev-1',
      workspaceId,
      connectorId: 'google_docs',
      sourceId: documentId,
      revision: 'rev-001-abc',
      consentGeneration: 1,
      observedAt: fixedNow,
      expiresAt: '2027-11-11T12:00:00.000Z',
      purpose: 'marketing',
      text: '기존 문서 본문',
      derivedFromGoogle: true,
      revokedAt: null,
      metadata: {},
    });

    const mockFetch = vi.fn().mockRejectedValue(
      new GoogleDocError('DOCUMENT_NOT_FOUND', 'Document not found', 404)
    );

    const handler = new GoogleDocsSyncHandler({
      credentialGateway: vaultGateway,
      consentGateway,
      evidenceGateway,
      keyBase64: TEST_KEY_BASE64,
      fetchDoc: mockFetch,
      now: () => fixedNow,
    });

    const job = createBaseJob({ id: 'job-doc-404' });

    await expect(handler.execute(job)).rejects.toThrow('Document not found');

    // 기존 근거의 revokedAt이 설정되어 무효화되었는지 검증
    const records = await evidenceGateway.listEvidence({
      workspaceId,
      connectorId: 'google_docs',
      sourceId: documentId,
    });

    expect(records).toHaveLength(1);
    expect(records[0].revokedAt).toBe(fixedNow);
  });

  it('invalidates existing evidence in K01 ledger when file permission is revoked (403)', async () => {
    await evidenceGateway.upsertEvidence({
      id: 'existing-ev-2',
      workspaceId,
      connectorId: 'google_docs',
      sourceId: documentId,
      revision: 'rev-001-abc',
      consentGeneration: 1,
      observedAt: fixedNow,
      expiresAt: '2027-11-11T12:00:00.000Z',
      purpose: 'marketing',
      text: '기존 문서 본문',
      derivedFromGoogle: true,
      revokedAt: null,
      metadata: {},
    });

    const mockFetch = vi.fn().mockRejectedValue(
      new GoogleDocError('ACCESS_DENIED', 'Access denied to document', 403)
    );

    const handler = new GoogleDocsSyncHandler({
      credentialGateway: vaultGateway,
      consentGateway,
      evidenceGateway,
      keyBase64: TEST_KEY_BASE64,
      fetchDoc: mockFetch,
      now: () => fixedNow,
    });

    const job = createBaseJob({ id: 'job-doc-403' });

    await expect(handler.execute(job)).rejects.toThrow('Access denied to document');

    const records = await evidenceGateway.listEvidence({
      workspaceId,
      connectorId: 'google_docs',
      sourceId: documentId,
    });

    expect(records).toHaveLength(1);
    expect(records[0].revokedAt).toBe(fixedNow);
  });

  it('integrates seamlessly with SyncEngine cycle and completes job', async () => {
    const mockFetch = vi.fn().mockResolvedValue(sampleDocResult);

    const handler = new GoogleDocsSyncHandler({
      credentialGateway: vaultGateway,
      consentGateway,
      evidenceGateway,
      keyBase64: TEST_KEY_BASE64,
      fetchDoc: mockFetch,
      now: () => fixedNow,
    });

    const syncGateway = createInMemorySyncJobGateway();
    const syncEngine = new SyncEngine({
      syncGateway,
      consentGateway,
      workerId: 'worker-docs-test',
      now: () => fixedNow,
    });

    syncEngine.registerHandler('google_docs', handler);

    const enqueuedJob = await enqueueSyncJob(
      {
        workspaceId,
        connectorId: 'google_docs',
        sourceId: documentId,
        consentGeneration,
        now: fixedNow,
      },
      syncGateway
    );

    const cycleResult = await syncEngine.runSyncCycle();

    expect(cycleResult.processed).toBe(true);
    expect(cycleResult.jobId).toBe(enqueuedJob.id);
    expect(cycleResult.status).toBe('completed');
    expect(cycleResult.stats).toMatchObject({
      fetchedTabCount: 2,
      totalCharCount: 45,
      isChanged: true,
    });

    const updatedJob = await syncGateway.getJobById(enqueuedJob.id);
    expect(updatedJob?.status).toBe('completed');
    expect(updatedJob?.cursor).toBe('rev-001-abc');
  });
});
