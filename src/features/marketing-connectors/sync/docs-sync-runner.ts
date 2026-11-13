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
  fetchGoogleDocument,
  GoogleDocError,
  type GoogleDocResult,
  type FetchGoogleDocInput,
  type GoogleDocGateway,
} from '../adapters/google-docs';

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

export interface GoogleDocsSyncHandlerOptions {
  readonly credentialGateway: CredentialVaultGateway;
  readonly consentGateway: ConsentLedgerGateway;
  readonly evidenceGateway: EvidenceGateway;
  readonly googleDocGateway?: GoogleDocGateway;
  readonly keyBase64?: string;
  readonly fetchDoc?: (
    input: FetchGoogleDocInput,
    gateway?: GoogleDocGateway
  ) => Promise<GoogleDocResult>;
  readonly now?: () => string;
}

function computeDocRevisionFallback(docResult: GoogleDocResult): string {
  const payload = [
    docResult.documentId,
    docResult.title,
    ...docResult.tabs.map((t) => `${t.tabId}:${t.title}:${t.text}`),
  ].join('\n');

  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

export class GoogleDocsSyncHandler implements SyncHandler {
  private readonly credentialGateway: CredentialVaultGateway;
  private readonly consentGateway: ConsentLedgerGateway;
  private readonly evidenceGateway: EvidenceGateway;
  private readonly googleDocGateway?: GoogleDocGateway;
  private readonly keyBase64?: string;
  private readonly fetchDoc: (
    input: FetchGoogleDocInput,
    gateway?: GoogleDocGateway
  ) => Promise<GoogleDocResult>;
  private readonly nowProvider: () => string;

  constructor(options: GoogleDocsSyncHandlerOptions) {
    this.credentialGateway = options.credentialGateway;
    this.consentGateway = options.consentGateway;
    this.evidenceGateway = options.evidenceGateway;
    this.googleDocGateway = options.googleDocGateway;
    this.keyBase64 = options.keyBase64;
    this.fetchDoc = options.fetchDoc ?? fetchGoogleDocument;
    this.nowProvider = options.now ?? (() => new Date().toISOString());
  }

  async execute(job: SyncJobRecord): Promise<SyncExecutionResult> {
    const nowIso = this.nowProvider();

    if (job.connectorId !== 'google_docs') {
      throw new Error(`Invalid connectorId for GoogleDocsSyncHandler: ${job.connectorId}`);
    }

    const documentId = job.sourceId.trim();
    if (!documentId) {
      throw new Error('sourceId must be a valid Google Docs documentId');
    }

    // 1. F04 동의 원장에서 allowedSourceIds 검증 (Fail-Closed)
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

    // 2. F03 Token Vault에서 해당 세대 access_token 로드
    const credential = await loadConnectorCredential(
      job.workspaceId,
      job.connectorId,
      job.consentGeneration,
      this.credentialGateway,
      { keyBase64: this.keyBase64 }
    );
    const accessToken = credential.accessToken;

    // 3. D02 fetchGoogleDocument 호출하여 문서 탭/본문/표 데이터 파싱
    let docResult: GoogleDocResult;
    try {
      docResult = await this.fetchDoc(
        {
          documentId,
          accessToken,
        },
        this.googleDocGateway
      );
    } catch (err: unknown) {
      // 4. 파일 삭제(404) 또는 권한 회수(403) 발생 시 K01 원장의 기존 근거 무효화 (Fail-Closed)
      const isNotFound =
        (err instanceof GoogleDocError && (err.code === 'DOCUMENT_NOT_FOUND' || err.status === 404)) ||
        (typeof err === 'object' &&
          err !== null &&
          ('status' in err || 'statusCode' in err || 'code' in err) &&
          ((err as { status?: number; statusCode?: number; code?: string }).status === 404 ||
            (err as { status?: number; statusCode?: number; code?: string }).statusCode === 404 ||
            (err as { status?: number; statusCode?: number; code?: string }).code === 'DOCUMENT_NOT_FOUND'));

      const isForbidden =
        (err instanceof GoogleDocError && (err.code === 'ACCESS_DENIED' || err.status === 403)) ||
        (typeof err === 'object' &&
          err !== null &&
          ('status' in err || 'statusCode' in err || 'code' in err) &&
          ((err as { status?: number; statusCode?: number; code?: string }).status === 403 ||
            (err as { status?: number; statusCode?: number; code?: string }).statusCode === 403 ||
            (err as { status?: number; statusCode?: number; code?: string }).code === 'ACCESS_DENIED'));

      if (isNotFound || isForbidden) {
        if (typeof this.evidenceGateway.revokeEvidenceBySource === 'function') {
          await this.evidenceGateway.revokeEvidenceBySource(
            job.workspaceId,
            job.connectorId,
            job.sourceId,
            nowIso
          );
        }
      }

      throw err;
    }

    // 5. 파일 revision 변경 감지
    const effectiveRevision = docResult.revisionId || computeDocRevisionFallback(docResult);
    const isUnchanged = Boolean(
      docResult.revisionId && job.cursor && docResult.revisionId === job.cursor
    );

    if (isUnchanged) {
      return {
        stats: {
          fetchedTabCount: docResult.tabs.length,
          totalCharCount: docResult.totalCharCount,
          isChanged: false,
        },
        cursor: docResult.revisionId ?? job.cursor ?? null,
      };
    }

    // 6. 변경 시 K01 원장에 후보 근거(saveEvidenceBatch) 영속화
    const tabTexts = docResult.tabs
      .map((t) => `[Tab: ${t.title}]\n${t.text}`.trim())
      .filter((t) => t.length > 0)
      .join('\n\n');
    const fullText = `[Google Docs: ${docResult.title}]\n${tabTexts}`.trim();

    const expiresAt = consentCheck.record.validUntil;

    const metadata: Record<string, unknown> = {
      documentId,
      title: docResult.title,
      revisionId: docResult.revisionId,
      tabCount: docResult.tabs.length,
      totalCharCount: docResult.totalCharCount,
      truncated: docResult.truncated,
      warnings: docResult.warnings,
      derivedFromGoogle: true,
      tabs: docResult.tabs.map((t) => ({
        tabId: t.tabId,
        title: t.title,
        charCount: t.charCount,
      })),
    };

    const evidenceItem: SaveEvidenceItemInput = {
      workspaceId: job.workspaceId,
      connectorId: job.connectorId,
      sourceId: job.sourceId,
      revision: effectiveRevision,
      consentGeneration: job.consentGeneration,
      observedAt: nowIso,
      expiresAt,
      purpose: 'marketing',
      text: fullText,
      derivedFromGoogle: true,
      revokedAt: null,
      metadata,
    };

    await saveEvidenceBatch(
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
        fetchedTabCount: docResult.tabs.length,
        totalCharCount: docResult.totalCharCount,
        isChanged: true,
      },
      cursor: docResult.revisionId ?? job.cursor ?? null,
    };
  }
}
