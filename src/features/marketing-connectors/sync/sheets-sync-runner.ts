import 'server-only';
import crypto from 'node:crypto';
import type { SyncExecutionResult, SyncHandler } from './sync-engine';
import type { SyncJobRecord } from './sync-job-repository';
import {
  loadConnectorCredential,
  type CredentialVaultGateway,
} from '../credentials/credential-vault';
import {
  verifySourceAccess,
  type ConsentLedgerGateway,
} from '../consent/consent-ledger';
import {
  saveEvidenceBatch,
  type EvidenceGateway,
  type SaveEvidenceItemInput,
} from '../evidence/evidence-repository';
import {
  fetchGoogleSheetValues,
  type GoogleSheetResult,
  type FetchGoogleSheetInput,
  type GoogleSheetGateway,
} from '../adapters/google-sheets';

export class ConsentAccessDeniedError extends Error {
  readonly code: string;
  readonly reason: string;

  constructor(code: string, reason: string) {
    super(`Access denied for source: [${code}] ${reason}`);
    this.name = 'ConsentAccessDeniedError';
    this.code = code;
    this.reason = reason;
    Object.setPrototypeOf(this, ConsentAccessDeniedError.prototype);
  }
}

export interface ConflictingPrice {
  readonly item: string;
  readonly oldPrice: number;
  readonly newPrice: number;
}

export interface ParsedPriceItem {
  readonly item: string;
  readonly price: number;
}

export interface GoogleSheetsSyncHandlerOptions {
  readonly credentialGateway: CredentialVaultGateway;
  readonly consentGateway: ConsentLedgerGateway;
  readonly evidenceGateway: EvidenceGateway;
  readonly googleSheetGateway?: GoogleSheetGateway;
  readonly keyBase64?: string;
  readonly fetchValues?: (
    input: FetchGoogleSheetInput,
    gateway?: GoogleSheetGateway
  ) => Promise<GoogleSheetResult>;
  readonly existingConfirmedPrices?:
    | Record<string, number>
    | ((workspaceId: string) => Promise<Record<string, number>> | Record<string, number>);
  readonly now?: () => string;
}

/**
 * 텍스트에서 한국어/통화 형식의 가격 숫자를 파싱한다.
 * e.g. "5,000원" -> 5000, "₩12,000" -> 12000, " 3000 " -> 3000
 */
export function parsePriceNumber(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    return raw;
  }
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 통화 기호, 쉼표, '원', 공백 제거
  const cleaned = trimmed.replace(/[₩\\원\s,]/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    return null;
  }

  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0) {
    return null;
  }
  return num;
}

/**
 * 스프레드시트 헤더 및 행 데이터에서 메뉴/상품 항목과 가격을 파싱한다.
 */
export function extractPricesFromSheet(
  headers: string[],
  rows: string[][]
): ParsedPriceItem[] {
  if (!rows || rows.length === 0) return [];

  // 1. 헤더 기반 열 인덱스 탐지
  let itemColIndex = -1;
  let priceColIndex = -1;

  if (headers && headers.length > 0) {
    itemColIndex = headers.findIndex((h) =>
      /메뉴|품목|서비스|상품|항목|이름|item|menu|service|product|name/i.test(h.trim())
    );
    priceColIndex = headers.findIndex((h) =>
      /가격|단가|금액|판매가|정가|원가|price|cost|amount/i.test(h.trim())
    );
  }

  // 2. 헤더에서 찾지 못한 경우 첫 번째 행의 데이터 패턴으로 추정
  if (itemColIndex === -1 || priceColIndex === -1) {
    const sampleRow = rows[0] || [];
    for (let c = 0; c < sampleRow.length; c++) {
      const val = sampleRow[c];
      const parsed = parsePriceNumber(val);
      if (parsed !== null && priceColIndex === -1) {
        priceColIndex = c;
      } else if (typeof val === 'string' && val.trim().length > 0 && itemColIndex === -1) {
        itemColIndex = c;
      }
    }
  }

  // 기본 fallback: 0번 열을 품목, 1번 열을 가격으로 가정
  if (itemColIndex === -1) itemColIndex = 0;
  if (priceColIndex === -1) priceColIndex = 1;

  // 인덱스가 같으면 파싱 불가
  if (itemColIndex === priceColIndex) return [];

  const results: ParsedPriceItem[] = [];
  const seenItems = new Set<string>();

  for (const row of rows) {
    const rawItem = row[itemColIndex];
    const rawPrice = row[priceColIndex];

    if (typeof rawItem !== 'string') continue;
    const item = rawItem.trim();
    if (!item) continue;

    const price = parsePriceNumber(rawPrice);
    if (price === null) continue;

    if (!seenItems.has(item)) {
      seenItems.add(item);
      results.push({ item, price });
    }
  }

  return results;
}

function computeSheetRevision(sheetResult: GoogleSheetResult): string {
  const payload = [
    sheetResult.spreadsheetId,
    sheetResult.range,
    sheetResult.headers.join('|'),
    ...sheetResult.rows.map((r) => r.join('|')),
  ].join('\n');

  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

export class GoogleSheetsSyncHandler implements SyncHandler {
  private readonly credentialGateway: CredentialVaultGateway;
  private readonly consentGateway: ConsentLedgerGateway;
  private readonly evidenceGateway: EvidenceGateway;
  private readonly googleSheetGateway?: GoogleSheetGateway;
  private readonly keyBase64?: string;
  private readonly fetchValues: (
    input: FetchGoogleSheetInput,
    gateway?: GoogleSheetGateway
  ) => Promise<GoogleSheetResult>;
  private readonly existingConfirmedPrices?:
    | Record<string, number>
    | ((workspaceId: string) => Promise<Record<string, number>> | Record<string, number>);
  private readonly nowProvider: () => string;

  constructor(options: GoogleSheetsSyncHandlerOptions) {
    this.credentialGateway = options.credentialGateway;
    this.consentGateway = options.consentGateway;
    this.evidenceGateway = options.evidenceGateway;
    this.googleSheetGateway = options.googleSheetGateway;
    this.keyBase64 = options.keyBase64;
    this.fetchValues = options.fetchValues ?? fetchGoogleSheetValues;
    this.existingConfirmedPrices = options.existingConfirmedPrices;
    this.nowProvider = options.now ?? (() => new Date().toISOString());
  }

  async execute(job: SyncJobRecord): Promise<SyncExecutionResult> {
    const nowIso = this.nowProvider();

    if (job.connectorId !== 'google_sheets') {
      throw new Error(`Invalid connectorId for GoogleSheetsSyncHandler: ${job.connectorId}`);
    }

    // 1. sourceId 파싱 (spreadsheetId!range)
    const sepIndex = job.sourceId.indexOf('!');
    if (sepIndex <= 0) {
      throw new Error(
        `Invalid sourceId format for Google Sheets: expected 'spreadsheetId!range', got '${job.sourceId}'`
      );
    }
    const spreadsheetId = job.sourceId.slice(0, sepIndex);
    const range = job.sourceId.slice(sepIndex + 1);

    // 2. F04 동의 원장에서 allowedSourceIds 검증 (Fail-Closed)
    const consentCheck = await verifySourceAccess(
      {
        workspaceId: job.workspaceId,
        connectorId: job.connectorId,
        sourceId: job.sourceId,
        purpose: 'marketing',
        now: nowIso,
      },
      this.consentGateway
    );

    if (!consentCheck.ok) {
      const code = 'code' in consentCheck ? consentCheck.code : 'ACCESS_DENIED';
      const reason =
        'reason' in consentCheck ? consentCheck.reason : 'Access denied by consent ledger';
      throw new ConsentAccessDeniedError(code, reason);
    }

    // 3. F03 Token Vault에서 해당 세대 access_token 로드
    const credential = await loadConnectorCredential(
      job.workspaceId,
      job.connectorId,
      job.consentGeneration,
      this.credentialGateway,
      { keyBase64: this.keyBase64 }
    );
    const accessToken = credential.accessToken;

    // 4. S01 fetchGoogleSheetValues 호출하여 시트 셀 값 수집
    const sheetResult = await this.fetchValues(
      {
        spreadsheetId,
        range,
        accessToken,
      },
      this.googleSheetGateway
    );

    // 5. 가격표 파싱 및 충돌 감지
    const parsedPrices = extractPricesFromSheet(sheetResult.headers, sheetResult.rows);

    let confirmedPrices: Record<string, number> = {};
    if (this.existingConfirmedPrices) {
      if (typeof this.existingConfirmedPrices === 'function') {
        confirmedPrices = await this.existingConfirmedPrices(job.workspaceId);
      } else {
        confirmedPrices = this.existingConfirmedPrices;
      }
    }

    const conflictingPrices: ConflictingPrice[] = [];
    for (const item of parsedPrices) {
      const oldPrice = confirmedPrices[item.item];
      if (typeof oldPrice === 'number' && oldPrice !== item.price) {
        conflictingPrices.push({
          item: item.item,
          oldPrice,
          newPrice: item.price,
        });
      }
    }

    const hasPriceConflict = conflictingPrices.length > 0;
    const revision = computeSheetRevision(sheetResult);
    const expiresAt = consentCheck.record.validUntil;

    // 6. K01 원장에 보존할 후보 근거 Evidence 생성
    // 텍스트는 표 형태의 마크다운/텍스트 요약
    const headerLine = sheetResult.headers.join(' | ');
    const bodyLines = sheetResult.rows.map((r) => r.join(' | ')).join('\n');
    const fullText = `[Google Sheets: ${job.sourceId}]\n${headerLine}\n${bodyLines}`.trim();

    const metadata: Record<string, unknown> = {
      spreadsheetId,
      range,
      rowCount: sheetResult.rowCount,
      columnCount: sheetResult.columnCount,
      headers: sheetResult.headers,
      hasPriceConflict,
      priceConflict: hasPriceConflict,
      conflictingPrices,
      parsedPrices,
      derivedFromGoogle: true,
      warnings: sheetResult.warnings,
      truncated: sheetResult.truncated,
    };

    const evidenceItem: SaveEvidenceItemInput = {
      workspaceId: job.workspaceId,
      connectorId: job.connectorId,
      sourceId: job.sourceId,
      revision,
      consentGeneration: job.consentGeneration,
      observedAt: nowIso,
      expiresAt,
      purpose: 'marketing',
      text: fullText,
      derivedFromGoogle: true,
      revokedAt: null,
      metadata,
    };

    const savedRecords = await saveEvidenceBatch(
      {
        workspaceId: job.workspaceId,
        connectorId: job.connectorId,
        purpose: 'marketing',
        now: nowIso,
        items: [evidenceItem],
      },
      this.evidenceGateway
    );

    return {
      stats: {
        rowCount: sheetResult.rowCount,
        columnCount: sheetResult.columnCount,
        parsedItemCount: parsedPrices.length,
        hasPriceConflict,
        conflictCount: conflictingPrices.length,
        savedCount: savedRecords.length,
      },
    };
  }
}
