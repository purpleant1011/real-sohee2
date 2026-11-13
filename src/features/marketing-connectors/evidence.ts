import { CONNECTOR_CATALOG, type ConnectorId } from './catalog';

export type { ConnectorId };

export const VALID_CONNECTOR_IDS = new Set<ConnectorId>(
  CONNECTOR_CATALOG.map((c) => c.id),
);

export interface ConnectorEvidence {
  readonly id: string;
  readonly workspaceId: string;
  readonly connectorId: ConnectorId;
  readonly sourceId: string;
  readonly revision: string;
  readonly consentGeneration: number;
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly purpose: 'marketing' | 'booking';
  readonly text: string;
  readonly derivedFromGoogle: boolean;
  readonly revokedAt: string | null;
}

export interface SelectUsableEvidenceInput {
  readonly workspaceId: string;
  readonly connectorId: ConnectorId;
  readonly consentGeneration: number;
  readonly now: string;
  readonly purpose: 'marketing' | 'booking';
  readonly evidence: readonly ConnectorEvidence[];
}

export interface UntrustedEvidenceEnvelope {
  readonly kind: 'untrusted_connector_evidence';
  readonly id: string;
  readonly workspaceId: string;
  readonly connectorId: ConnectorId;
  readonly sourceId: string;
  readonly revision: string;
  readonly purpose: 'marketing' | 'booking';
  readonly derivedFromGoogle: boolean;
  readonly safeContent: string;
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly flags: {
    readonly isUntrustedUserContent: true;
    readonly allowExecution: false;
    readonly allowPromptInjection: false;
  };
}

// Calling convention contract:
// - `now` in selectUsableEvidence is the authoritative server-generated current ISO timestamp.
// - Database RLS matches this using `pg_catalog.statement_timestamp()`.
// - Clock skew allowance: up to 300 seconds (5 minutes) in the future is allowed.
//   Any latest candidate exceeding +300 seconds is quarantined (fail closed).
export const MAX_FUTURE_SKEW_MS = 300 * 1000;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TOTAL_INPUT_SCAN = 1000;
const MAX_OUTPUT_EVIDENCE_COUNT = 100;
const MAX_EVIDENCE_TEXT_LENGTH = 10000;

export function isValidIsoDateString(val: unknown): val is string {
  if (typeof val !== 'string') return false;
  if (!ISO_DATE_REGEX.test(val)) return false;
  const time = Date.parse(val);
  return !Number.isNaN(time);
}

export function selectUsableEvidence(
  input: SelectUsableEvidenceInput,
): readonly ConnectorEvidence[] {
  // 1. Strict input validation without type coercion (fail-closed)
  if (typeof input !== 'object' || input === null) return [];
  if (typeof input.workspaceId !== 'string' || input.workspaceId.trim() === '') return [];
  if (!VALID_CONNECTOR_IDS.has(input.connectorId)) return [];
  if (
    typeof input.consentGeneration !== 'number' ||
    !Number.isInteger(input.consentGeneration) ||
    input.consentGeneration < 0
  ) {
    return [];
  }
  if (input.purpose !== 'marketing' && input.purpose !== 'booking') return [];
  if (!isValidIsoDateString(input.now)) return [];
  if (!Array.isArray(input.evidence)) return [];
  if (input.evidence.length > MAX_TOTAL_INPUT_SCAN) return [];

  const nowTime = Date.parse(input.now);

  // 2. Filter matching tenant, provider, and consent generation across the bounded input (without early break).
  // Scope matches DB RLS: candidate revision/quarantine/tie resolution operates strictly within the active consent generation.
  // Items from an older generation (e.g. gen1) never shadow or block active gen2 items.
  const matchingItems: ConnectorEvidence[] = [];
  for (const item of input.evidence) {
    if (typeof item !== 'object' || item === null) continue;
    if (item.workspaceId !== input.workspaceId) continue;
    if (item.connectorId !== input.connectorId) continue;
    if (item.consentGeneration !== input.consentGeneration) continue;
    matchingItems.push(item);
  }

  // 3. For the matching tenant, provider, and consent generation, find the single latest revision per sourceId.
  // - Latest revision check is source-wide regardless of purpose (intended design policy):
  //   if a newer revision for the same source exists with a different purpose (e.g. booking),
  //   the source is evaluated by that newer revision and older facts (e.g. marketing) are never resurrected.
  // - If any item for a sourceId in this scope has a malformed observedAt or invalid revision,
  //   quarantine the entire source to prevent reviving older facts.
  // - Latest candidate is determined strictly by observedAt timestamp.
  // - If multiple revisions share the exact same latest observedAt timestamp, the tie fails closed (entire source excluded).
  // - Clock skew allowance: if the latest candidate is more than 300 seconds in the future (observedAt - now > MAX_FUTURE_SKEW_MS),
  //   the entire source is quarantined (fail closed; no older facts resurrected, no future facts exposed).
  //   Boundary: now + 300s is allowed; now + 301s is quarantined.
  const quarantinedSourceIds = new Set<string>();
  const tiedSourceIds = new Set<string>();
  const latestBySourceId = new Map<string, ConnectorEvidence>();

  for (const item of matchingItems) {
    if (typeof item !== 'object' || item === null) continue;
    if (typeof item.sourceId !== 'string' || item.sourceId.trim() === '') continue;

    if (
      !isValidIsoDateString(item.observedAt) ||
      typeof item.revision !== 'string' ||
      item.revision.trim() === ''
    ) {
      quarantinedSourceIds.add(item.sourceId);
      continue;
    }

    const itemTime = Date.parse(item.observedAt);
    const existing = latestBySourceId.get(item.sourceId);

    if (!existing) {
      latestBySourceId.set(item.sourceId, item);
      tiedSourceIds.delete(item.sourceId);
    } else {
      const existingTime = Date.parse(existing.observedAt);
      if (itemTime > existingTime) {
        latestBySourceId.set(item.sourceId, item);
        tiedSourceIds.delete(item.sourceId);
      } else if (itemTime === existingTime && item.id !== existing.id) {
        tiedSourceIds.add(item.sourceId);
      }
    }
  }

  // Quarantined sources and tied latest revisions are purged (fail closed)
  for (const tiedId of tiedSourceIds) {
    latestBySourceId.delete(tiedId);
  }
  for (const quarantinedId of quarantinedSourceIds) {
    latestBySourceId.delete(quarantinedId);
  }

  // Quarantine any source whose latest candidate observedAt exceeds clock skew allowance (> +300s)
  for (const [sourceId, candidate] of latestBySourceId.entries()) {
    if (Date.parse(candidate.observedAt) - nowTime > MAX_FUTURE_SKEW_MS) {
      latestBySourceId.delete(sourceId);
    }
  }

  // 4. Validate only the latest revision. If the latest revision is revoked, expired,
  // has missing/empty id, or invalid, the source is excluded (an older revision is never resurrected).
  const validItems: ConnectorEvidence[] = [];

  for (const item of latestBySourceId.values()) {
    // Evidence identity must be a non-empty string
    if (typeof item.id !== 'string' || item.id.trim() === '') continue;

    // Consent generation strictly verified without coercion
    if (
      typeof item.consentGeneration !== 'number' ||
      !Number.isInteger(item.consentGeneration) ||
      item.consentGeneration !== input.consentGeneration
    ) {
      continue;
    }

    if (item.purpose !== input.purpose) continue;
    if (item.revokedAt !== null) continue; // Revocation on latest revision excludes source
    if (typeof item.text !== 'string' || item.text.trim() === '') continue;
    if (item.text.length > MAX_EVIDENCE_TEXT_LENGTH) continue;
    if (typeof item.derivedFromGoogle !== 'boolean') continue;
    if (!isValidIsoDateString(item.expiresAt)) continue;

    const observedTime = Date.parse(item.observedAt);
    const expiresTime = Date.parse(item.expiresAt);

    // Fail closed: future observation timestamp exceeding clock skew allowance not allowed
    if (observedTime - nowTime > MAX_FUTURE_SKEW_MS) continue;

    // Fail closed: exact expiry boundary (expiresAt <= nowTime) is expired
    if (expiresTime <= nowTime) continue;

    // Retention: maximum 30 days from observation time
    if (nowTime - observedTime > THIRTY_DAYS_MS) continue;

    validItems.push(item);
  }

  // 5. Return deterministically sorted by sourceId, capped to MAX_OUTPUT_EVIDENCE_COUNT
  return validItems
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId))
    .slice(0, MAX_OUTPUT_EVIDENCE_COUNT);
}

export function toUntrustedContextEnvelope(
  evidence: ConnectorEvidence,
): UntrustedEvidenceEnvelope {
  // Defang prompt injection directives like SYSTEM:, [INST], etc.
  const sanitizedContent = evidence.text
    .replace(/^SYSTEM\s*:/i, '[USER_DATA_CONTENT]:')
    .replace(/^Human\s*:/i, '[USER_DATA_CONTENT]:')
    .replace(/^Assistant\s*:/i, '[USER_DATA_CONTENT]:');

  return {
    kind: 'untrusted_connector_evidence',
    id: evidence.id,
    workspaceId: evidence.workspaceId,
    connectorId: evidence.connectorId,
    sourceId: evidence.sourceId,
    revision: evidence.revision,
    purpose: evidence.purpose,
    derivedFromGoogle: evidence.derivedFromGoogle,
    safeContent: sanitizedContent,
    observedAt: evidence.observedAt,
    expiresAt: evidence.expiresAt,
    flags: {
      isUntrustedUserContent: true,
      allowExecution: false,
      allowPromptInjection: false,
    },
  };
}
