import { z } from 'zod'
import type { PlaceProfileField } from '@/features/profile-management/profile-health'

const FIELDS = ['name', 'address', 'hours', 'phone'] as const satisfies readonly PlaceProfileField[]
type Field = typeof FIELDS[number]
type FindingState = 'MATCH' | 'DISCREPANCY' | 'NOT_OBSERVED' | 'STALE' | 'ERROR'
const OPAQUE_REF_PATTERN = /^[a-zA-Z0-9_:-]*$/
const opaqueRef = z.string().regex(OPAQUE_REF_PATTERN, 'INVALID_OPAQUE_REF').max(256)
/**
 * Output-boundary guard: an audit finding may only carry an opaque identifier.
 * Zod already rejects bad input, but the CLI prints these refs to stdout, so the
 * value is re-verified here and dropped rather than echoed if it ever slips past.
 */
export function sanitizeOpaqueRef(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.length > 256 || !OPAQUE_REF_PATTERN.test(value)) return null
  return value
}
const factSchema = z.object({ value: z.string(), confirmedAt: z.string(), sourceRef: opaqueRef })
const schema = z.object({
  workspaceId: z.string().min(1), datasetMode: z.enum(['ACTUAL', 'TEST']), now: z.string(), maxAgeMs: z.number().finite().positive(), expectedListingId: z.string().min(1),
  facts: z.record(z.string(), factSchema),
  listing: z.object({ workspaceId: z.string(), listingId: z.string(), identityEvidenceRef: opaqueRef, sourceUrl: z.string(), observedAt: z.string().nullable(), state: z.enum(['OBSERVED', 'ERROR', 'NOT_OBSERVED']), fields: z.record(z.string(), z.string().nullable()) }),
  ctas: z.array(z.object({ kind: z.enum(['booking', 'inquiry']), expectedUrl: z.string(), observedUrl: z.string().nullable(), destinationWorkspaceId: z.string().nullable(), statusCode: z.number().int().nullable(), observedAt: z.string().nullable(), evidenceRef: opaqueRef.nullable() })),
})
export type PresenceAuditInput = Omit<z.infer<typeof schema>, 'facts'> & { facts: Partial<Record<Field, z.infer<typeof factSchema>>> }
export interface PresenceFinding {
  field: Field | 'booking' | 'inquiry' | 'cta'
  state: FindingState
  sourceRef: string | null
  observedAt: string | null
  manualOnly: true
  suggestion: string
}
const datetime = z.string().datetime({ offset: true })
function time(value: string | null): number | null {
  return value !== null && datetime.safeParse(value).success ? Date.parse(value) : null
}

/** Pure URL inspection only: never fetch, resolve DNS, follow a redirect, or emit query credentials. */
export function inspectPublicUrl(value: string | null): { canonical: string; redacted: string } | null {
  if (!value) return null
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase().replace(/\.$/, '')
    if (url.protocol !== 'https:' || url.username || url.password || host === 'localhost' || !host.includes('.') ||
      host.endsWith('.local') || host.endsWith('.localhost') || host.startsWith('[') ||
      /^(?:0|10|127)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)) return null
    for (const key of [...url.searchParams.keys()]) {
      if (/token|signature|credential|password|secret|^key$|^sig$|^expires$/i.test(key)) return null
      if (/^utm_/i.test(key)) url.searchParams.delete(key)
    }
    url.hash = ''; url.searchParams.sort()
    return { canonical: url.href, redacted: `${url.origin}${url.pathname}` }
  } catch { return null }
}

export function auditLocalPresence(raw: PresenceAuditInput) {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw new Error('AUDIT_INPUT_INVALID')
  const input = parsed.data
  const now = time(input.now)
  if (now === null) throw new Error('AUDIT_TIME_INVALID')
  const ageState = (at: string | null): FindingState | null => {
    const observed = time(at)
    if (observed === null) return 'NOT_OBSERVED'
    if (observed > now) return 'ERROR'
    return now - observed > input.maxAgeMs ? 'STALE' : null
  }
  const source = inspectPublicUrl(input.listing.sourceUrl)
  const sourceState: FindingState | null = input.listing.state === 'ERROR' ? 'ERROR'
    : input.listing.state !== 'OBSERVED' || input.listing.workspaceId !== input.workspaceId ||
      input.listing.listingId !== input.expectedListingId || !input.listing.identityEvidenceRef.trim() ? 'NOT_OBSERVED'
      : !source ? 'ERROR' : ageState(input.listing.observedAt)
  const normalize = (field: Field, value: string) => field === 'phone'
    ? value.replace(/[\s()+-]/g, '') : value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  const finding = (field: PresenceFinding['field'], state: FindingState, sourceRef: string | null, observedAt: string | null): PresenceFinding => ({
    field, state, sourceRef, observedAt, manualOnly: true,
    suggestion: state === 'DISCREPANCY' ? '출처를 대조하고 사장님 확인 후 공식 화면에서 수동으로 수정해 주세요.'
      : state === 'MATCH' ? '제공된 근거의 확인 시각을 함께 검토해 주세요.' : '최신 공식 자료와 해당 가게의 확인 근거가 필요합니다.',
  })
  const findings = FIELDS.map(field => {
    const fact = input.facts[field]
    const value = input.listing.fields[field]
    const confirmed = fact ? time(fact.confirmedAt) : null
    const state = sourceState ?? (!fact?.value.trim() || !fact.sourceRef.trim() || confirmed === null || confirmed > now || !value?.trim()
      ? 'NOT_OBSERVED' : normalize(field, fact.value) === normalize(field, value) ? 'MATCH' : 'DISCREPANCY')
    return finding(field, state, sanitizeOpaqueRef(fact?.sourceRef), input.listing.observedAt)
  })
  if (!input.ctas.length) findings.push(finding('cta', 'NOT_OBSERVED', null, null))
  for (const cta of input.ctas) {
    const expected = inspectPublicUrl(cta.expectedUrl)
    const observed = inspectPublicUrl(cta.observedUrl)
    const state = sourceState ?? (!expected || !observed ? 'ERROR' : ageState(cta.observedAt) ??
      (!cta.evidenceRef?.trim() ? 'NOT_OBSERVED' : cta.statusCode !== 200 || cta.destinationWorkspaceId !== input.workspaceId ||
        observed.canonical !== expected.canonical ? 'DISCREPANCY' : 'MATCH'))
    findings.push(finding(cta.kind, state, sanitizeOpaqueRef(cta.evidenceRef), cta.observedAt))
  }
  return { workspaceId: input.workspaceId, datasetMode: input.datasetMode, checkedAt: input.now,
    verificationLevel: 'IMPORTED_EVIDENCE_ONLY' as const, sourceUrl: source?.redacted ?? null,
    state: findings.every(f => f.state === 'MATCH') ? 'CONSISTENT' as const
      : findings.some(f => f.state === 'ERROR' || f.state === 'STALE' || f.state === 'NOT_OBSERVED') ? 'INSUFFICIENT_EVIDENCE' as const : 'REVIEW_REQUIRED' as const,
    findings, capability: 'READ_ONLY_ANALYSIS' as const,
  }
}
