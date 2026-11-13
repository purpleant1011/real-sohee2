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
  fetchCalendarEvents,
  type CalendarEventItem,
  type CalendarEventsData,
  type FetchCalendarEventsInput,
} from '../adapters/google-calendar';
import type { GoogleAdapterResult, InjectedFetch } from '../adapters/google-adapter-common';

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

export interface GoogleCalendarSyncHandlerOptions {
  readonly credentialGateway: CredentialVaultGateway;
  readonly consentGateway: ConsentLedgerGateway;
  readonly evidenceGateway: EvidenceGateway;
  readonly keyBase64?: string;
  readonly fetchEvents?: (
    input: FetchCalendarEventsInput
  ) => Promise<GoogleAdapterResult<CalendarEventsData>>;
  readonly injectedFetch?: InjectedFetch;
  readonly now?: () => string;
  readonly defaultWindowDays?: {
    readonly pastDays?: number;
    readonly futureDays?: number;
  };
}

function computeEventRevision(item: CalendarEventItem): string {
  if (item.kind === 'tombstone') {
    return 'cancelled';
  }
  const payload =
    item.kind === 'timed'
      ? `${item.id}|${item.summary}|${item.start}|${item.end}|${item.status}`
      : `${item.id}|${item.summary}|${item.startDate}|${item.endDate}|${item.status}`;
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

export class GoogleCalendarSyncHandler implements SyncHandler {
  private readonly credentialGateway: CredentialVaultGateway;
  private readonly consentGateway: ConsentLedgerGateway;
  private readonly evidenceGateway: EvidenceGateway;
  private readonly keyBase64?: string;
  private readonly fetchEvents: (
    input: FetchCalendarEventsInput
  ) => Promise<GoogleAdapterResult<CalendarEventsData>>;
  private readonly injectedFetch?: InjectedFetch;
  private readonly nowProvider: () => string;
  private readonly pastDays: number;
  private readonly futureDays: number;

  constructor(options: GoogleCalendarSyncHandlerOptions) {
    this.credentialGateway = options.credentialGateway;
    this.consentGateway = options.consentGateway;
    this.evidenceGateway = options.evidenceGateway;
    this.keyBase64 = options.keyBase64;
    this.fetchEvents = options.fetchEvents ?? fetchCalendarEvents;
    this.injectedFetch = options.injectedFetch;
    this.nowProvider = options.now ?? (() => new Date().toISOString());
    this.pastDays = options.defaultWindowDays?.pastDays ?? 30;
    this.futureDays = options.defaultWindowDays?.futureDays ?? 90;
  }

  async execute(job: SyncJobRecord): Promise<SyncExecutionResult> {
    const nowIso = this.nowProvider();
    const nowEpoch = Date.parse(nowIso);

    if (job.connectorId !== 'google_calendar') {
      throw new Error(`Invalid connectorId for GoogleCalendarSyncHandler: ${job.connectorId}`);
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
      const reason = 'reason' in consentCheck ? consentCheck.reason : 'Access denied by consent ledger';
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

    // 3. fetchCalendarEvents 호출 (incremental 또는 full)
    const timeMin = new Date(nowEpoch - this.pastDays * 86400000).toISOString();
    const timeMax = new Date(nowEpoch + this.futureDays * 86400000).toISOString();

    let isFullResync = false;
    let fetchResult: GoogleAdapterResult<CalendarEventsData>;

    if (job.cursor) {
      // Incremental Sync
      fetchResult = await this.fetchEvents({
        mode: 'incremental',
        calendarId: job.sourceId,
        accessToken,
        syncToken: job.cursor,
        injectedFetch: this.injectedFetch,
      });

      // 410 (sync_expired) 에러 시 즉시 Full Sync로 Fallback
      if (
        !fetchResult.ok &&
        (fetchResult.error.code === 'sync_expired' || fetchResult.error.status === 410)
      ) {
        isFullResync = true;
        fetchResult = await this.fetchEvents({
          mode: 'full',
          calendarId: job.sourceId,
          accessToken,
          timeMin,
          timeMax,
          injectedFetch: this.injectedFetch,
        });
      }
    } else {
      // Full Sync
      fetchResult = await this.fetchEvents({
        mode: 'full',
        calendarId: job.sourceId,
        accessToken,
        timeMin,
        timeMax,
        injectedFetch: this.injectedFetch,
      });
    }

    if (!fetchResult.ok) {
      const err = new Error(
        `Google Calendar API request failed: [${fetchResult.error.code}] ${fetchResult.error.message}`
      );
      (err as unknown as Record<string, unknown>).code = fetchResult.error.code;
      (err as unknown as Record<string, unknown>).statusCode = fetchResult.error.status;
      throw err;
    }

    const events = fetchResult.data.items;
    const expiresAt = consentCheck.record.validUntil;

    // 4. 수집된 이벤트 목록을 K01 Evidence 항목으로 변환
    const evidenceItems: SaveEvidenceItemInput[] = [];

    for (const item of events) {
      const isCancelled = item.kind === 'tombstone';
      const eventRevision = computeEventRevision(item);

      let text: string;
      const metadata: Record<string, unknown> = {
        calendarId: job.sourceId,
        eventId: item.id,
        status: item.status,
      };

      if (isCancelled) {
        text = `[Google Calendar] [Cancelled] Event ${item.id}`;
        metadata.tombstone = true;

        // 원장에 기존 레코드가 있는 경우 무효화
        if (typeof this.evidenceGateway.revokeEvidenceBySource === 'function') {
          await this.evidenceGateway.revokeEvidenceBySource(
            job.workspaceId,
            job.connectorId,
            item.id,
            nowIso
          );
        }
      } else if (item.kind === 'timed') {
        text = `[Google Calendar] ${item.summary} (${item.start} ~ ${item.end})`;
        metadata.summary = item.summary;
        metadata.start = item.start;
        metadata.end = item.end;
        if (item.startTimeZone) metadata.startTimeZone = item.startTimeZone;
        if (item.endTimeZone) metadata.endTimeZone = item.endTimeZone;
      } else {
        // all_day
        text = `[Google Calendar] ${item.summary} (${item.startDate} ~ ${item.endDate})`;
        metadata.summary = item.summary;
        metadata.startDate = item.startDate;
        metadata.endDate = item.endDate;
      }

      evidenceItems.push({
        workspaceId: job.workspaceId,
        connectorId: job.connectorId,
        sourceId: item.id,
        revision: eventRevision,
        consentGeneration: job.consentGeneration,
        observedAt: nowIso,
        expiresAt,
        purpose: 'marketing',
        text,
        derivedFromGoogle: true,
        revokedAt: isCancelled ? nowIso : null,
        metadata,
      });
    }

    // 5. K01 saveEvidenceBatch를 통해 marketing_connector_evidence에 영속화
    const savedRecords = await saveEvidenceBatch(
      {
        workspaceId: job.workspaceId,
        connectorId: job.connectorId,
        purpose: 'marketing',
        now: nowIso,
        items: evidenceItems,
      },
      this.evidenceGateway
    );

    const nextToken = fetchResult.nextSyncToken ?? null;

    return {
      stats: {
        fetchedCount: events.length,
        savedCount: savedRecords.length,
        isFullResync,
      },
      nextSyncToken: nextToken,
      cursor: nextToken,
    };
  }
}
