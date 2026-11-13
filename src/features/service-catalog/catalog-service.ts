import {
  bookingReadiness,
  catalogServiceCreateSchema,
  catalogServiceUpdateSchema,
  type CatalogServiceCreateInput,
  type CatalogServiceRecord,
  type CatalogServiceUpdateInput,
  type ReadinessGap,
} from './schema'

/**
 * ANI-1609 — owner-facing service catalog on top of `workspace_products_services`.
 *
 * Deliberately not a second system: the row is what booking confirmation reads
 * (`catalog_version` = `updated_at`), and price/duration are mirrored into the existing
 * approved-Fact flow so drafts built on the old snapshot go stale instead of publishing
 * a price the owner no longer charges.
 */

export interface CatalogRow {
  id: string
  workspace_id: string
  name: string
  price: number | null
  duration_minutes: number | null
  resource_name: string | null
  cancellation_policy: string | null
  valid_from: string | null
  valid_until: string | null
  active: boolean
  updated_at: string
  knowledge_fact_id: string | null
}

export interface CatalogGateway {
  list(workspaceId: string): PromiseLike<{ data: unknown; error: unknown }>
  find(workspaceId: string, serviceId: string): PromiseLike<{ data: unknown; error: unknown }>
  insert(payload: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>
  update(
    workspaceId: string,
    serviceId: string,
    expectedUpdatedAt: string,
    patch: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>
  countStaleSlots(workspaceId: string, serviceId: string, catalogVersion: string): PromiseLike<{ count: number | null; error: unknown }>
  /**
   * Records the service↔fact link. Guarded by the catalog version the caller just wrote, and it must
   * NOT move `updated_at`: that column is the catalog version booking slots are bound to.
   */
  setFactLink(
    workspaceId: string,
    serviceId: string,
    expectedUpdatedAt: string,
    knowledgeFactId: string,
  ): PromiseLike<{ data: unknown; error: unknown }>
}

export interface FactWriter {
  create(input: { workspaceId: string; category: string; content: string }): Promise<{ id: string }>
  update(input: { workspaceId: string; factId: string; content: string }): Promise<{ id: string }>
  /** Newest fact with exactly this content, whatever its status. Self-heals a row whose link was lost. */
  findByContent(input: {
    workspaceId: string
    category: string
    content: string
  }): Promise<{ id: string } | null>
}

export type CatalogRole = 'owner' | 'manager' | 'reviewer' | 'viewer' | string

export class CatalogForbiddenError extends Error {
  readonly code = 'CATALOG_FORBIDDEN'
}
export class CatalogNotFoundError extends Error {
  readonly code = 'CATALOG_NOT_FOUND'
}
export class CatalogConflictError extends Error {
  readonly code = 'CATALOG_CONFLICT'
}
export class CatalogInvalidError extends Error {
  readonly code = 'CATALOG_INVALID'
  constructor(readonly issues: { path: string; message: string }[]) {
    super(issues[0]?.message ?? '입력값을 확인해 주세요.')
  }
}
export class CatalogUnavailableError extends Error {
  readonly code = 'CATALOG_UNAVAILABLE'
}

export type FactSync =
  | { status: 'SYNCED'; factId: string }
  | { status: 'SKIPPED_INCOMPLETE' }
  | { status: 'SKIPPED_UNCHANGED' }
  | { status: 'SKIPPED_FUTURE_EFFECTIVE_DATE'; effectiveFrom: string }
  | { status: 'FAILED'; message: string }

export interface CatalogServiceView extends CatalogServiceRecord {
  readiness: { ready: boolean; missing: ReadinessGap[] }
}

export interface CatalogActor {
  gateway: CatalogGateway
  facts: FactWriter
  workspaceId: string
  role: CatalogRole
}

const READ_ROLES = new Set(['owner', 'manager', 'reviewer', 'viewer'])
const WRITE_ROLES = new Set(['owner', 'manager'])

function canWrite(role: CatalogRole): boolean {
  return WRITE_ROLES.has(role)
}

function toRecord(raw: CatalogRow): CatalogServiceRecord {
  return {
    id: raw.id,
    workspaceId: raw.workspace_id,
    name: raw.name,
    price: raw.price,
    durationMinutes: raw.duration_minutes,
    resourceName: raw.resource_name,
    cancellationPolicy: raw.cancellation_policy,
    validFrom: raw.valid_from,
    validUntil: raw.valid_until,
    active: raw.active,
    updatedAt: raw.updated_at,
    knowledgeFactId: raw.knowledge_fact_id,
  }
}

function isRow(value: unknown): value is CatalogRow {
  const row = value as CatalogRow | null
  return Boolean(row && typeof row === 'object' && typeof row.id === 'string' && typeof row.workspace_id === 'string')
}

function issuesOf(error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }) {
  return error.issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join('.'),
    message: issue.message,
  }))
}

export async function listCatalogServices(
  gateway: CatalogGateway,
  workspaceId: string,
  nowIso: string = new Date().toISOString(),
): Promise<CatalogServiceView[]> {
  const { data, error } = await gateway.list(workspaceId)
  if (error || !Array.isArray(data)) throw new CatalogUnavailableError('카탈로그를 불러오지 못했어요.')
  return data
    .filter(isRow)
    // Defence in depth: never surface another tenant's row even if the query leaks one.
    .filter((row) => row.workspace_id === workspaceId)
    .map((row) => {
      const record = toRecord(row)
      return { ...record, readiness: bookingReadiness(record, nowIso) }
    })
}

/** What the owner typed into the fact content — never a guess, never a placeholder. */
export function factContentFor(input: {
  name: string
  price: number | null
  durationMinutes: number | null
}): string {
  const parts: string[] = []
  if (input.price !== null) parts.push(`${input.price.toLocaleString('ko-KR')}원`)
  if (input.durationMinutes !== null) parts.push(`${input.durationMinutes}분`)
  return `${input.name} — ${parts.join(' · ')}`
}

/**
 * Rows saved before the link write existed carry `knowledge_fact_id = NULL`. Without this, every later
 * save would fork a brand-new active fact instead of superseding the previous claim. Adopting the
 * fact whose content is exactly the previous content repairs those rows on their next save.
 * Best effort on purpose: a failed lookup must not block the owner's save.
 */
async function adoptLinkedFact(actor: CatalogActor, previousContent: string | null): Promise<string | null> {
  if (!previousContent) return null
  try {
    const found = await actor.facts.findByContent({
      workspaceId: actor.workspaceId,
      category: 'MENU',
      content: previousContent,
    })
    return found?.id ?? null
  } catch {
    return null
  }
}

async function syncFact(
  actor: CatalogActor,
  values: { name: string; price: number | null; durationMinutes: number | null; validFrom: string | null },
  existingFactId: string | null,
  nowIso: string,
  previousContent: string | null = null,
): Promise<FactSync> {
  // A future price must not overwrite today's fact; the effective-date flow (ANI-1601) owns that switch.
  if (values.validFrom && Date.parse(values.validFrom) > Date.parse(nowIso)) {
    return { status: 'SKIPPED_FUTURE_EFFECTIVE_DATE', effectiveFrom: values.validFrom }
  }
  if (values.price === null || values.durationMinutes === null) {
    return { status: 'SKIPPED_INCOMPLETE' }
  }
  const content = factContentFor(values)
  const factId = existingFactId ?? await adoptLinkedFact(actor, previousContent)
  try {
    const result = factId
      ? await actor.facts.update({ workspaceId: actor.workspaceId, factId, content })
      : await actor.facts.create({ workspaceId: actor.workspaceId, category: 'MENU', content })
    if (!result?.id) return { status: 'FAILED', message: '사실 저장 결과를 확인하지 못했어요.' }
    return { status: 'SYNCED', factId: result.id }
  } catch (error) {
    return { status: 'FAILED', message: error instanceof Error ? error.message : String(error) }
  }
}

function linkFailureMessage(error: unknown): string {
  const detail = (error as { message?: string } | null)?.message
  return `사실은 저장했지만 서비스-사실 연결을 기록하지 못했어요: ${detail ?? '알 수 없는 오류'}`
}

/** Writes the service↔fact link. `row` is null when the write did not land. */
async function linkFact(
  actor: CatalogActor,
  serviceId: string,
  expectedUpdatedAt: string,
  factId: string,
): Promise<{ row: CatalogRow | null; error: unknown }> {
  const { data, error } = await actor.gateway.setFactLink(actor.workspaceId, serviceId, expectedUpdatedAt, factId)
  return { row: error || !isRow(data) ? null : data, error }
}

export interface CreateCatalogResult {
  service: CatalogServiceView
  factSync: FactSync
}

export async function createCatalogService(
  actor: CatalogActor,
  rawInput: unknown,
  nowIso: string = new Date().toISOString(),
): Promise<CreateCatalogResult> {
  if (!canWrite(actor.role)) throw new CatalogForbiddenError('서비스 카탈로그는 대표 또는 관리자만 저장할 수 있어요.')
  const parsed = catalogServiceCreateSchema.safeParse(rawInput)
  if (!parsed.success) throw new CatalogInvalidError(issuesOf(parsed.error))
  const input: CatalogServiceCreateInput = parsed.data

  const { data, error } = await actor.gateway.insert({
    workspace_id: actor.workspaceId,
    name: input.name,
    price: input.price,
    duration_minutes: input.durationMinutes,
    resource_name: input.resourceName,
    cancellation_policy: input.cancellationPolicy,
    valid_from: input.validFrom,
    valid_until: input.validUntil,
    active: input.active,
  })
  if (error || !isRow(data)) throw new CatalogUnavailableError('저장하지 못했어요. 잠시 후 다시 시도해 주세요.')

  const factSync = await syncFact(actor, input, null, nowIso)
  const record = toRecord(data)
  if (factSync.status !== 'SYNCED') {
    return { service: { ...record, readiness: bookingReadiness(record, nowIso) }, factSync }
  }

  // The link is what lets the NEXT save supersede this claim instead of forking a second one.
  const linked = await linkFact(actor, record.id, record.updatedAt, factSync.factId)
  if (!linked.row) {
    return {
      service: { ...record, readiness: bookingReadiness(record, nowIso) },
      factSync: { status: 'FAILED', message: linkFailureMessage(linked.error) },
    }
  }
  const linkedRecord = toRecord(linked.row)
  return { service: { ...linkedRecord, readiness: bookingReadiness(linkedRecord, nowIso) }, factSync }
}

export interface UpdateCatalogResult {
  service: CatalogServiceView
  factSync: FactSync
  /** AVAILABLE slots still bound to the previous catalog version: the owner must re-confirm them. */
  slotsRequiringReconfirmation: number
}

export async function updateCatalogService(
  actor: CatalogActor,
  serviceId: string,
  rawInput: unknown,
  nowIso: string = new Date().toISOString(),
): Promise<UpdateCatalogResult> {
  if (!canWrite(actor.role)) throw new CatalogForbiddenError('서비스 카탈로그는 대표 또는 관리자만 저장할 수 있어요.')
  const parsed = catalogServiceUpdateSchema.safeParse(rawInput)
  if (!parsed.success) throw new CatalogInvalidError(issuesOf(parsed.error))
  const input: CatalogServiceUpdateInput = parsed.data

  const found = await actor.gateway.find(actor.workspaceId, serviceId)
  if (found.error || !isRow(found.data) || found.data.workspace_id !== actor.workspaceId) {
    throw new CatalogNotFoundError('서비스를 찾을 수 없어요. 목록을 새로고침해 주세요.')
  }
  const current = found.data
  if (current.updated_at !== input.expectedUpdatedAt) {
    throw new CatalogConflictError('다른 곳에서 먼저 수정됐어요. 최신 내용을 확인한 뒤 다시 저장해 주세요.')
  }

  const patch: Record<string, unknown> = {}
  if ('name' in input) patch.name = input.name
  if ('price' in input) patch.price = input.price
  if ('durationMinutes' in input) patch.duration_minutes = input.durationMinutes
  if ('resourceName' in input) patch.resource_name = input.resourceName
  if ('cancellationPolicy' in input) patch.cancellation_policy = input.cancellationPolicy
  if ('validFrom' in input) patch.valid_from = input.validFrom
  if ('validUntil' in input) patch.valid_until = input.validUntil
  if ('active' in input) patch.active = input.active

  const { data, error } = await actor.gateway.update(
    actor.workspaceId,
    serviceId,
    input.expectedUpdatedAt,
    patch,
  )
  // The write itself is guarded on the version we read, so a race lands here as a conflict, not an overwrite.
  if ((error as { code?: string } | null)?.code === 'CATALOG_CONFLICT') {
    throw new CatalogConflictError('다른 곳에서 먼저 수정됐어요. 최신 내용을 확인한 뒤 다시 저장해 주세요.')
  }
  if (error || !isRow(data)) throw new CatalogUnavailableError('저장하지 못했어요. 잠시 후 다시 시도해 주세요.')

  const record = toRecord(data)

  // Editing only a non-fact field (cancellation rule, resource, active) must not invalidate an approved
  // draft: the mirrored fact would be identical, and re-reviewing identical facts is a false alarm.
  const factInputChanged =
    ('name' in input && input.name !== current.name) ||
    ('price' in input && input.price !== current.price) ||
    ('durationMinutes' in input && input.durationMinutes !== current.duration_minutes)

  const factSync = factInputChanged
    ? await syncFact(
        actor,
        {
          name: record.name,
          price: record.price,
          durationMinutes: record.durationMinutes,
          validFrom: record.validFrom,
        },
        current.knowledge_fact_id,
        nowIso,
        factContentFor({
          name: current.name,
          price: current.price,
          durationMinutes: current.duration_minutes,
        }),
      )
    : ({ status: 'SKIPPED_UNCHANGED' } satisfies FactSync)

  let stored = record
  let reportedSync = factSync
  if (factSync.status === 'SYNCED') {
    // Guarded by the version this update returned, not the one we read: a concurrent save must not be
    // silently repointed at our fact.
    const linked = await linkFact(actor, serviceId, record.updatedAt, factSync.factId)
    if (linked.row) {
      stored = toRecord(linked.row)
    } else {
      reportedSync = { status: 'FAILED', message: linkFailureMessage(linked.error) }
    }
  }

  const slots = await actor.gateway.countStaleSlots(actor.workspaceId, serviceId, record.updatedAt)
  if (slots.error) {
    // The save succeeded; not knowing the slot count must be said out loud, not guessed.
    throw new CatalogUnavailableError(
      '서비스는 저장했지만 다시 확인해야 할 예약 가능 시간을 세지 못했어요. 예약 장부를 직접 확인해 주세요.',
    )
  }

  return {
    service: { ...stored, readiness: bookingReadiness(stored, nowIso) },
    factSync: reportedSync,
    slotsRequiringReconfirmation: slots.count ?? 0,
  }
}

export { READ_ROLES }
