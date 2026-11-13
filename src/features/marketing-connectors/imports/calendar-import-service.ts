import 'server-only';
import crypto from 'node:crypto';
import type { ConnectorId } from '../catalog';
import {
  recordConsentGrant,
  type ConsentLedgerGateway,
} from '../consent/consent-ledger';

export type CalendarImportErrorCode =
  | 'INVALID_WORKSPACE_ID'
  | 'INVALID_ACTOR_USER_ID'
  | 'EMPTY_EVENTS'
  | 'LIMIT_EXCEEDED'
  | 'INVALID_EVENT'
  | 'INVALID_ISO_DATE'
  | 'START_AFTER_END'
  | 'TITLE_TOO_LONG'
  | 'TITLE_EMPTY'
  | 'INVALID_TIMEZONE';

export class CalendarImportValidationError extends Error {
  readonly code: CalendarImportErrorCode;

  constructor(code: CalendarImportErrorCode, message: string) {
    super(message);
    this.name = 'CalendarImportValidationError';
    this.code = code;
    Object.setPrototypeOf(this, CalendarImportValidationError.prototype);
  }
}

export interface ImportedCalendarEventInput {
  id?: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timeZone?: string;
  startDate?: string;
  endDateExclusive?: string;
}

export interface SaveImportedCalendarEventsInput {
  workspaceId: string;
  events: readonly ImportedCalendarEventInput[];
  actorUserId: string;
  timeZone?: string;
  sourceHash?: string;
  now?: string;
}

export interface CalendarImportEvidenceRow {
  id: string;
  workspaceId: string;
  connectorId: ConnectorId;
  sourceId: string;
  revision: string;
  consentGeneration: number;
  observedAt: string;
  expiresAt: string;
  purpose: 'marketing' | 'booking';
  text: string;
  derivedFromGoogle: boolean;
  revokedAt: string | null;
  metadata: Record<string, unknown>;
}

export interface CalendarImportGateway {
  consentLedger: ConsentLedgerGateway;
  saveEvidence(rows: readonly CalendarImportEvidenceRow[]): Promise<void>;
  updateConnection?(params: {
    workspaceId: string;
    connectorId: ConnectorId;
    status: 'connected';
    consentGeneration: number;
    lastSyncAt: string;
  }): Promise<void>;
}

export interface CalendarImportResult {
  ok: true;
  workspaceId: string;
  connectorId: 'apple_calendar';
  sourceId: string;
  consentGeneration: number;
  importedCount: number;
  validUntil: string;
  evidenceIds: readonly string[];
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;
const MAX_IMPORT_EVENTS = 100;
const MAX_TITLE_LENGTH = 200;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || timeZone.trim().length === 0) {
    return false;
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timeZone.trim() });
    return true;
  } catch {
    return false;
  }
}

function isValidIsoDateString(val: unknown): val is string {
  if (typeof val !== 'string' || !ISO_DATE_REGEX.test(val)) {
    return false;
  }
  const timestamp = Date.parse(val);
  return !Number.isNaN(timestamp);
}

interface ValidatedEvent {
  id?: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timeZone?: string;
}

function validateAndNormalizeEvents(
  events: readonly ImportedCalendarEventInput[],
  defaultTimeZone?: string
): ValidatedEvent[] {
  if (!Array.isArray(events) || events.length === 0) {
    throw new CalendarImportValidationError(
      'EMPTY_EVENTS',
      '가져올 일정이 없습니다. 1개 이상의 일정을 선택해 주세요.'
    );
  }

  if (events.length > MAX_IMPORT_EVENTS) {
    throw new CalendarImportValidationError(
      'LIMIT_EXCEEDED',
      `한 번에 가져올 수 있는 최대 일정 개수는 ${MAX_IMPORT_EVENTS}개입니다.`
    );
  }

  if (defaultTimeZone !== undefined && !isValidTimeZone(defaultTimeZone)) {
    throw new CalendarImportValidationError(
      'INVALID_TIMEZONE',
      `유효하지 않은 시간대(timeZone)입니다: ${defaultTimeZone}`
    );
  }

  const normalized: ValidatedEvent[] = [];

  for (let i = 0; i < events.length; i++) {
    const raw = events[i];
    if (!raw || typeof raw !== 'object') {
      throw new CalendarImportValidationError(
        'INVALID_EVENT',
        `#${i + 1} 번째 일정 데이터 형식이 올바르지 않습니다.`
      );
    }

    if (typeof raw.title !== 'string') {
      throw new CalendarImportValidationError(
        'TITLE_EMPTY',
        `#${i + 1} 번째 일정의 제목이 필요합니다.`
      );
    }

    const trimmedTitle = raw.title.trim();
    if (trimmedTitle.length === 0) {
      throw new CalendarImportValidationError(
        'TITLE_EMPTY',
        `#${i + 1} 번째 일정의 제목이 비어 있습니다.`
      );
    }

    if (raw.title.length > MAX_TITLE_LENGTH) {
      throw new CalendarImportValidationError(
        'TITLE_TOO_LONG',
        `#${i + 1} 번째 일정 제목은 ${MAX_TITLE_LENGTH}자를 초과할 수 없습니다.`
      );
    }

    let startsAt = raw.startsAt;
    let endsAt = raw.endsAt;

    if (!startsAt && raw.startDate) {
      startsAt = `${raw.startDate}T00:00:00.000Z`;
    }
    if (!endsAt && raw.endDateExclusive) {
      endsAt = `${raw.endDateExclusive}T00:00:00.000Z`;
    }

    if (!isValidIsoDateString(startsAt) || !isValidIsoDateString(endsAt)) {
      throw new CalendarImportValidationError(
        'INVALID_ISO_DATE',
        `#${i + 1} 번째 일정의 시작 또는 종료 일시가 올바른 ISO 8601 형식이 아닙니다.`
      );
    }

    const startTime = Date.parse(startsAt);
    const endTime = Date.parse(endsAt);

    if (startTime > endTime) {
      throw new CalendarImportValidationError(
        'START_AFTER_END',
        `#${i + 1} 번째 일정의 시작 시각(${startsAt})이 종료 시각(${endsAt})보다 늦습니다.`
      );
    }

    const eventTz = raw.timeZone ?? defaultTimeZone;
    if (eventTz !== undefined && !isValidTimeZone(eventTz)) {
      throw new CalendarImportValidationError(
        'INVALID_TIMEZONE',
        `#${i + 1} 번째 일정의 시간대(timeZone)가 올바르지 않습니다: ${eventTz}`
      );
    }

    normalized.push({
      id: typeof raw.id === 'string' && raw.id.trim().length > 0 ? raw.id.trim() : undefined,
      title: trimmedTitle,
      startsAt,
      endsAt,
      timeZone: eventTz,
    });
  }

  return normalized;
}

function generateSourceId(
  events: readonly ValidatedEvent[],
  sourceHash?: string
): string {
  const hashPayload = sourceHash
    ? sourceHash
    : events
        .map((e) => `${e.id ?? ''}|${e.title}|${e.startsAt}|${e.endsAt}|${e.timeZone ?? ''}`)
        .sort()
        .join(';;');

  const sha256Hex = crypto.createHash('sha256').update(hashPayload).digest('hex');
  return `apple_cal_${sha256Hex.slice(0, 32)}`;
}

/**
 * 선택된 캘린더 일정을 서버에서 엄격히 검증하고, F04 동의 원장 세대 갱신 및
 * marketing_connector_evidence에 영속 저장한다.
 */
export async function saveImportedCalendarEvents(
  input: SaveImportedCalendarEventsInput,
  gateway: CalendarImportGateway
): Promise<CalendarImportResult> {
  if (
    !input.workspaceId ||
    typeof input.workspaceId !== 'string' ||
    !UUID_REGEX.test(input.workspaceId.trim())
  ) {
    throw new CalendarImportValidationError(
      'INVALID_WORKSPACE_ID',
      '유효한 작업공간 식별자(UUID)가 필요합니다.'
    );
  }

  if (
    !input.actorUserId ||
    typeof input.actorUserId !== 'string' ||
    input.actorUserId.trim().length === 0
  ) {
    throw new CalendarImportValidationError(
      'INVALID_ACTOR_USER_ID',
      '작업을 수행하는 사용자 식별자가 필요합니다.'
    );
  }

  const validatedEvents = validateAndNormalizeEvents(input.events, input.timeZone);

  const effectiveNowIso = input.now ?? new Date().toISOString();
  if (!isValidIsoDateString(effectiveNowIso)) {
    throw new CalendarImportValidationError(
      'INVALID_ISO_DATE',
      '현재 시각 정보가 유효한 ISO 형식이 아닙니다.'
    );
  }

  const nowEpoch = Date.parse(effectiveNowIso);
  const validUntilIso = new Date(nowEpoch + RETENTION_MS).toISOString();

  // 1. 고유 sourceId 생성
  const sourceId = generateSourceId(validatedEvents, input.sourceHash);

  // 2. F04 동의 원장 기록 (신규 세대 생성 및 이전 import 배치 비활성화)
  const consentRecord = await recordConsentGrant(
    {
      workspaceId: input.workspaceId.trim(),
      connectorId: 'apple_calendar',
      allowedSourceIds: [sourceId],
      purpose: 'marketing',
      validUntil: validUntilIso,
      aiProcessingApproved: true,
      actorUserId: input.actorUserId.trim(),
      now: effectiveNowIso,
    },
    gateway.consentLedger
  );

  // 3. marketing_connector_evidence 원장에 후보 일정 데이터 적재
  const evidenceRows: CalendarImportEvidenceRow[] = validatedEvents.map((evt, idx) => {
    const id = crypto.randomUUID();
    const revision = evt.id ?? `apple_evt_${idx + 1}_${sourceId.slice(10, 18)}`;
    return {
      id,
      workspaceId: input.workspaceId.trim(),
      connectorId: 'apple_calendar',
      sourceId,
      revision,
      consentGeneration: consentRecord.consentGeneration,
      observedAt: effectiveNowIso,
      expiresAt: validUntilIso,
      purpose: 'marketing',
      text: `[Apple Calendar] ${evt.title} (${evt.startsAt} ~ ${evt.endsAt})`,
      derivedFromGoogle: false,
      revokedAt: null,
      metadata: {
        eventId: evt.id ?? `apple_evt_${idx + 1}`,
        title: evt.title,
        startsAt: evt.startsAt,
        endsAt: evt.endsAt,
        timeZone: evt.timeZone ?? 'Asia/Seoul',
        importedAt: effectiveNowIso,
      },
    };
  });

  await gateway.saveEvidence(evidenceRows);

  if (gateway.updateConnection) {
    await gateway.updateConnection({
      workspaceId: input.workspaceId.trim(),
      connectorId: 'apple_calendar',
      status: 'connected',
      consentGeneration: consentRecord.consentGeneration,
      lastSyncAt: effectiveNowIso,
    });
  }

  return {
    ok: true,
    workspaceId: input.workspaceId.trim(),
    connectorId: 'apple_calendar',
    sourceId,
    consentGeneration: consentRecord.consentGeneration,
    importedCount: evidenceRows.length,
    validUntil: validUntilIso,
    evidenceIds: evidenceRows.map((r) => r.id),
  };
}

/**
 * Supabase DB 기반의 CalendarImportGateway 생성 팩토리
 */
export function createSupabaseCalendarImportGateway(supabase: {
  from: (table: string) => any;
}): CalendarImportGateway {
  const consentLedger: ConsentLedgerGateway = {
    async getLatestConsent(workspaceId, connectorId) {
      const { data, error } = await supabase
        .from('marketing_connector_connections')
        .select('workspace_id, connector_id, consent_generation, metadata, status, updated_at')
        .eq('workspace_id', workspaceId)
        .eq('connector_id', connectorId)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      const consentMeta = (data.metadata as any)?.consent;
      if (consentMeta && typeof consentMeta === 'object') {
        return {
          workspaceId: consentMeta.workspaceId ?? data.workspace_id,
          connectorId: consentMeta.connectorId ?? data.connector_id,
          consentGeneration: consentMeta.consentGeneration ?? data.consent_generation,
          allowedSourceIds: consentMeta.allowedSourceIds ?? [],
          purpose: consentMeta.purpose ?? 'marketing',
          validUntil: consentMeta.validUntil ?? data.updated_at,
          aiProcessingApproved: consentMeta.aiProcessingApproved ?? true,
          status: consentMeta.status ?? data.status,
          updatedAt: consentMeta.updatedAt ?? data.updated_at,
          updatedBy: consentMeta.updatedBy ?? 'system',
        };
      }

      return null;
    },

    async saveConsentRecord(record) {
      const { data: existing } = await supabase
        .from('marketing_connector_connections')
        .select('metadata')
        .eq('workspace_id', record.workspaceId)
        .eq('connector_id', record.connectorId)
        .maybeSingle();

      const existingMeta = (existing?.metadata as Record<string, unknown>) ?? {};
      const newMeta = {
        ...existingMeta,
        consent: record,
      };

      const { error } = await supabase
        .from('marketing_connector_connections')
        .upsert(
          {
            workspace_id: record.workspaceId,
            connector_id: record.connectorId,
            status: record.status === 'revoked' ? 'revoked' : 'connected',
            consent_generation: record.consentGeneration,
            metadata: newMeta,
            last_sync_at: record.updatedAt,
            updated_at: record.updatedAt,
          },
          { onConflict: 'workspace_id,connector_id' }
        );

      if (error) {
        throw new Error(`Failed to save consent record: ${error.message}`);
      }
    },
  };

  return {
    consentLedger,

    async saveEvidence(rows) {
      if (rows.length === 0) return;

      const dbRows = rows.map((r) => ({
        id: r.id,
        workspace_id: r.workspaceId,
        connector_id: r.connectorId,
        source_id: r.sourceId,
        revision: r.revision,
        consent_generation: r.consentGeneration,
        observed_at: r.observedAt,
        expires_at: r.expiresAt,
        purpose: r.purpose,
        text: r.text,
        derived_from_google: r.derivedFromGoogle,
        revoked_at: r.revokedAt,
        metadata: r.metadata,
      }));

      const { error } = await supabase
        .from('marketing_connector_evidence')
        .insert(dbRows);

      if (error) {
        throw new Error(`Failed to save marketing connector evidence: ${error.message}`);
      }
    },
  };
}
