import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConnectorId } from '../catalog';
import {
  GoogleSheetsSyncHandler,
  ConsentAccessDeniedError,
} from './sheets-sync-runner';
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
import type { GoogleSheetResult } from '../adapters/google-sheets';

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

describe('GoogleSheetsSyncHandler (MC/S02 - ANI-2164)', () => {
  const fixedNow = '2026-11-11T12:00:00.000Z';
  const workspaceId = 'ws-test-sheets-123';
  const spreadsheetId = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
  const range = '메뉴판!A1:D20';
  const sourceId = `${spreadsheetId}!${range}`;
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
        connectorId: 'google_sheets',
        consentGeneration,
        accessToken: 'ya29.valid-sheets-test-token',
        refreshToken: 'refresh-sheets-test-token',
        expiresAt: '2026-12-01T00:00:00.000Z',
        grantedScopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        keyBase64: TEST_KEY_BASE64,
      },
      vaultGateway,
    );

    // F04 동의 원장 기본 상태 설정
    storedConsent = {
      workspaceId,
      connectorId: 'google_sheets',
      consentGeneration,
      allowedSourceIds: [sourceId],
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

  const sampleSheetResult: GoogleSheetResult = {
    spreadsheetId,
    range,
    rowCount: 3,
    columnCount: 2,
    headers: ['메뉴명', '가격'],
    rows: [
      ['아메리카노', '5,000원'],
      ['카페라떼', '5,500원'],
    ],
    totalCharCount: 40,
    truncated: false,
    warnings: [],
    derivedFromGoogle: true,
  };

  function createBaseJob(overrides?: Partial<SyncJobRecord>): SyncJobRecord {
    return {
      id: 'job-sheet-001',
      workspaceId,
      connectorId: 'google_sheets',
      sourceId,
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

  it('collects sheet values, parses prices, and saves evidence to K01 ledger when no conflicts', async () => {
    const mockFetch = vi.fn().mockResolvedValue(sampleSheetResult);

    const handler = new GoogleSheetsSyncHandler({
      credentialGateway: vaultGateway,
      consentGateway,
      evidenceGateway,
      keyBase64: TEST_KEY_BASE64,
      fetchValues: mockFetch,
      existingConfirmedPrices: {
        아메리카노: 5000,
        카페라떼: 5500,
      },
      now: () => fixedNow,
    });

    const job = createBaseJob({ id: 'job-sheet-1' });

    const result = await handler.execute(job);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadsheetId,
        range,
        accessToken: 'ya29.valid-sheets-test-token',
      }),
      undefined
    );

    expect(result.stats).toMatchObject({
      rowCount: 3,
      columnCount: 2,
      parsedItemCount: 2,
      hasPriceConflict: false,
      conflictCount: 0,
      savedCount: 1,
    });

    const records = await evidenceGateway.listEvidence({
      workspaceId,
      connectorId: 'google_sheets',
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      workspaceId,
      connectorId: 'google_sheets',
      sourceId,
      purpose: 'marketing',
      derivedFromGoogle: true,
      metadata: expect.objectContaining({
        spreadsheetId,
        range,
        hasPriceConflict: false,
        priceConflict: false,
        conflictingPrices: [],
        parsedPrices: [
          { item: '아메리카노', price: 5000 },
          { item: '카페라떼', price: 5500 },
        ],
      }),
    });
  });

  it('detects price conflicts against existing confirmed prices and preserves metadata without overwriting', async () => {
    const sheetWithChangedPrices: GoogleSheetResult = {
      spreadsheetId,
      range,
      rowCount: 3,
      columnCount: 2,
      headers: ['메뉴명', '가격'],
      rows: [
        ['아메리카노', '5,500원'], // 기존 4,500원 -> 5,500원 변경 (충돌!)
        ['카페라떼', '5,000원'],   // 기존 5,000원과 동일
      ],
      totalCharCount: 40,
      truncated: false,
      warnings: [],
      derivedFromGoogle: true,
    };

    const mockFetch = vi.fn().mockResolvedValue(sheetWithChangedPrices);

    const handler = new GoogleSheetsSyncHandler({
      credentialGateway: vaultGateway,
      consentGateway,
      evidenceGateway,
      keyBase64: TEST_KEY_BASE64,
      fetchValues: mockFetch,
      existingConfirmedPrices: {
        아메리카노: 4500, // 기존 확정 가격
        카페라떼: 5000,
      },
      now: () => fixedNow,
    });

    const job = createBaseJob({ id: 'job-sheet-2' });

    const result = await handler.execute(job);

    expect(result.stats).toMatchObject({
      hasPriceConflict: true,
      conflictCount: 1,
    });

    const records = await evidenceGateway.listEvidence({
      workspaceId,
      connectorId: 'google_sheets',
    });

    expect(records).toHaveLength(1);
    expect(records[0].metadata).toMatchObject({
      hasPriceConflict: true,
      priceConflict: true,
      conflictingPrices: [
        {
          item: '아메리카노',
          oldPrice: 4500,
          newPrice: 5500,
        },
      ],
    });
    // 후보 근거로서 purpose: 'marketing', derivedFromGoogle: true 보존
    expect(records[0].purpose).toBe('marketing');
    expect(records[0].derivedFromGoogle).toBe(true);
  });

  it('supports asynchronous existingConfirmedPrices provider and handles various currency notations', async () => {
    const sheetWithVariousFormats: GoogleSheetResult = {
      spreadsheetId,
      range,
      rowCount: 4,
      columnCount: 2,
      headers: ['서비스명', '판매가'],
      rows: [
        ['베이직 컷', '₩18,000'],
        ['디자인 펌', '55,000원'],
        ['헤어 클리닉', '  40000 '],
      ],
      totalCharCount: 60,
      truncated: false,
      warnings: [],
      derivedFromGoogle: true,
    };

    const mockFetch = vi.fn().mockResolvedValue(sheetWithVariousFormats);

    const asyncPricesProvider = vi.fn().mockResolvedValue({
      '베이직 컷': 15000, // 15000 -> 18000 충돌
      '디자인 펌': 55000, // 동일
      // '헤어 클리닉'은 기존에 없음 -> 신규 항목이므로 충돌 아님
    });

    const handler = new GoogleSheetsSyncHandler({
      credentialGateway: vaultGateway,
      consentGateway,
      evidenceGateway,
      keyBase64: TEST_KEY_BASE64,
      fetchValues: mockFetch,
      existingConfirmedPrices: asyncPricesProvider,
      now: () => fixedNow,
    });

    const job = createBaseJob({ id: 'job-sheet-async-prices' });

    const result = await handler.execute(job);

    expect(asyncPricesProvider).toHaveBeenCalledWith(workspaceId);
    expect(result.stats).toMatchObject({
      parsedItemCount: 3,
      hasPriceConflict: true,
      conflictCount: 1,
    });

    const records = await evidenceGateway.listEvidence({
      workspaceId,
      connectorId: 'google_sheets',
    });

    expect(records).toHaveLength(1);
    expect(records[0].metadata).toMatchObject({
      hasPriceConflict: true,
      conflictingPrices: [
        {
          item: '베이직 컷',
          oldPrice: 15000,
          newPrice: 18000,
        },
      ],
      parsedPrices: [
        { item: '베이직 컷', price: 18000 },
        { item: '디자인 펌', price: 55000 },
        { item: '헤어 클리닉', price: 40000 },
      ],
    });
  });

  it('rejects with ConsentAccessDeniedError if sourceId is not allowed in consent ledger (Fail-Closed)', async () => {
    const unapprovedSourceId = 'other-sheet-id!A1:B10';

    const handler = new GoogleSheetsSyncHandler({
      credentialGateway: vaultGateway,
      consentGateway,
      evidenceGateway,
      keyBase64: TEST_KEY_BASE64,
      now: () => fixedNow,
    });

    const job = createBaseJob({
      id: 'job-sheet-3',
      sourceId: unapprovedSourceId,
    });

    await expect(handler.execute(job)).rejects.toThrow(ConsentAccessDeniedError);
  });

  it('throws error if connectorId is not google_sheets', async () => {
    const handler = new GoogleSheetsSyncHandler({
      credentialGateway: vaultGateway,
      consentGateway,
      evidenceGateway,
      keyBase64: TEST_KEY_BASE64,
    });

    const invalidJob = createBaseJob({
      id: 'job-sheet-4',
      connectorId: 'google_calendar' as ConnectorId,
    });

    await expect(handler.execute(invalidJob)).rejects.toThrow(/Invalid connectorId/i);
  });

  it('integrates seamlessly with SyncEngine cycle', async () => {
    const mockFetch = vi.fn().mockResolvedValue(sampleSheetResult);
    const syncGateway = createInMemorySyncJobGateway();

    await enqueueSyncJob(
      {
        workspaceId,
        connectorId: 'google_sheets',
        sourceId,
        consentGeneration,
        now: fixedNow,
      },
      syncGateway
    );

    const engine = new SyncEngine({
      syncGateway,
      consentGateway,
      workerId: 'worker-sheet-engine',
      now: () => fixedNow,
    });

    const handler = new GoogleSheetsSyncHandler({
      credentialGateway: vaultGateway,
      consentGateway,
      evidenceGateway,
      keyBase64: TEST_KEY_BASE64,
      fetchValues: mockFetch,
      now: () => fixedNow,
    });

    engine.registerHandler('google_sheets', handler);

    const cycleResult = await engine.runSyncCycle();

    expect(cycleResult.processed).toBe(true);
    expect(cycleResult.status).toBe('completed');
    expect(cycleResult.stats).toMatchObject({
      parsedItemCount: 2,
      hasPriceConflict: false,
    });
  });
});
