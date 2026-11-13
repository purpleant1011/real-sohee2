import 'server-only';

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
  fetchGmailMessages,
  fetchGmailHistory,
  fetchSingleGmailMessage,
  GmailError,
  type FetchGmailInput,
  type FetchGmailHistoryInput,
  type GmailMessagesResult,
  type GmailHistoryResult,
  type GmailMessageItem,
  type GmailGateway,
} from '../adapters/gmail';

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

export interface GmailSyncHandlerOptions {
  readonly credentialGateway: CredentialVaultGateway;
  readonly consentGateway: ConsentLedgerGateway;
  readonly evidenceGateway: EvidenceGateway;
  readonly keyBase64?: string;
  readonly gmailGateway?: GmailGateway;
  readonly fetchMessages?: (
    input: FetchGmailInput,
    gateway?: GmailGateway
  ) => Promise<GmailMessagesResult>;
  readonly fetchHistory?: (
    input: FetchGmailHistoryInput,
    gateway?: GmailGateway
  ) => Promise<GmailHistoryResult>;
  readonly fetchSingleMessage?: (
    id: string,
    accessToken: string,
    gateway?: GmailGateway
  ) => Promise<GmailMessageItem>;
  readonly newerThanDays?: number;
  readonly maxMessages?: number;
  readonly now?: () => string;
}

export class GmailSyncHandler implements SyncHandler {
  private readonly credentialGateway: CredentialVaultGateway;
  private readonly consentGateway: ConsentLedgerGateway;
  private readonly evidenceGateway: EvidenceGateway;
  private readonly keyBase64?: string;
  private readonly gmailGateway?: GmailGateway;
  private readonly fetchMessagesFn: (
    input: FetchGmailInput,
    gateway?: GmailGateway
  ) => Promise<GmailMessagesResult>;
  private readonly fetchHistoryFn: (
    input: FetchGmailHistoryInput,
    gateway?: GmailGateway
  ) => Promise<GmailHistoryResult>;
  private readonly fetchSingleFn: (
    id: string,
    accessToken: string,
    gateway?: GmailGateway
  ) => Promise<GmailMessageItem>;
  private readonly newerThanDays: number;
  private readonly maxMessages: number;
  private readonly nowProvider: () => string;

  constructor(options: GmailSyncHandlerOptions) {
    this.credentialGateway = options.credentialGateway;
    this.consentGateway = options.consentGateway;
    this.evidenceGateway = options.evidenceGateway;
    this.keyBase64 = options.keyBase64;
    this.gmailGateway = options.gmailGateway;
    this.fetchMessagesFn = options.fetchMessages ?? fetchGmailMessages;
    this.fetchHistoryFn = options.fetchHistory ?? fetchGmailHistory;
    this.fetchSingleFn = options.fetchSingleMessage ?? fetchSingleGmailMessage;
    this.newerThanDays = options.newerThanDays ?? 30;
    this.maxMessages = options.maxMessages ?? 20;
    this.nowProvider = options.now ?? (() => new Date().toISOString());
  }

  async execute(job: SyncJobRecord): Promise<SyncExecutionResult> {
    const nowIso = this.nowProvider();

    if (job.connectorId !== 'gmail') {
      throw new Error(`Invalid connectorId for GmailSyncHandler: ${job.connectorId}`);
    }

    // 1. F04 동의 원장에서 sourceId (labelId) 허용 여부 검증
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

    // 2. F03 Token Vault에서 access_token 로드
    const credential = await loadConnectorCredential(
      job.workspaceId,
      job.connectorId,
      job.consentGeneration,
      this.credentialGateway,
      { keyBase64: this.keyBase64 }
    );
    const accessToken = credential.accessToken;

    let collectedMessages: GmailMessageItem[] = [];
    let deletedCount = 0;
    let nextCursor: string | null | undefined = job.cursor;

    // 3. Incremental vs Full 조회
    if (job.cursor) {
      try {
        const historyResult = await this.fetchHistoryFn(
          {
            accessToken,
            startHistoryId: job.cursor,
            labelId: job.sourceId,
            maxResults: this.maxMessages,
          },
          this.gmailGateway
        );

        nextCursor = historyResult.historyId;

        // 삭제된 메시지 처리 (수신 취소 / 삭제)
        if (historyResult.deletedMessageIds.length > 0) {
          deletedCount = historyResult.deletedMessageIds.length;
          if (typeof this.evidenceGateway.revokeEvidenceBySource === 'function') {
            for (const delId of historyResult.deletedMessageIds) {
              await this.evidenceGateway.revokeEvidenceBySource(
                job.workspaceId,
                job.connectorId,
                delId,
                nowIso
              );
            }
          }
        }

        // 신규/수정 메시지 단건 fetch
        if (historyResult.addedMessageIds.length > 0) {
          const fetchSinglePromises = historyResult.addedMessageIds.map((msgId) =>
            this.fetchSingleFn(msgId, accessToken, this.gmailGateway).catch(() => {
              // 개별 메시지가 삭제되었거나 가져올 수 없는 경우 무시
              return null;
            })
          );
          const singleResults = await Promise.all(fetchSinglePromises);
          collectedMessages = singleResults.filter(
            (msg): msg is GmailMessageItem => msg !== null
          );
        }
      } catch (err: unknown) {
        // 404 HISTORY_EXPIRED 발생 시 Full resync fallback
        if (
          err instanceof GmailError &&
          (err.code === 'HISTORY_EXPIRED' || err.status === 404)
        ) {
          const fullResult = await this.fetchMessagesFn(
            {
              accessToken,
              labelId: job.sourceId,
              newerThanDays: this.newerThanDays,
              maxMessages: this.maxMessages,
            },
            this.gmailGateway
          );
          collectedMessages = [...fullResult.messages];
          nextCursor = fullResult.latestHistoryId || nextCursor;
        } else {
          throw err;
        }
      }
    } else {
      // Full Sync
      const fullResult = await this.fetchMessagesFn(
        {
          accessToken,
          labelId: job.sourceId,
          newerThanDays: this.newerThanDays,
          maxMessages: this.maxMessages,
        },
        this.gmailGateway
      );
      collectedMessages = [...fullResult.messages];
      nextCursor = fullResult.latestHistoryId || nextCursor;
    }

    // 4. K01 원장에 후보 근거 영속 저장 (saveEvidenceBatch)
    if (collectedMessages.length > 0) {
      const expiresAt = consentCheck.record.validUntil;

      const items: SaveEvidenceItemInput[] = collectedMessages.map((item) => {
        const text = `[Gmail] ${item.subject} (From: ${item.from}) - ${item.bodyText}`;
        return {
          workspaceId: job.workspaceId,
          connectorId: job.connectorId,
          sourceId: item.id,
          revision: item.historyId || item.id,
          consentGeneration: job.consentGeneration,
          observedAt: nowIso,
          expiresAt,
          purpose: 'marketing',
          derivedFromGoogle: true,
          text,
          metadata: {
            messageId: item.id,
            threadId: item.threadId,
            labelIds: item.labelIds,
            date: item.date,
            subject: item.subject,
            from: item.from,
            historyId: item.historyId,
            senderName: item.senderName,
            senderEmailMasked: item.senderEmailMasked,
          },
        };
      });

      await saveEvidenceBatch(
        {
          workspaceId: job.workspaceId,
          connectorId: job.connectorId,
          purpose: 'marketing',
          now: nowIso,
          items,
        },
        this.evidenceGateway
      );
    }

    return {
      stats: {
        fetchedCount: collectedMessages.length,
        messageIds: collectedMessages.map((m) => m.id),
        deletedCount,
      },
      cursor: nextCursor ?? null,
    };
  }
}
