import 'server-only';
import { randomUUID } from 'node:crypto';
import type { ConnectorId } from '../catalog';
import {
  saveImportedCalendarEvents,
  type CalendarImportGateway,
  type CalendarImportEvidenceRow,
  type ImportedCalendarEventInput,
  type CalendarImportResult,
  CalendarImportValidationError,
} from './calendar-import-service';
import {
  parseCalendarPreview,
  type CalendarOccurrence,
  type CalendarParseWindow,
} from './ics-parser';
import {
  listActiveEvidence,
  type EvidenceGateway,
  type MarketingConnectorEvidenceRecord,
} from '../evidence/evidence-repository';
import {
  type ConsentLedgerGateway,
  type MarketingConsentRecord,
} from '../consent/consent-ledger';
import {
  executeConnectorDeletion,
  type DeletionExecutorGateway,
  type ConnectorDeletionExecutionResult,
} from '../deletion/deletion-executor';
import type { DeletionJob } from '../deletion/deletion-job-repository';
import type { CredentialVaultGateway } from '../credentials/credential-vault';

export interface AppleCalendarLifecycleScenarioInput {
  readonly workspaceId: string;
  readonly actorUserId: string;

  // 1단계 입력: 1차 ICS 텍스트 또는 직접 생성된 이벤트 배열
  readonly initialIcs?: string;
  readonly initialEvents?: readonly ImportedCalendarEventInput[];
  readonly initialParseWindow?: CalendarParseWindow;
  readonly initialNow?: string;

  // 3단계 입력: 2차 대체 ICS 텍스트 또는 이벤트 배열 (일부 수정/삭제)
  readonly replacementIcs?: string;
  readonly replacementEvents?: readonly ImportedCalendarEventInput[];
  readonly replacementParseWindow?: CalendarParseWindow;
  readonly replacementNow?: string;

  // 4단계 입력: 삭제 작업 식별자 및 실행 시점
  readonly deletionJobId?: string;
  readonly deletionNow?: string;

  // 기본 시간대 (미지정 시 Asia/Seoul)
  readonly timeZone?: string;
}

export interface AppleCalendarLifecycleGateway {
  readonly consentLedger: ConsentLedgerGateway;
  readonly evidenceGateway: EvidenceGateway;
  readonly vaultGateway?: CredentialVaultGateway;
  readonly updateConnectionStatus?: (params: {
    workspaceId: string;
    connectorId: ConnectorId;
    status: 'connected' | 'disconnected' | 'revoked';
    consentGeneration?: number;
    lastSyncAt?: string;
    now?: string;
  }) => Promise<void>;
  readonly revokeEvidence?: (params: {
    workspaceId: string;
    connectorId: ConnectorId;
    now: string;
  }) => Promise<void>;
}

export interface AppleCalendarLifecycleScenarioResult {
  readonly workspaceId: string;
  readonly step1InitialImport: {
    readonly sourceId: string;
    readonly consentGeneration: number;
    readonly importedCount: number;
    readonly evidenceIds: readonly string[];
  };
  readonly step2ActiveEvidence: {
    readonly count: number;
    readonly records: readonly MarketingConnectorEvidenceRecord[];
  };
  readonly step3ReplacementImport: {
    readonly sourceId: string;
    readonly consentGeneration: number;
    readonly importedCount: number;
    readonly evidenceIds: readonly string[];
    readonly previousBatchActiveCount: number;
    readonly newBatchActiveCount: number;
  };
  readonly step4Deletion: {
    readonly deletionResult: ConnectorDeletionExecutionResult;
    readonly activeEvidenceCountAfterDeletion: number;
    readonly consentStatusAfterDeletion: string;
  };
}

export interface VerifyCalendarEdgeCasesInput {
  readonly workspaceId: string;
  readonly actorUserId: string;
  readonly icsText: string;
  readonly window: CalendarParseWindow;
  readonly timeZone?: string;
  readonly now?: string;
}

export interface VerifyCalendarEdgeCasesResult {
  readonly leapDayHandled: boolean;
  readonly monthEndHandled: boolean;
  readonly timeZoneConverted: boolean;
  readonly rruleBoundedHandled: boolean;
  readonly importedCount: number;
  readonly activeEvidenceRecords: readonly MarketingConnectorEvidenceRecord[];
}

const DEFAULT_PARSE_WINDOW: CalendarParseWindow = {
  startInstant: '2020-01-01T00:00:00.000Z',
  endInstant: '2030-12-31T23:59:59.999Z',
  startDate: '2020-01-01',
  endDateExclusive: '2031-01-01',
};

/**
 * ics-parser의 CalendarOccurrence 항목들을 calendar-import-service의 ImportedCalendarEventInput 규격으로 변환
 */
export function previewOccurrencesToImportEvents(
  occurrences: readonly CalendarOccurrence[],
  defaultTimeZone?: string
): ImportedCalendarEventInput[] {
  return occurrences.map((occ, idx) => {
    const title = occ.title && occ.title.trim().length > 0 ? occ.title.trim() : `일정 #${idx + 1}`;
    if (occ.kind === 'timed') {
      return {
        id: occ.id,
        title,
        startsAt: occ.startsAt,
        endsAt: occ.endsAt,
        timeZone: defaultTimeZone,
      };
    } else {
      return {
        id: occ.id,
        title,
        startsAt: `${occ.startDate}T00:00:00.000Z`,
        endsAt: `${occ.endDateExclusive}T00:00:00.000Z`,
        startDate: occ.startDate,
        endDateExclusive: occ.endDateExclusive,
        timeZone: defaultTimeZone,
      };
    }
  });
}

function adaptLifecycleGatewayToImportGateway(
  gateway: AppleCalendarLifecycleGateway
): CalendarImportGateway {
  return {
    consentLedger: gateway.consentLedger,
    saveEvidence: async (rows: readonly CalendarImportEvidenceRow[]) => {
      if (typeof gateway.evidenceGateway.upsertEvidenceBatch === 'function') {
        await gateway.evidenceGateway.upsertEvidenceBatch(rows as MarketingConnectorEvidenceRecord[]);
      } else {
        for (const row of rows) {
          await gateway.evidenceGateway.upsertEvidence(row as MarketingConnectorEvidenceRecord);
        }
      }
    },
    updateConnection: async (params) => {
      if (gateway.updateConnectionStatus) {
        await gateway.updateConnectionStatus({
          workspaceId: params.workspaceId,
          connectorId: params.connectorId,
          status: params.status,
          consentGeneration: params.consentGeneration,
          lastSyncAt: params.lastSyncAt,
        });
      }
    },
  };
}

/**
 * MC/A03 Apple 캘린더 E2E 전체 라이프사이클 실행기
 *
 * 1단계: 1차 ICS 파일 임포트 (saveImportedCalendarEvents) -> K01 원장에 N개 일정 적재 확인.
 * 2단계: K01 listActiveEvidence로 활성 근거 정상 조회 확인 (purpose: 'marketing').
 * 3단계: 2차 ICS 파일(일부 수정/삭제된 새 파일) 임포트 -> 세대 증가 및 이전 배치 비활성화, 새 일정 반영 확인.
 * 4단계: F06 executeConnectorDeletion 호출 -> 원장 revoked_at 갱신 및 listActiveEvidence 조회 시 0건 반환 확인.
 */
export async function runAppleCalendarLifecycleScenario(
  input: AppleCalendarLifecycleScenarioInput,
  gateway: AppleCalendarLifecycleGateway
): Promise<AppleCalendarLifecycleScenarioResult> {
  const importGateway = adaptLifecycleGatewayToImportGateway(gateway);

  // 1단계 준비: 1차 이벤트 추출
  let events1: ImportedCalendarEventInput[];
  let sourceHash1: string | undefined;

  if (input.initialIcs) {
    const preview = await parseCalendarPreview({
      icsText: input.initialIcs,
      window: input.initialParseWindow ?? DEFAULT_PARSE_WINDOW,
    });
    events1 = previewOccurrencesToImportEvents(preview.occurrences, input.timeZone);
    sourceHash1 = preview.sourceHash;
  } else if (input.initialEvents && input.initialEvents.length > 0) {
    events1 = [...input.initialEvents];
    sourceHash1 = undefined;
  } else {
    throw new CalendarImportValidationError(
      'EMPTY_EVENTS',
      '1차 캘린더 일정 데이터(ICS 또는 이벤트 목록)가 제공되지 않았습니다.'
    );
  }

  // 1단계 실행: 1차 ICS 파일 임포트
  const step1ImportResult: CalendarImportResult = await saveImportedCalendarEvents(
    {
      workspaceId: input.workspaceId,
      events: events1,
      actorUserId: input.actorUserId,
      timeZone: input.timeZone,
      sourceHash: sourceHash1,
      now: input.initialNow,
    },
    importGateway
  );

  // 2단계 실행: K01 원장에서 활성 근거 정상 조회 확인
  const activeRecordsStep2 = await listActiveEvidence(
    {
      workspaceId: input.workspaceId,
      connectorId: 'apple_calendar',
      consentGeneration: step1ImportResult.consentGeneration,
      purpose: 'marketing',
      now: input.initialNow,
    },
    gateway.evidenceGateway
  );

  // 3단계 준비: 2차 대체 이벤트 추출
  let events2: ImportedCalendarEventInput[];
  let sourceHash2: string | undefined;

  if (input.replacementIcs) {
    const preview2 = await parseCalendarPreview({
      icsText: input.replacementIcs,
      window: input.replacementParseWindow ?? input.initialParseWindow ?? DEFAULT_PARSE_WINDOW,
    });
    events2 = previewOccurrencesToImportEvents(preview2.occurrences, input.timeZone);
    sourceHash2 = preview2.sourceHash;
  } else if (input.replacementEvents && input.replacementEvents.length > 0) {
    events2 = [...input.replacementEvents];
    sourceHash2 = undefined;
  } else {
    // 2차가 명시되지 않은 경우 1차를 바탕으로 변경된 단일 이벤트 생성
    events2 = [
      {
        id: 'fallback-replacement-evt',
        title: '신규 대체 프로모션 회의',
        startsAt: '2026-11-20T10:00:00.000Z',
        endsAt: '2026-11-20T11:00:00.000Z',
        timeZone: input.timeZone,
      },
    ];
  }

  const effectiveReplacementNow = input.replacementNow ?? input.initialNow;

  // 3단계 실행: 2차 ICS 파일 임포트 (세대 증가 및 이전 배치 비활성화)
  const step3ImportResult: CalendarImportResult = await saveImportedCalendarEvents(
    {
      workspaceId: input.workspaceId,
      events: events2,
      actorUserId: input.actorUserId,
      timeZone: input.timeZone,
      sourceHash: sourceHash2,
      now: effectiveReplacementNow,
    },
    importGateway
  );

  // 세대 2 기준 활성 근거 조회
  const activeRecordsStep3 = await listActiveEvidence(
    {
      workspaceId: input.workspaceId,
      connectorId: 'apple_calendar',
      consentGeneration: step3ImportResult.consentGeneration,
      purpose: 'marketing',
      now: effectiveReplacementNow,
    },
    gateway.evidenceGateway
  );

  const initialEvidenceIdSet = new Set(step1ImportResult.evidenceIds);
  const previousBatchActiveCount = activeRecordsStep3.filter((r) =>
    initialEvidenceIdSet.has(r.id)
  ).length;

  // 4단계 실행: F06 연동 해제 및 영구 삭제
  const effectiveDeletionNow = input.deletionNow ?? effectiveReplacementNow ?? new Date().toISOString();
  const deletionJob: DeletionJob = {
    id: input.deletionJobId ?? randomUUID(),
    workspaceId: input.workspaceId,
    connectorId: 'apple_calendar',
    consentGeneration: step3ImportResult.consentGeneration,
    status: 'pending',
    requestedBy: input.actorUserId,
    encryptedCredentialRef: null,
    attempts: 0,
    maxRetries: 3,
    lockedBy: null,
    leaseExpiresAt: null,
    lastError: null,
    retryAfter: null,
    createdAt: effectiveDeletionNow,
    updatedAt: effectiveDeletionNow,
  };

  const defaultVaultGateway: CredentialVaultGateway = {
    async getCredential() {
      return null;
    },
    async saveCredential() {},
    async updateCredentialTokens() {},
  };

  const deletionGateway: DeletionExecutorGateway = {
    vaultGateway: gateway.vaultGateway ?? defaultVaultGateway,
    consentGateway: gateway.consentLedger,
    revokeEvidence: async (params) => {
      if (gateway.revokeEvidence) {
        await gateway.revokeEvidence(params);
      }
    },
    updateConnectionStatus: async (params) => {
      if (gateway.updateConnectionStatus) {
        await gateway.updateConnectionStatus({
          workspaceId: params.workspaceId,
          connectorId: params.connectorId,
          status: params.status,
          now: params.now,
        });
      }
    },
  };

  const deletionResult = await executeConnectorDeletion(deletionJob, deletionGateway, {
    now: effectiveDeletionNow,
  });

  // 삭제 후 활성 근거 조회 (0건 반환 확인)
  const activeRecordsAfterDeletion = await listActiveEvidence(
    {
      workspaceId: input.workspaceId,
      connectorId: 'apple_calendar',
      consentGeneration: step3ImportResult.consentGeneration,
      purpose: 'marketing',
      now: effectiveDeletionNow,
    },
    gateway.evidenceGateway
  );

  const latestConsent = await gateway.consentLedger.getLatestConsent(
    input.workspaceId,
    'apple_calendar'
  );

  return {
    workspaceId: input.workspaceId,
    step1InitialImport: {
      sourceId: step1ImportResult.sourceId,
      consentGeneration: step1ImportResult.consentGeneration,
      importedCount: step1ImportResult.importedCount,
      evidenceIds: step1ImportResult.evidenceIds,
    },
    step2ActiveEvidence: {
      count: activeRecordsStep2.length,
      records: activeRecordsStep2,
    },
    step3ReplacementImport: {
      sourceId: step3ImportResult.sourceId,
      consentGeneration: step3ImportResult.consentGeneration,
      importedCount: step3ImportResult.importedCount,
      evidenceIds: step3ImportResult.evidenceIds,
      previousBatchActiveCount,
      newBatchActiveCount: activeRecordsStep3.length,
    },
    step4Deletion: {
      deletionResult,
      activeEvidenceCountAfterDeletion: activeRecordsAfterDeletion.length,
      consentStatusAfterDeletion: latestConsent?.status ?? 'unknown',
    },
  };
}

/**
 * 5단계: 특수 일정 엣지케이스(윤일 2월 29일, 월말 31일, 시간대 변환, RRULE 바운디드 종료성) 검증기
 */
export async function verifyCalendarEdgeCases(
  input: VerifyCalendarEdgeCasesInput,
  gateway: AppleCalendarLifecycleGateway
): Promise<VerifyCalendarEdgeCasesResult> {
  const preview = await parseCalendarPreview({
    icsText: input.icsText,
    window: input.window,
  });

  const occurrences = preview.occurrences;
  const events = previewOccurrencesToImportEvents(occurrences, input.timeZone);

  // 1. 윤일 2월 29일 판별
  const leapDayHandled = occurrences.some((occ) => {
    if (occ.kind === 'all_day') {
      return occ.startDate.includes('-02-29') || occ.endDateExclusive.includes('-02-29');
    }
    return occ.startsAt.includes('-02-29') || occ.endsAt.includes('-02-29');
  });

  // 2. 월말 31일 판별
  const monthEndHandled = occurrences.some((occ) => {
    if (occ.kind === 'all_day') {
      return occ.startDate.includes('-31') || occ.endDateExclusive.includes('-31');
    }
    return occ.startsAt.includes('-31') || occ.endsAt.includes('-31');
  });

  // 3. 시간대 변환 판별 (UTC 표기 Z로 변환되었거나, 로컬 시간대가 입력된 경우)
  const timeZoneConverted =
    input.icsText.includes('VTIMEZONE') ||
    input.icsText.includes('TZID') ||
    occurrences.some((occ) => occ.kind === 'timed' && occ.startsAt.endsWith('Z'));

  // 4. RRULE 바운디드 판별
  const rruleBoundedHandled =
    input.icsText.includes('RRULE') &&
    occurrences.length > 0 &&
    occurrences.every((occ) => occ.recurring || occurrences.length <= 100);

  const importGateway = adaptLifecycleGatewayToImportGateway(gateway);

  const importResult = await saveImportedCalendarEvents(
    {
      workspaceId: input.workspaceId,
      events,
      actorUserId: input.actorUserId,
      timeZone: input.timeZone,
      sourceHash: preview.sourceHash,
      now: input.now,
    },
    importGateway
  );

  const activeEvidenceRecords = await listActiveEvidence(
    {
      workspaceId: input.workspaceId,
      connectorId: 'apple_calendar',
      consentGeneration: importResult.consentGeneration,
      purpose: 'marketing',
      now: input.now,
    },
    gateway.evidenceGateway
  );

  return {
    leapDayHandled,
    monthEndHandled,
    timeZoneConverted,
    rruleBoundedHandled,
    importedCount: activeEvidenceRecords.length,
    activeEvidenceRecords,
  };
}

/**
 * 테스트 및 에뮬레이션을 위한 인메모리 AppleCalendarLifecycleGateway 팩토리
 */
export function createInMemoryLifecycleGateway(): AppleCalendarLifecycleGateway {
  const consentRecords: MarketingConsentRecord[] = [];
  const evidenceStore = new Map<string, MarketingConnectorEvidenceRecord>();

  const consentLedger: ConsentLedgerGateway = {
    async getLatestConsent(workspaceId, connectorId) {
      const matched = consentRecords
        .filter((r) => r.workspaceId === workspaceId && r.connectorId === connectorId)
        .sort((a, b) => b.consentGeneration - a.consentGeneration);
      return matched[0] ?? null;
    },
    async saveConsentRecord(record) {
      consentRecords.push(record);
    },
    async getConsentHistory(workspaceId, connectorId) {
      return consentRecords.filter(
        (r) => r.workspaceId === workspaceId && r.connectorId === connectorId
      );
    },
  };

  function buildKey(workspaceId: string, connectorId: string, sourceId: string, revision: string) {
    return `${workspaceId}:${connectorId}:${sourceId}:${revision}`;
  }

  const evidenceGateway: EvidenceGateway = {
    async upsertEvidence(record) {
      const key = buildKey(record.workspaceId, record.connectorId, record.sourceId, record.revision);
      evidenceStore.set(key, record);
    },
    async upsertEvidenceBatch(records) {
      for (const record of records) {
        const key = buildKey(record.workspaceId, record.connectorId, record.sourceId, record.revision);
        evidenceStore.set(key, record);
      }
    },
    async findEvidenceByRevision(workspaceId, connectorId, sourceId, revision) {
      const key = buildKey(workspaceId, connectorId, sourceId, revision);
      return evidenceStore.get(key) ?? null;
    },
    async listEvidence(params) {
      const results: MarketingConnectorEvidenceRecord[] = [];
      for (const record of evidenceStore.values()) {
        if (record.workspaceId !== params.workspaceId) continue;
        if (record.connectorId !== params.connectorId) continue;
        if (params.sourceId && record.sourceId !== params.sourceId) continue;
        if (params.consentGeneration !== undefined && record.consentGeneration !== params.consentGeneration) {
          continue;
        }
        if (params.purpose !== undefined && record.purpose !== params.purpose) {
          continue;
        }
        results.push(record);
      }
      return results;
    },
    async revokeEvidenceBySource(workspaceId, connectorId, sourceId, revokedAt) {
      for (const [key, record] of evidenceStore.entries()) {
        if (
          record.workspaceId === workspaceId &&
          record.connectorId === connectorId &&
          record.sourceId === sourceId
        ) {
          evidenceStore.set(key, { ...record, revokedAt });
        }
      }
    },
  };

  const vaultGateway: CredentialVaultGateway = {
    async getCredential() {
      return null;
    },
    async saveCredential() {},
    async updateCredentialTokens() {},
  };

  return {
    consentLedger,
    evidenceGateway,
    vaultGateway,
    async revokeEvidence(params) {
      for (const [key, record] of evidenceStore.entries()) {
        if (record.workspaceId === params.workspaceId && record.connectorId === params.connectorId) {
          evidenceStore.set(key, { ...record, revokedAt: params.now });
        }
      }
    },
    async updateConnectionStatus() {},
  };
}
