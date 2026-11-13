import { createHash } from 'node:crypto';

export interface SlotRange {
  startsAt: string;
  endsAt: string;
}

export interface SlotOpportunityRequest {
  workspaceId: string;
  queryRange: SlotRange;
  timezone: string;
}

export type LedgerSourceKind = 'OWNER_CONFIRMED' | 'INTERNAL_VERIFIED' | 'EXTERNAL_READBACK';

export interface LedgerSourceEvidence {
  workspaceId: string;
  kind: LedgerSourceKind;
  sourceId: string;
  evidenceId: string;
  checkedAt: string;
  validUntil: string;
  ledgerVersion: string;
  confirmedByRef?: string;
  providerRef?: string;
}

export interface VerifiedResourceSnapshot {
  workspaceId: string;
  ledgerVersion: string;
  resourceId: string;
  evidenceId: string;
  version: string;
  checkedAt: string;
  validUntil: string;
  capacity: number;
  availableCapacity: number;
}

export interface VerifiedServiceSnapshot {
  workspaceId: string;
  serviceId: string;
  catalogVersion: string;
  evidenceId: string;
  checkedAt: string;
  validUntil: string;
  durationMinutes: number;
  requiredCapacity: number;
  priceKrw: number;
}

export interface SlotCandidate {
  slotId: string;
  slotVersion: string;
  catalogVersion: string;
  workspaceId: string;
  serviceId: string;
  range: SlotRange;
  timezone: string;
  status: 'AVAILABLE' | 'BOOKED' | 'WITHDRAWN';
  resource: VerifiedResourceSnapshot;
  service: VerifiedServiceSnapshot;
}

export type SlotLedgerSnapshot =
  | { state: 'NOT_OBSERVED'; workspaceId: string }
  | { state: 'ERROR'; workspaceId: string }
  | {
      state: 'SUCCESS';
      workspaceId: string;
      datasetMode: 'ACTUAL' | 'SHOWCASE_DEMO' | 'TEST';
      freshness: 'CURRENT' | 'STALE' | 'UNKNOWN';
      coverage: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
      queryRange: SlotRange;
      timezone: string;
      source: LedgerSourceEvidence;
      ledgerVersion: string;
      candidate: SlotCandidate | null;
    };

export type SlotLedgerReadPort = (
  request: Readonly<SlotOpportunityRequest>
) => Promise<SlotLedgerSnapshot>;

export type SlotOpportunityState =
  | 'VERIFIED_SLOT'
  | 'NEEDS_OWNER_CONFIRMATION'
  | 'NO_CANDIDATE'
  | 'BLOCKED'
  | 'ERROR';

export type AvailabilityTruth = 'VERIFIED' | 'UNKNOWN' | 'NOT_AVAILABLE';

export interface SlotOpportunity {
  id: string;
  workspaceId: string;
  slotId: string;
  slotVersion: string;
  ledgerVersion: string;
  serviceId: string;
  catalogVersion: string;
  resourceId: string;
  slotSource: LedgerSourceKind;
  sourceId: string;
  sourceEvidenceId: string;
  slotRange: SlotRange;
  timezone: string;
  observedAt: string;
  evaluatedAt: string;
  expiresAt: string;
  evidenceIds: readonly string[];
  confidence: 'VERIFIED';
  executionAllowed: false;
}

export type SlotOpportunityDecision =
  | {
      workspaceId: string;
      state: 'VERIFIED_SLOT';
      availabilityTruth: 'VERIFIED';
      reason: 'VERIFIED_SLOT';
      message: string;
      executionAllowed: false;
      opportunity: SlotOpportunity;
    }
  | {
      workspaceId: string;
      state: 'NEEDS_OWNER_CONFIRMATION';
      availabilityTruth: 'UNKNOWN';
      reason: string;
      message: string;
      executionAllowed: false;
      opportunity: null;
    }
  | {
      workspaceId: string;
      state: 'NO_CANDIDATE';
      availabilityTruth: 'NOT_AVAILABLE';
      reason: 'NO_CANDIDATE';
      message: string;
      executionAllowed: false;
      opportunity: null;
    }
  | {
      workspaceId: string;
      state: 'BLOCKED';
      availabilityTruth: 'NOT_AVAILABLE' | 'UNKNOWN';
      reason: string;
      message: string;
      executionAllowed: false;
      opportunity: null;
    }
  | {
      workspaceId: string;
      state: 'ERROR';
      availabilityTruth: 'UNKNOWN';
      reason: string;
      message: string;
      executionAllowed: false;
      opportunity: null;
    };

const MSG_NEEDS_OWNER_CONFIRMATION = '빈시간 맞나요? 장부를 확인한 뒤 다시 알려주세요.';
const MSG_ERROR = '예약 장부를 불러오지 못했어요. 다시 확인해 주세요.';
const MSG_BLOCKED = '이 시간은 빈자리로 제안할 수 없어요.';
const MSG_NO_CANDIDATE = '확인한 범위에 제안할 빈시간이 없어요.';
const MSG_VERIFIED_SLOT = '장부에서 확인한 빈시간이에요. 실행 전에 다시 확인해 주세요.';

const ISO_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function getDaysInMonth(year: number, month: number): number {
  switch (month) {
    case 1: case 3: case 5: case 7: case 8: case 10: case 12:
      return 31;
    case 4: case 6: case 9: case 11:
      return 30;
    case 2:
      return isLeapYear(year) ? 29 : 28;
    default:
      return 0;
  }
}

function isValidIsoInstant(val: unknown): val is string {
  if (typeof val !== 'string') return false;
  const match = ISO_DATE_REGEX.exec(val);
  if (!match) return false;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);
  const second = parseInt(match[6], 10);

  if (month < 1 || month > 12) return false;
  const maxDays = getDaysInMonth(year, month);
  if (day < 1 || day > maxDays) return false;
  if (hour < 0 || hour > 23) return false;
  if (minute < 0 || minute > 59) return false;
  if (second < 0 || second > 59) return false;

  return Number.isFinite(Date.parse(val));
}

function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim()) {
    return false;
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isSafePositiveInteger(val: unknown): val is number {
  return typeof val === 'number' && Number.isSafeInteger(val) && val > 0;
}

function isSafeNonNegativeInteger(val: unknown): val is number {
  return typeof val === 'number' && Number.isSafeInteger(val) && val >= 0;
}

function errorDecision(workspaceId: unknown, reason: string): SlotOpportunityDecision {
  return {
    workspaceId: typeof workspaceId === 'string' ? workspaceId : '',
    state: 'ERROR',
    availabilityTruth: 'UNKNOWN',
    reason,
    message: MSG_ERROR,
    executionAllowed: false,
    opportunity: null,
  };
}

function confirmationDecision(workspaceId: string, reason: string): SlotOpportunityDecision {
  return {
    workspaceId,
    state: 'NEEDS_OWNER_CONFIRMATION',
    availabilityTruth: 'UNKNOWN',
    reason,
    message: MSG_NEEDS_OWNER_CONFIRMATION,
    executionAllowed: false,
    opportunity: null,
  };
}

function blockedDecision(
  workspaceId: string,
  reason: string,
  truth: 'NOT_AVAILABLE' | 'UNKNOWN' = 'UNKNOWN'
): SlotOpportunityDecision {
  return {
    workspaceId,
    state: 'BLOCKED',
    availabilityTruth: truth,
    reason,
    message: MSG_BLOCKED,
    executionAllowed: false,
    opportunity: null,
  };
}

function validateRequestAndNow(
  request: unknown,
  now: unknown
): request is SlotOpportunityRequest {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return false;
  const req = request as SlotOpportunityRequest;
  if (typeof req.workspaceId !== 'string' || !req.workspaceId.trim()) return false;
  if (!isValidTimezone(req.timezone)) return false;
  if (!isValidIsoInstant(now)) return false;
  if (!req.queryRange || typeof req.queryRange !== 'object' || Array.isArray(req.queryRange)) return false;
  if (!isValidIsoInstant(req.queryRange.startsAt) || !isValidIsoInstant(req.queryRange.endsAt)) return false;
  const startMs = Date.parse(req.queryRange.startsAt);
  const endMs = Date.parse(req.queryRange.endsAt);
  if (startMs >= endMs) return false;
  return true;
}

export function evaluateSlotOpportunity(input: {
  request: SlotOpportunityRequest;
  snapshot: SlotLedgerSnapshot;
  now: string;
}): SlotOpportunityDecision {
  // R2: Root null/undefined guard before destructuring
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return errorDecision('', 'INVALID_INPUT');
  }

  const { request, snapshot, now } = input;

  // 1. Request and now structure validation
  if (!validateRequestAndNow(request, now)) {
    const rawWs = (request as any)?.workspaceId;
    return errorDecision(typeof rawWs === 'string' ? rawWs : '', 'INVALID_INPUT');
  }

  // 2. Snapshot shape and tenancy validation
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || typeof snapshot.state !== 'string') {
    return errorDecision(request.workspaceId, 'INVALID_INPUT');
  }

  if (snapshot.workspaceId !== request.workspaceId) {
    return blockedDecision(request.workspaceId, 'WORKSPACE_MISMATCH', 'UNKNOWN');
  }

  // 3. Basic snapshot state handling
  if (snapshot.state === 'NOT_OBSERVED') {
    return confirmationDecision(request.workspaceId, 'LEDGER_NOT_OBSERVED');
  }

  if (snapshot.state === 'ERROR') {
    return errorDecision(request.workspaceId, 'LEDGER_QUERY_ERROR');
  }

  if (snapshot.state !== 'SUCCESS') {
    return errorDecision(request.workspaceId, 'INVALID_INPUT');
  }

  // 4. Dataset mode validation
  if (snapshot.datasetMode !== 'ACTUAL') {
    return blockedDecision(request.workspaceId, 'NON_ACTUAL_DATASET', 'UNKNOWN');
  }

  // 5. Freshness and coverage validation
  if (snapshot.freshness !== 'CURRENT') {
    return confirmationDecision(request.workspaceId, 'LEDGER_NOT_CURRENT');
  }

  if (snapshot.coverage !== 'COMPLETE') {
    return confirmationDecision(request.workspaceId, 'INCOMPLETE_COVERAGE');
  }

  // 6. QueryRange, timezone, and ledger version match
  if (snapshot.timezone !== request.timezone) {
    return confirmationDecision(request.workspaceId, 'COVERAGE_MISMATCH');
  }

  if (
    !snapshot.queryRange ||
    !isValidIsoInstant(snapshot.queryRange.startsAt) ||
    !isValidIsoInstant(snapshot.queryRange.endsAt) ||
    Date.parse(snapshot.queryRange.startsAt) !== Date.parse(request.queryRange.startsAt) ||
    Date.parse(snapshot.queryRange.endsAt) !== Date.parse(request.queryRange.endsAt)
  ) {
    return confirmationDecision(request.workspaceId, 'COVERAGE_MISMATCH');
  }

  if (
    typeof snapshot.ledgerVersion !== 'string' ||
    !snapshot.ledgerVersion.trim() ||
    snapshot.ledgerVersion !== snapshot.source?.ledgerVersion
  ) {
    return confirmationDecision(request.workspaceId, 'MISSING_EVIDENCE');
  }

  // 7. Source evidence checks (R4: source.workspaceId check)
  const src = snapshot.source;
  if (
    !src ||
    typeof src !== 'object' ||
    typeof src.kind !== 'string' ||
    typeof src.sourceId !== 'string' ||
    !src.sourceId.trim() ||
    typeof src.evidenceId !== 'string' ||
    !src.evidenceId.trim() ||
    typeof src.ledgerVersion !== 'string' ||
    !src.ledgerVersion.trim() ||
    !isValidIsoInstant(src.checkedAt) ||
    !isValidIsoInstant(src.validUntil)
  ) {
    return confirmationDecision(request.workspaceId, 'MISSING_EVIDENCE');
  }

  if (src.workspaceId !== request.workspaceId) {
    return blockedDecision(request.workspaceId, 'WORKSPACE_MISMATCH', 'UNKNOWN');
  }

  const nowMs = Date.parse(now);
  const srcCheckedAtMs = Date.parse(src.checkedAt);
  const srcValidUntilMs = Date.parse(src.validUntil);

  if (srcCheckedAtMs > nowMs) {
    return confirmationDecision(request.workspaceId, 'CLOCK_SKEW');
  }

  if (srcValidUntilMs <= nowMs) {
    return confirmationDecision(request.workspaceId, 'STALE_EVIDENCE');
  }

  if (src.kind === 'OWNER_CONFIRMED') {
    if (typeof src.confirmedByRef !== 'string' || !src.confirmedByRef.trim()) {
      return confirmationDecision(request.workspaceId, 'MISSING_EVIDENCE');
    }
    if (nowMs - srcCheckedAtMs >= 15 * 60 * 1000) {
      return confirmationDecision(request.workspaceId, 'STALE_EVIDENCE');
    }
  } else if (src.kind === 'EXTERNAL_READBACK') {
    if (typeof src.providerRef !== 'string' || !src.providerRef.trim()) {
      return confirmationDecision(request.workspaceId, 'MISSING_EVIDENCE');
    }
  } else if (src.kind !== 'INTERNAL_VERIFIED') {
    return confirmationDecision(request.workspaceId, 'MISSING_EVIDENCE');
  }

  // 8. Candidate check
  if (snapshot.candidate === null) {
    return {
      workspaceId: request.workspaceId,
      state: 'NO_CANDIDATE',
      availabilityTruth: 'NOT_AVAILABLE',
      reason: 'NO_CANDIDATE',
      message: MSG_NO_CANDIDATE,
      executionAllowed: false,
      opportunity: null,
    };
  }

  const cand = snapshot.candidate;
  if (!cand || typeof cand !== 'object') {
    return errorDecision(request.workspaceId, 'INVALID_INPUT');
  }

  if (cand.workspaceId !== request.workspaceId) {
    return blockedDecision(request.workspaceId, 'WORKSPACE_MISMATCH', 'UNKNOWN');
  }

  // 9. Candidate status and time range
  if (cand.status === 'BOOKED' || cand.status === 'WITHDRAWN') {
    return blockedDecision(request.workspaceId, 'SLOT_NOT_AVAILABLE', 'NOT_AVAILABLE');
  }

  if (cand.status !== 'AVAILABLE') {
    return blockedDecision(request.workspaceId, 'INVALID_SLOT', 'UNKNOWN');
  }

  if (cand.timezone !== request.timezone) {
    return blockedDecision(request.workspaceId, 'INVALID_SLOT', 'UNKNOWN');
  }

  if (
    !cand.range ||
    !isValidIsoInstant(cand.range.startsAt) ||
    !isValidIsoInstant(cand.range.endsAt)
  ) {
    return blockedDecision(request.workspaceId, 'INVALID_SLOT', 'UNKNOWN');
  }

  const slotStartMs = Date.parse(cand.range.startsAt);
  const slotEndMs = Date.parse(cand.range.endsAt);
  const reqStartMs = Date.parse(request.queryRange.startsAt);
  const reqEndMs = Date.parse(request.queryRange.endsAt);

  if (slotEndMs <= slotStartMs) {
    return blockedDecision(request.workspaceId, 'INVALID_SLOT', 'UNKNOWN');
  }

  if (slotStartMs <= nowMs) {
    return confirmationDecision(request.workspaceId, 'SLOT_EXPIRED');
  }

  if (slotStartMs < reqStartMs || slotEndMs > reqEndMs) {
    return blockedDecision(request.workspaceId, 'INVALID_SLOT', 'UNKNOWN');
  }

  // 10. Service and Resource verification (R4 additions)
  if (
    typeof cand.slotId !== 'string' ||
    !cand.slotId.trim() ||
    typeof cand.slotVersion !== 'string' ||
    !cand.slotVersion.trim() ||
    typeof cand.catalogVersion !== 'string' ||
    !cand.catalogVersion.trim() ||
    typeof cand.serviceId !== 'string' ||
    !cand.serviceId.trim() ||
    !cand.service ||
    cand.service.serviceId !== cand.serviceId ||
    typeof cand.service.catalogVersion !== 'string' ||
    !cand.service.catalogVersion.trim() ||
    typeof cand.service.evidenceId !== 'string' ||
    !cand.service.evidenceId.trim() ||
    !cand.resource ||
    typeof cand.resource.resourceId !== 'string' ||
    !cand.resource.resourceId.trim() ||
    typeof cand.resource.version !== 'string' ||
    !cand.resource.version.trim() ||
    typeof cand.resource.ledgerVersion !== 'string' ||
    !cand.resource.ledgerVersion.trim() ||
    typeof cand.resource.evidenceId !== 'string' ||
    !cand.resource.evidenceId.trim() ||
    !isValidIsoInstant(cand.service.checkedAt) ||
    !isValidIsoInstant(cand.service.validUntil) ||
    !isValidIsoInstant(cand.resource.checkedAt) ||
    !isValidIsoInstant(cand.resource.validUntil)
  ) {
    return confirmationDecision(request.workspaceId, 'RESOURCE_OR_SERVICE_UNVERIFIED');
  }

  // R4: Workspace boundary checks on resource and service
  if (
    cand.resource.workspaceId !== request.workspaceId ||
    cand.service.workspaceId !== request.workspaceId
  ) {
    return blockedDecision(request.workspaceId, 'WORKSPACE_MISMATCH', 'UNKNOWN');
  }

  // R4: Version consistency checks
  if (
    cand.resource.ledgerVersion !== snapshot.ledgerVersion ||
    cand.catalogVersion !== cand.service.catalogVersion
  ) {
    return confirmationDecision(request.workspaceId, 'VERSION_CHANGED');
  }

  const srvCheckedAtMs = Date.parse(cand.service.checkedAt);
  const srvValidUntilMs = Date.parse(cand.service.validUntil);
  const resCheckedAtMs = Date.parse(cand.resource.checkedAt);
  const resValidUntilMs = Date.parse(cand.resource.validUntil);

  if (srvCheckedAtMs > nowMs || resCheckedAtMs > nowMs) {
    return confirmationDecision(request.workspaceId, 'CLOCK_SKEW');
  }

  if (srvValidUntilMs <= nowMs || resValidUntilMs <= nowMs) {
    return confirmationDecision(request.workspaceId, 'STALE_EVIDENCE');
  }

  if (
    !isSafePositiveInteger(cand.service.durationMinutes) ||
    !isSafePositiveInteger(cand.service.requiredCapacity) ||
    !isSafeNonNegativeInteger(cand.service.priceKrw) ||
    !isSafePositiveInteger(cand.resource.capacity) ||
    typeof cand.resource.availableCapacity !== 'number' ||
    !Number.isSafeInteger(cand.resource.availableCapacity) ||
    cand.resource.availableCapacity < 0 ||
    cand.resource.availableCapacity > cand.resource.capacity
  ) {
    return confirmationDecision(request.workspaceId, 'RESOURCE_OR_SERVICE_UNVERIFIED');
  }

  const serviceDurationMs = cand.service.durationMinutes * 60 * 1000;
  const slotDurationMs = slotEndMs - slotStartMs;
  if (serviceDurationMs > slotDurationMs) {
    return confirmationDecision(request.workspaceId, 'RESOURCE_OR_SERVICE_UNVERIFIED');
  }

  if (cand.resource.availableCapacity < cand.service.requiredCapacity) {
    return confirmationDecision(request.workspaceId, 'RESOURCE_OR_SERVICE_UNVERIFIED');
  }

  // 11. Expiration calculation
  const expiryCandidates = [srcValidUntilMs, resValidUntilMs, srvValidUntilMs, slotStartMs];
  if (src.kind === 'OWNER_CONFIRMED') {
    expiryCandidates.push(srcCheckedAtMs + 15 * 60 * 1000);
  }
  const minExpiryMs = Math.min(...expiryCandidates);

  if (minExpiryMs <= nowMs) {
    return confirmationDecision(request.workspaceId, 'STALE_EVIDENCE');
  }

  const expiresAt = new Date(minExpiryMs).toISOString();

  // 12. Opportunity ID generation (Deterministic SHA-256 with R3 normalized instants)
  const canonicalTuple = [
    'slot-opportunity-v1',
    request.workspaceId,
    src.kind,
    src.sourceId,
    src.evidenceId,
    src.confirmedByRef ?? 'NONE',
    src.providerRef ?? 'NONE',
    snapshot.ledgerVersion,
    cand.slotId,
    cand.slotVersion,
    cand.catalogVersion,
    cand.service.serviceId,
    cand.service.catalogVersion,
    cand.resource.resourceId,
    cand.resource.version,
    cand.resource.ledgerVersion,
    cand.resource.evidenceId,
    cand.service.evidenceId,
    new Date(cand.range.startsAt).toISOString(),
    new Date(cand.range.endsAt).toISOString(),
    cand.timezone,
    new Date(src.checkedAt).toISOString(),
    new Date(src.validUntil).toISOString(),
    new Date(cand.resource.checkedAt).toISOString(),
    new Date(cand.resource.validUntil).toISOString(),
    new Date(cand.service.checkedAt).toISOString(),
    new Date(cand.service.validUntil).toISOString(),
    cand.service.durationMinutes,
    cand.service.requiredCapacity,
    cand.resource.capacity,
    cand.resource.availableCapacity,
    cand.service.priceKrw,
  ];

  const id = createHash('sha256').update(JSON.stringify(canonicalTuple)).digest('hex');

  const opportunity: SlotOpportunity = {
    id,
    workspaceId: request.workspaceId,
    slotId: cand.slotId,
    slotVersion: cand.slotVersion,
    ledgerVersion: snapshot.ledgerVersion,
    serviceId: cand.service.serviceId,
    catalogVersion: cand.service.catalogVersion,
    resourceId: cand.resource.resourceId,
    slotSource: src.kind,
    sourceId: src.sourceId,
    sourceEvidenceId: src.evidenceId,
    slotRange: {
      startsAt: cand.range.startsAt,
      endsAt: cand.range.endsAt,
    },
    timezone: cand.timezone,
    observedAt: src.checkedAt,
    evaluatedAt: now,
    expiresAt,
    evidenceIds: Object.freeze([
      src.evidenceId,
      cand.resource.evidenceId,
      cand.service.evidenceId,
    ]),
    confidence: 'VERIFIED',
    executionAllowed: false,
  };

  return {
    workspaceId: request.workspaceId,
    state: 'VERIFIED_SLOT',
    availabilityTruth: 'VERIFIED',
    reason: 'VERIFIED_SLOT',
    message: MSG_VERIFIED_SLOT,
    executionAllowed: false,
    opportunity,
  };
}

export async function generateSlotOpportunity(input: {
  request: SlotOpportunityRequest;
  readLedger?: SlotLedgerReadPort | null;
  now: string;
}): Promise<SlotOpportunityDecision> {
  // R2: Root null/undefined guard before destructuring
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return errorDecision('', 'INVALID_INPUT');
  }

  const { request, readLedger, now } = input;

  if (!validateRequestAndNow(request, now)) {
    const rawWs = (request as any)?.workspaceId;
    return errorDecision(typeof rawWs === 'string' ? rawWs : '', 'INVALID_INPUT');
  }

  // R6: Defensive copy and deep freeze of request to prevent port mutation
  const safeWorkspaceId = request.workspaceId;
  const safeRequest: Readonly<SlotOpportunityRequest> = Object.freeze({
    workspaceId: safeWorkspaceId,
    queryRange: Object.freeze({
      startsAt: request.queryRange.startsAt,
      endsAt: request.queryRange.endsAt,
    }),
    timezone: request.timezone,
  });

  if (!readLedger) {
    return evaluateSlotOpportunity({
      request: safeRequest,
      snapshot: { state: 'NOT_OBSERVED', workspaceId: safeWorkspaceId },
      now,
    });
  }

  try {
    const snapshot = await readLedger(safeRequest);
    return evaluateSlotOpportunity({ request: safeRequest, snapshot, now });
  } catch {
    return errorDecision(safeWorkspaceId, 'LEDGER_QUERY_ERROR');
  }
}

export function invalidateSlotOpportunity(input: {
  opportunity: SlotOpportunity;
  workspaceId: string;
  ledgerVersion: string;
  slotVersion: string;
  now: string;
}): SlotOpportunityDecision {
  // R2: Root null/undefined guard
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return errorDecision('', 'INVALID_INPUT');
  }

  const { opportunity, workspaceId, ledgerVersion, slotVersion, now } = input;

  const rawWs = typeof workspaceId === 'string' ? workspaceId : '';

  // R1: Strict validation of opportunity fields and invariants
  if (
    !opportunity ||
    typeof opportunity !== 'object' ||
    Array.isArray(opportunity) ||
    !rawWs.trim() ||
    typeof ledgerVersion !== 'string' ||
    !ledgerVersion.trim() ||
    typeof slotVersion !== 'string' ||
    !slotVersion.trim() ||
    !isValidIsoInstant(now) ||
    typeof opportunity.id !== 'string' ||
    !/^[a-f0-9]{64}$/.test(opportunity.id) ||
    typeof opportunity.workspaceId !== 'string' ||
    !opportunity.workspaceId.trim() ||
    typeof opportunity.slotId !== 'string' ||
    !opportunity.slotId.trim() ||
    typeof opportunity.slotVersion !== 'string' ||
    !opportunity.slotVersion.trim() ||
    typeof opportunity.ledgerVersion !== 'string' ||
    !opportunity.ledgerVersion.trim() ||
    typeof opportunity.serviceId !== 'string' ||
    !opportunity.serviceId.trim() ||
    typeof opportunity.catalogVersion !== 'string' ||
    !opportunity.catalogVersion.trim() ||
    typeof opportunity.resourceId !== 'string' ||
    !opportunity.resourceId.trim() ||
    (opportunity.slotSource !== 'OWNER_CONFIRMED' &&
      opportunity.slotSource !== 'INTERNAL_VERIFIED' &&
      opportunity.slotSource !== 'EXTERNAL_READBACK') ||
    typeof opportunity.sourceId !== 'string' ||
    !opportunity.sourceId.trim() ||
    typeof opportunity.sourceEvidenceId !== 'string' ||
    !opportunity.sourceEvidenceId.trim() ||
    !opportunity.slotRange ||
    typeof opportunity.slotRange !== 'object' ||
    Array.isArray(opportunity.slotRange) ||
    !isValidIsoInstant(opportunity.slotRange.startsAt) ||
    !isValidIsoInstant(opportunity.slotRange.endsAt) ||
    !isValidTimezone(opportunity.timezone) ||
    !isValidIsoInstant(opportunity.observedAt) ||
    !isValidIsoInstant(opportunity.evaluatedAt) ||
    !isValidIsoInstant(opportunity.expiresAt) ||
    !Array.isArray(opportunity.evidenceIds) ||
    opportunity.evidenceIds.length === 0 ||
    !opportunity.evidenceIds.every(id => typeof id === 'string' && id.trim()) ||
    opportunity.confidence !== 'VERIFIED' ||
    opportunity.executionAllowed !== false
  ) {
    return errorDecision(rawWs, 'INVALID_INPUT');
  }

  // Tenancy check
  if (rawWs !== opportunity.workspaceId) {
    return blockedDecision(rawWs, 'WORKSPACE_MISMATCH', 'UNKNOWN');
  }

  const nowMs = Date.parse(now);
  const observedAtMs = Date.parse(opportunity.observedAt);
  const evaluatedAtMs = Date.parse(opportunity.evaluatedAt);
  const expiresMs = Date.parse(opportunity.expiresAt);
  const slotStartMs = Date.parse(opportunity.slotRange.startsAt);
  const slotEndMs = Date.parse(opportunity.slotRange.endsAt);

  // Temporal order check: observedAt <= evaluatedAt <= now < expiresAt <= slotStart < slotEnd
  if (
    observedAtMs > evaluatedAtMs ||
    evaluatedAtMs > nowMs ||
    slotStartMs >= slotEndMs ||
    expiresMs > slotStartMs
  ) {
    return errorDecision(rawWs, 'INVALID_INPUT');
  }

  if (
    opportunity.slotSource === 'OWNER_CONFIRMED' &&
    expiresMs > observedAtMs + 15 * 60 * 1000
  ) {
    return errorDecision(rawWs, 'INVALID_INPUT');
  }

  if (nowMs >= expiresMs) {
    return confirmationDecision(rawWs, 'STALE_EVIDENCE');
  }

  if (
    ledgerVersion !== opportunity.ledgerVersion ||
    slotVersion !== opportunity.slotVersion
  ) {
    return confirmationDecision(rawWs, 'VERSION_CHANGED');
  }

  // R1 Output whitelist: return pristine verified object without spreading unknown properties
  const cleanOpportunity: SlotOpportunity = {
    id: opportunity.id,
    workspaceId: opportunity.workspaceId,
    slotId: opportunity.slotId,
    slotVersion: opportunity.slotVersion,
    ledgerVersion: opportunity.ledgerVersion,
    serviceId: opportunity.serviceId,
    catalogVersion: opportunity.catalogVersion,
    resourceId: opportunity.resourceId,
    slotSource: opportunity.slotSource,
    sourceId: opportunity.sourceId,
    sourceEvidenceId: opportunity.sourceEvidenceId,
    slotRange: {
      startsAt: opportunity.slotRange.startsAt,
      endsAt: opportunity.slotRange.endsAt,
    },
    timezone: opportunity.timezone,
    observedAt: opportunity.observedAt,
    evaluatedAt: opportunity.evaluatedAt,
    expiresAt: opportunity.expiresAt,
    evidenceIds: Object.freeze([...opportunity.evidenceIds]),
    confidence: 'VERIFIED',
    executionAllowed: false,
  };

  return {
    workspaceId: rawWs,
    state: 'VERIFIED_SLOT',
    availabilityTruth: 'VERIFIED',
    reason: 'VERIFIED_SLOT',
    message: MSG_VERIFIED_SLOT,
    executionAllowed: false,
    opportunity: cleanOpportunity,
  };
}
