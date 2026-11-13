import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  verifyAndRegisterDriveFiles,
  GoogleDrivePickerError,
  SUPPORTED_DRIVE_MIME_TYPES,
  type DriveFileGateway,
  type DriveFileItem,
} from './google-picker-service';
import type { MarketingConsentRecord, ConsentLedgerGateway } from '../consent/consent-ledger';

describe('google-picker-service: verifyAndRegisterDriveFiles', () => {
  const workspaceId = '3f9b2d84-18e3-4c91-a582-7dcfa3c81204';
  const actorUserId = 'user-owner-123';
  const validDocId = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
  const validSheetId = '1qpyC0XzvTcKT6EISywvqESX3A0MwQoTL8LesTBUVPXw';

  class MemoryConsentGateway implements ConsentLedgerGateway {
    store = new Map<string, MarketingConsentRecord>();

    async getLatestConsent(
      wsId: string,
      connectorId: string
    ): Promise<MarketingConsentRecord | null> {
      return this.store.get(`${wsId}:${connectorId}`) ?? null;
    }

    async saveConsentRecord(record: MarketingConsentRecord): Promise<void> {
      this.store.set(`${record.workspaceId}:${record.connectorId}`, record);
    }
  }

  let consentGateway: MemoryConsentGateway;
  let updateConnectionGenMock: ReturnType<
    typeof vi.fn<(workspaceId: string, connectorId: any, generation: number) => Promise<void>>
  >;

  beforeEach(() => {
    vi.clearAllMocks();
    consentGateway = new MemoryConsentGateway();
    updateConnectionGenMock = vi.fn().mockResolvedValue(undefined);
  });

  function createMockGateway(options?: {
    accessToken?: string | null;
    fetchResponseMap?: Record<string, { status: number; body: unknown }>;
  }): DriveFileGateway {
    const accessToken = options?.accessToken !== undefined ? options.accessToken : 'mock-token-xyz';
    const fetchResponseMap = options?.fetchResponseMap || {};

    const mockFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const urlStr = input.toString();
      const match = /files\/([^?]+)/.exec(urlStr);
      const fileId = match ? match[1] : '';

      const resp = fetchResponseMap[fileId];
      if (resp) {
        return new Response(JSON.stringify(resp.body), {
          status: resp.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 기본 성공 모의 객체
      const defaultItem: DriveFileItem = {
        id: fileId,
        name: `File ${fileId}`,
        mimeType: 'application/vnd.google-apps.document',
        trashed: false,
      };
      return new Response(JSON.stringify(defaultItem), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    return {
      getAccessToken: vi.fn().mockResolvedValue(accessToken),
      fetch: mockFetch,
      consentLedgerGateway: consentGateway,
      updateConnectionGeneration: updateConnectionGenMock,
    };
  }

  describe('1. Input Validation', () => {
    it('throws when workspaceId is missing or invalid', async () => {
      const gateway = createMockGateway();
      await expect(
        verifyAndRegisterDriveFiles(
          { workspaceId: '', actorUserId, fileIds: [validDocId] },
          gateway
        )
      ).rejects.toThrow(GoogleDrivePickerError);

      await expect(
        verifyAndRegisterDriveFiles(
          { workspaceId: '   ', actorUserId, fileIds: [validDocId] },
          gateway
        )
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    });

    it('throws when actorUserId is missing or empty', async () => {
      const gateway = createMockGateway();
      await expect(
        verifyAndRegisterDriveFiles(
          { workspaceId, actorUserId: '', fileIds: [validDocId] },
          gateway
        )
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    });

    it('throws EMPTY_FILE_IDS when fileIds is empty or not an array', async () => {
      const gateway = createMockGateway();
      await expect(
        verifyAndRegisterDriveFiles(
          { workspaceId, actorUserId, fileIds: [] },
          gateway
        )
      ).rejects.toMatchObject({ code: 'EMPTY_FILE_IDS' });

      await expect(
        verifyAndRegisterDriveFiles(
          { workspaceId, actorUserId, fileIds: null as unknown as string[] },
          gateway
        )
      ).rejects.toMatchObject({ code: 'EMPTY_FILE_IDS' });
    });

    it('throws INVALID_FILE_ID when fileId is blank or contains path traversal', async () => {
      const gateway = createMockGateway();
      await expect(
        verifyAndRegisterDriveFiles(
          { workspaceId, actorUserId, fileIds: ['   '] },
          gateway
        )
      ).rejects.toMatchObject({ code: 'INVALID_FILE_ID' });

      await expect(
        verifyAndRegisterDriveFiles(
          { workspaceId, actorUserId, fileIds: ['../secret/doc'] },
          gateway
        )
      ).rejects.toMatchObject({ code: 'INVALID_FILE_ID' });

      await expect(
        verifyAndRegisterDriveFiles(
          { workspaceId, actorUserId, fileIds: ['file\\with\\backslash'] },
          gateway
        )
      ).rejects.toMatchObject({ code: 'INVALID_FILE_ID' });
    });
  });

  describe('2. Credential & Access Token Handling', () => {
    it('throws TOKEN_NOT_FOUND when gateway cannot return access token', async () => {
      const gateway = createMockGateway({ accessToken: null });
      await expect(
        verifyAndRegisterDriveFiles(
          { workspaceId, actorUserId, fileIds: [validDocId] },
          gateway
        )
      ).rejects.toMatchObject({ code: 'TOKEN_NOT_FOUND' });
    });
  });

  describe('3. Google Drive API Verification & Error Mapping', () => {
    it('calls Google Drive API with fields=id,name,mimeType,size,trashed and Authorization header', async () => {
      const gateway = createMockGateway();
      await verifyAndRegisterDriveFiles(
        { workspaceId, actorUserId, fileIds: [validDocId] },
        gateway
      );

      expect(gateway.fetch).toHaveBeenCalledTimes(1);
      const call = (gateway.fetch as any).mock.calls[0];
      const url = call[0];
      const init = call[1];

      expect(url).toContain(`https://www.googleapis.com/drive/v3/files/${validDocId}`);
      expect(url).toContain('fields=id%2Cname%2CmimeType%2Csize%2Ctrashed');
      expect(init?.headers?.Authorization).toBe('Bearer mock-token-xyz');
    });

    it('throws FILE_NOT_FOUND when file does not exist (404)', async () => {
      const gateway = createMockGateway({
        fetchResponseMap: {
          [validDocId]: { status: 404, body: { error: { message: 'File not found' } } },
        },
      });

      await expect(
        verifyAndRegisterDriveFiles(
          { workspaceId, actorUserId, fileIds: [validDocId] },
          gateway
        )
      ).rejects.toMatchObject({
        code: 'FILE_NOT_FOUND',
        status: 404,
        fileId: validDocId,
      });
    });

    it('throws ACCESS_DENIED when file access is forbidden (403)', async () => {
      const gateway = createMockGateway({
        fetchResponseMap: {
          [validDocId]: { status: 403, body: { error: { message: 'Forbidden' } } },
        },
      });

      await expect(
        verifyAndRegisterDriveFiles(
          { workspaceId, actorUserId, fileIds: [validDocId] },
          gateway
        )
      ).rejects.toMatchObject({
        code: 'ACCESS_DENIED',
        status: 403,
        fileId: validDocId,
      });
    });

    it('throws INVALID_CREDENTIALS when token is unauthorized (401)', async () => {
      const gateway = createMockGateway({
        fetchResponseMap: {
          [validDocId]: { status: 401, body: { error: { message: 'Unauthorized' } } },
        },
      });

      await expect(
        verifyAndRegisterDriveFiles(
          { workspaceId, actorUserId, fileIds: [validDocId] },
          gateway
        )
      ).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
        status: 401,
      });
    });

    it('throws RATE_LIMITED when API quota exceeded (429)', async () => {
      const gateway = createMockGateway({
        fetchResponseMap: {
          [validDocId]: { status: 429, body: { error: { message: 'Rate limit exceeded' } } },
        },
      });

      await expect(
        verifyAndRegisterDriveFiles(
          { workspaceId, actorUserId, fileIds: [validDocId] },
          gateway
        )
      ).rejects.toMatchObject({
        code: 'RATE_LIMITED',
        status: 429,
      });
    });

    it('throws GOOGLE_DRIVE_API_ERROR on 500 server error', async () => {
      const gateway = createMockGateway({
        fetchResponseMap: {
          [validDocId]: { status: 500, body: { error: { message: 'Internal backend error' } } },
        },
      });

      await expect(
        verifyAndRegisterDriveFiles(
          { workspaceId, actorUserId, fileIds: [validDocId] },
          gateway
        )
      ).rejects.toMatchObject({
        code: 'GOOGLE_DRIVE_API_ERROR',
        status: 500,
      });
    });
  });

  describe('4. Metadata & Scope Validation Rules', () => {
    it('throws TRASHED_FILE when file trashed is true', async () => {
      const gateway = createMockGateway({
        fetchResponseMap: {
          [validDocId]: {
            status: 200,
            body: {
              id: validDocId,
              name: 'Deleted Proposal',
              mimeType: 'application/vnd.google-apps.document',
              trashed: true,
            },
          },
        },
      });

      await expect(
        verifyAndRegisterDriveFiles(
          { workspaceId, actorUserId, fileIds: [validDocId] },
          gateway
        )
      ).rejects.toMatchObject({
        code: 'TRASHED_FILE',
        fileId: validDocId,
      });
    });

    it('throws UNSUPPORTED_MIME_TYPE for unsupported file types (pdf, folder, images)', async () => {
      const gateway = createMockGateway({
        fetchResponseMap: {
          [validDocId]: {
            status: 200,
            body: {
              id: validDocId,
              name: 'Invoice.pdf',
              mimeType: 'application/pdf',
              trashed: false,
            },
          },
        },
      });

      await expect(
        verifyAndRegisterDriveFiles(
          { workspaceId, actorUserId, fileIds: [validDocId] },
          gateway
        )
      ).rejects.toMatchObject({
        code: 'UNSUPPORTED_MIME_TYPE',
        fileId: validDocId,
      });
    });

    it('supports both Docs and Sheets mimeTypes', async () => {
      expect(SUPPORTED_DRIVE_MIME_TYPES).toContain('application/vnd.google-apps.document');
      expect(SUPPORTED_DRIVE_MIME_TYPES).toContain('application/vnd.google-apps.spreadsheet');

      const gateway = createMockGateway({
        fetchResponseMap: {
          [validDocId]: {
            status: 200,
            body: {
              id: validDocId,
              name: '소희 마케팅 기획서',
              mimeType: 'application/vnd.google-apps.document',
              trashed: false,
            },
          },
          [validSheetId]: {
            status: 200,
            body: {
              id: validSheetId,
              name: '가격표 및 일정표',
              mimeType: 'application/vnd.google-apps.spreadsheet',
              trashed: false,
            },
          },
        },
      });

      const result = await verifyAndRegisterDriveFiles(
        { workspaceId, actorUserId, fileIds: [validDocId, validSheetId] },
        gateway
      );

      expect(result.ok).toBe(true);
      expect(result.files).toHaveLength(2);
      expect(result.files[0].id).toBe(validDocId);
      expect(result.files[1].id).toBe(validSheetId);
    });
  });

  describe('5. Consent Ledger Registration & Generation Monotonic Increment', () => {
    it('registers allowedSourceIds in F04 consent ledger and increments generation', async () => {
      const gateway = createMockGateway({
        fetchResponseMap: {
          [validDocId]: {
            status: 200,
            body: {
              id: validDocId,
              name: '매뉴얼 v1',
              mimeType: 'application/vnd.google-apps.document',
              trashed: false,
            },
          },
        },
      });

      const fixedNow = '2026-11-11T12:00:00.000Z';
      const result = await verifyAndRegisterDriveFiles(
        {
          workspaceId,
          actorUserId,
          fileIds: [validDocId],
          now: fixedNow,
          aiProcessingApproved: true,
        },
        gateway
      );

      expect(result.ok).toBe(true);
      expect(result.consent.workspaceId).toBe(workspaceId);
      expect(result.consent.connectorId).toBe('google_drive');
      expect(result.consent.consentGeneration).toBe(1);
      expect(result.consent.allowedSourceIds).toEqual([validDocId]);
      expect(result.consent.aiProcessingApproved).toBe(true);
      expect(result.consent.status).toBe('active');
      expect(result.consent.updatedBy).toBe(actorUserId);

      // connection generation callback was called
      expect(updateConnectionGenMock).toHaveBeenCalledWith(workspaceId, 'google_drive', 1);

      // Re-register with another file increments generation to 2
      const result2 = await verifyAndRegisterDriveFiles(
        {
          workspaceId,
          actorUserId,
          fileIds: [validDocId, validSheetId],
          now: '2026-11-11T12:05:00.000Z',
        },
        gateway
      );

      expect(result2.consent.consentGeneration).toBe(2);
      expect(result2.consent.allowedSourceIds).toEqual([validDocId, validSheetId]);
      expect(updateConnectionGenMock).toHaveBeenCalledWith(workspaceId, 'google_drive', 2);
    });

    it('deduplicates fileIds automatically', async () => {
      const gateway = createMockGateway({
        fetchResponseMap: {
          [validDocId]: {
            status: 200,
            body: {
              id: validDocId,
              name: '중복 테스트 파일',
              mimeType: 'application/vnd.google-apps.document',
              trashed: false,
            },
          },
        },
      });

      const result = await verifyAndRegisterDriveFiles(
        {
          workspaceId,
          actorUserId,
          fileIds: [validDocId, validDocId, validDocId],
        },
        gateway
      );

      expect(result.files).toHaveLength(1);
      expect(result.consent.allowedSourceIds).toEqual([validDocId]);
      expect(gateway.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
