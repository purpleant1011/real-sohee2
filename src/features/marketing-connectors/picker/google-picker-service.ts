import 'server-only';

import type { ConnectorId } from '../catalog';
import {
  recordConsentGrant,
  type ConsentLedgerGateway,
  type ConsentPurpose,
  type MarketingConsentRecord,
} from '../consent/consent-ledger';

export const SUPPORTED_DRIVE_MIME_TYPES = [
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
] as const;

export type SupportedDriveMimeType = (typeof SUPPORTED_DRIVE_MIME_TYPES)[number];

export type GoogleDrivePickerErrorCode =
  | 'INVALID_INPUT'
  | 'EMPTY_FILE_IDS'
  | 'INVALID_FILE_ID'
  | 'TOKEN_NOT_FOUND'
  | 'FILE_NOT_FOUND'
  | 'ACCESS_DENIED'
  | 'INVALID_CREDENTIALS'
  | 'RATE_LIMITED'
  | 'TRASHED_FILE'
  | 'UNSUPPORTED_MIME_TYPE'
  | 'GOOGLE_DRIVE_API_ERROR'
  | 'INTERNAL_ERROR';

export class GoogleDrivePickerError extends Error {
  readonly code: GoogleDrivePickerErrorCode;
  readonly status?: number;
  readonly fileId?: string;

  constructor(
    code: GoogleDrivePickerErrorCode,
    message: string,
    options?: { status?: number; fileId?: string }
  ) {
    super(message);
    this.name = 'GoogleDrivePickerError';
    this.code = code;
    this.status = options?.status;
    this.fileId = options?.fileId;
    Object.setPrototypeOf(this, GoogleDrivePickerError.prototype);
  }
}

export interface DriveFileItem {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size?: string | number | null;
  readonly trashed?: boolean;
}

export interface VerifyDriveFilesInput {
  readonly workspaceId: string;
  readonly actorUserId: string;
  readonly fileIds: readonly string[];
  readonly now?: string;
  readonly purpose?: ConsentPurpose;
  readonly aiProcessingApproved?: boolean;
  readonly validUntil?: string;
  readonly connectorId?: ConnectorId;
}

export interface DriveFileGateway {
  getAccessToken(workspaceId: string): Promise<string | null>;
  fetchFileMetadata?(fileId: string, accessToken: string): Promise<DriveFileItem>;
  fetch?: typeof fetch;
  consentLedgerGateway?: ConsentLedgerGateway;
  updateConnectionGeneration?(
    workspaceId: string,
    connectorId: ConnectorId,
    generation: number
  ): Promise<void>;
}

export interface VerifyDriveFilesResult {
  readonly ok: true;
  readonly files: readonly DriveFileItem[];
  readonly consent: MarketingConsentRecord;
}

/**
 * Google Drive drive.file scope 기반으로 클라이언트 Picker에서 선택된 파일 ID 목록을 검증하고,
 * trashed 여부, mimeType, 접근 권한을 확인한 뒤 F04 동의 원장(allowedSourceIds)에 등록한다.
 */
export async function verifyAndRegisterDriveFiles(
  input: VerifyDriveFilesInput,
  gateway: DriveFileGateway
): Promise<VerifyDriveFilesResult> {
  // 1. workspaceId 검증
  if (!input.workspaceId || typeof input.workspaceId !== 'string' || !input.workspaceId.trim()) {
    throw new GoogleDrivePickerError(
      'INVALID_INPUT',
      '유효한 작업공간 식별자가 필요합니다.',
      { status: 400 }
    );
  }
  const workspaceId = input.workspaceId.trim();

  // 2. actorUserId 검증
  if (!input.actorUserId || typeof input.actorUserId !== 'string' || !input.actorUserId.trim()) {
    throw new GoogleDrivePickerError(
      'INVALID_INPUT',
      '유효한 사용자 식별자가 필요합니다.',
      { status: 400 }
    );
  }
  const actorUserId = input.actorUserId.trim();

  // 3. fileIds 목록 검증
  if (!Array.isArray(input.fileIds) || input.fileIds.length === 0) {
    throw new GoogleDrivePickerError(
      'EMPTY_FILE_IDS',
      '하나 이상의 파일 ID를 선택해야 합니다.',
      { status: 400 }
    );
  }

  const sanitizedFileIds: string[] = [];
  for (const rawId of input.fileIds) {
    if (typeof rawId !== 'string' || !rawId.trim()) {
      throw new GoogleDrivePickerError(
        'INVALID_FILE_ID',
        '유효하지 않은 파일 식별자가 포함되어 있습니다.',
        { status: 400 }
      );
    }
    const trimmed = rawId.trim();
    if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
      throw new GoogleDrivePickerError(
        'INVALID_FILE_ID',
        '파일 식별자 형식이 올바르지 않습니다.',
        { status: 400 }
      );
    }
    sanitizedFileIds.push(trimmed);
  }

  // 중복 파일 ID 제거
  const uniqueFileIds = Array.from(new Set(sanitizedFileIds));

  // 4. 액세스 토큰 획득
  const accessToken = await gateway.getAccessToken(workspaceId);
  if (!accessToken || !accessToken.trim()) {
    throw new GoogleDrivePickerError(
      'TOKEN_NOT_FOUND',
      'Google 연동 토큰을 찾을 수 없습니다.',
      { status: 401 }
    );
  }

  // 5. 각 파일 메타데이터 조회 및 검증
  const fetchFn = gateway.fetch ?? fetch;
  const verifiedFiles: DriveFileItem[] = [];

  for (const fileId of uniqueFileIds) {
    let fileItem: DriveFileItem;

    if (gateway.fetchFileMetadata) {
      fileItem = await gateway.fetchFileMetadata(fileId, accessToken);
    } else {
      const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileId
      )}?fields=${encodeURIComponent('id,name,mimeType,size,trashed')}`;

      let response: Response;
      try {
        response = await fetchFn(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken.trim()}`,
            Accept: 'application/json',
          },
        });
      } catch (err: unknown) {
        throw new GoogleDrivePickerError(
          'GOOGLE_DRIVE_API_ERROR',
          `Google Drive API 네트워크 오류: ${err instanceof Error ? err.message : String(err)}`,
          { status: 500, fileId }
        );
      }

      if (!response.ok) {
        if (response.status === 404) {
          throw new GoogleDrivePickerError(
            'FILE_NOT_FOUND',
            `파일을 찾을 수 없거나 접근 권한이 없습니다: ${fileId}`,
            { status: 404, fileId }
          );
        }
        if (response.status === 403) {
          throw new GoogleDrivePickerError(
            'ACCESS_DENIED',
            `파일 접근 권한이 없습니다: ${fileId}`,
            { status: 403, fileId }
          );
        }
        if (response.status === 401) {
          throw new GoogleDrivePickerError(
            'INVALID_CREDENTIALS',
            'Google 계정 인증이 유효하지 않습니다. 다시 연동해 주세요.',
            { status: 401, fileId }
          );
        }
        if (response.status === 429) {
          throw new GoogleDrivePickerError(
            'RATE_LIMITED',
            'Google Drive API 호출 한도를 초과했습니다.',
            { status: 429, fileId }
          );
        }
        throw new GoogleDrivePickerError(
          'GOOGLE_DRIVE_API_ERROR',
          `Google Drive API 오류 (${response.status})`,
          { status: response.status, fileId }
        );
      }

      try {
        fileItem = (await response.json()) as DriveFileItem;
      } catch {
        throw new GoogleDrivePickerError(
          'GOOGLE_DRIVE_API_ERROR',
          'Google Drive 응답 JSON 파싱 실패',
          { status: 502, fileId }
        );
      }
    }

    // trashed === true 거부
    if (fileItem.trashed === true) {
      throw new GoogleDrivePickerError(
        'TRASHED_FILE',
        `휴지통에 있는 파일은 선택할 수 없습니다: ${fileId}`,
        { status: 400, fileId }
      );
    }

    // 지원 mimeType 검증
    if (
      !SUPPORTED_DRIVE_MIME_TYPES.includes(
        fileItem.mimeType as SupportedDriveMimeType
      )
    ) {
      throw new GoogleDrivePickerError(
        'UNSUPPORTED_MIME_TYPE',
        `지원되지 않는 파일 형식입니다 (${fileItem.mimeType}): ${fileId}`,
        { status: 400, fileId }
      );
    }

    verifiedFiles.push(fileItem);
  }

  // 6. F04 동의 원장(allowedSourceIds) 등록 및 세대 갱신
  if (!gateway.consentLedgerGateway) {
    throw new GoogleDrivePickerError(
      'INTERNAL_ERROR',
      'ConsentLedgerGateway가 제공되지 않았습니다.',
      { status: 500 }
    );
  }

  const connectorId: ConnectorId = input.connectorId ?? 'google_drive';
  const effectiveNowIso = input.now ?? new Date().toISOString();
  const validUntil =
    input.validUntil ??
    new Date(Date.parse(effectiveNowIso) + 30 * 24 * 60 * 60 * 1000).toISOString();

  const consent = await recordConsentGrant(
    {
      workspaceId,
      connectorId,
      allowedSourceIds: verifiedFiles.map((f) => f.id),
      purpose: input.purpose ?? 'marketing',
      validUntil,
      aiProcessingApproved: input.aiProcessingApproved ?? true,
      actorUserId,
      now: effectiveNowIso,
    },
    gateway.consentLedgerGateway
  );

  // 7. connection 테이블의 consentGeneration 갱신 콜백 호출
  if (gateway.updateConnectionGeneration) {
    await gateway.updateConnectionGeneration(
      workspaceId,
      connectorId,
      consent.consentGeneration
    );
  }

  return {
    ok: true,
    files: verifiedFiles,
    consent,
  };
}
