/**
 * Human approval records for live-gated golden checks.
 *
 * A golden check that needs external evidence (isolated DB, browser, provider allowlist/contract,
 * PG sandbox) stays NOT_VERIFIED forever on offline contract tests alone. This module lets a named
 * human record that a specific gap is accepted for a bounded window, with a reason and a pilot plan,
 * so the report can distinguish "nobody looked at this" from "a person signed off on this gap".
 *
 * An approval is NOT evidence. It never turns a check into CONTRACT_PASS, it never touches a FAIL,
 * and it can only ever attach to a check whose coverage entry states a live requirement. A check
 * whose linked tests did not run, or whose test file is missing, cannot be approved away.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface ApprovalRecord {
  taskId: string
  checkId: string
  /** Human identity that owns the gap. Must be in the repository's approver allowlist. */
  approvedBy: string
  /** ISO-8601 instant with an explicit offset, e.g. 2026-10-23T02:10:00Z. */
  approvedAt: string
  /** Tracker reference for the approval, e.g. ANI-1655#comment-abc123. */
  approvalRef: string
  reason: string
  /** Repo-relative path to the pilot checklist that says how this gap will be verified. */
  pilotPlanRef: string
  /** ISO-8601 instant after which the approval stops counting. */
  expiresAt: string
}

export interface ApprovalValidationContext {
  /** Every task id in the manifest. */
  taskIds: readonly string[]
  /** Check ids declared for a task in coverage.json. */
  checkIdsFor: (taskId: string) => readonly string[]
  /** Check ids that carry a live requirement for a task (the only approvable ones). */
  liveCheckIdsFor: (taskId: string) => readonly string[]
  /** Repo root used to confirm pilotPlanRef exists. */
  repoRoot: string
  /** Injection point for tests; defaults to the real clock. */
  now?: Date
  /** Identities permitted to sign. Anything else is rejected, not silently ignored. */
  allowedApprovers: readonly string[]
}

export interface ApprovalValidation {
  approvals: ApprovalRecord[]
  /** Every problem found. A non-empty list means the report must not treat the file as valid. */
  errors: string[]
}

/**
 * Identities permitted to sign approvals. This lives in code, not in approvals.json, so a forged
 * file cannot add its own approver. Changing it requires a reviewed commit.
 */
export const ALLOWED_APPROVERS: readonly string[] = ['example-owner']

const TASK_ID = /^G093-(?:0[1-9]|1[0-2])$/
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const ISSUE_REF = /^ANI-\d+(?:#[\w-]+)?$/
const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/
const MIN_REASON = 9

export function approvalKey(taskId: string, checkId: string): string {
  return `${taskId}/${checkId}`
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

/** Rejects repo-escaping or absolute pilot paths before they ever reach the filesystem. */
function safeRelativePath(value: string): string | null {
  if (value.startsWith('/') || value.includes('..') || value.includes('\\')) return null
  return value
}

/**
 * Validates the raw parsed approval file. Every entry is checked independently so one bad record
 * cannot hide behind a good one, and a single error anywhere invalidates the whole file: a partially
 * trusted approval file is not a thing this gate should support.
 */
export function validateApprovals(raw: unknown, ctx: ApprovalValidationContext): ApprovalValidation {
  const errors: string[] = []
  const approvals: ApprovalRecord[] = []
  const now = ctx.now ?? new Date()
  const seen = new Set<string>()

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { approvals: [], errors: ['APPROVAL_FILE_NOT_AN_OBJECT'] }
  }
  const file = raw as Record<string, unknown>
  if (file.schemaVersion !== 1) errors.push('APPROVAL_SCHEMA_VERSION_UNSUPPORTED')
  if (!Array.isArray(file.approvals)) {
    return { approvals: [], errors: [...errors, 'APPROVAL_LIST_MISSING'] }
  }

  file.approvals.forEach((candidate, index) => {
    const where = `APPROVAL[${index}]`
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      errors.push(`${where}:NOT_AN_OBJECT`)
      return
    }
    const record = candidate as Record<string, unknown>
    const errorsBefore = errors.length

    for (const field of ['taskId', 'checkId', 'approvedBy', 'approvedAt', 'approvalRef', 'reason', 'pilotPlanRef', 'expiresAt']) {
      if (!isNonEmptyString(record[field])) errors.push(`${where}:MISSING_${field.toUpperCase()}`)
    }
    if (errors.length !== errorsBefore) return

    const { taskId, checkId, approvedBy, approvedAt, approvalRef, reason, pilotPlanRef, expiresAt } =
      record as unknown as ApprovalRecord

    if (!TASK_ID.test(taskId)) errors.push(`${where}:BAD_TASK_ID`)
    else if (!ctx.taskIds.includes(taskId)) errors.push(`${where}:UNKNOWN_TASK_ID`)
    else if (!ctx.checkIdsFor(taskId).includes(checkId)) errors.push(`${where}:UNKNOWN_CHECK_ID`)
    // Only a check that states a live requirement may be approved. This is what stops a missing
    // contract test, a missing test file or an unrun suite from being signed away.
    else if (!ctx.liveCheckIdsFor(taskId).includes(checkId)) errors.push(`${where}:CHECK_HAS_NO_LIVE_REQUIREMENT`)

    if (!IDENTITY.test(approvedBy)) errors.push(`${where}:BAD_APPROVER`)
    else if (!ctx.allowedApprovers.includes(approvedBy)) errors.push(`${where}:APPROVER_NOT_ALLOWED`)

    if (!ISSUE_REF.test(approvalRef)) errors.push(`${where}:BAD_APPROVAL_REF`)

    if (reason.trim().length < MIN_REASON) errors.push(`${where}:REASON_TOO_SHORT`)

    const pilot = safeRelativePath(pilotPlanRef)
    if (!pilot) errors.push(`${where}:UNSAFE_PILOT_PLAN_REF`)
    else if (!existsSync(join(ctx.repoRoot, pilot))) errors.push(`${where}:PILOT_PLAN_NOT_FOUND`)

    if (!ISO_INSTANT.test(approvedAt)) errors.push(`${where}:BAD_APPROVED_AT`)
    if (!ISO_INSTANT.test(expiresAt)) errors.push(`${where}:BAD_EXPIRES_AT`)
    if (ISO_INSTANT.test(approvedAt) && ISO_INSTANT.test(expiresAt)) {
      const from = Date.parse(approvedAt)
      const until = Date.parse(expiresAt)
      if (!Number.isFinite(from) || !Number.isFinite(until)) errors.push(`${where}:UNPARSABLE_TIMESTAMP`)
      else if (until <= from) errors.push(`${where}:EXPIRES_BEFORE_APPROVED`)
      else if (until <= now.getTime()) errors.push(`${where}:APPROVAL_EXPIRED`)
    }

    const key = approvalKey(taskId, checkId)
    if (seen.has(key)) errors.push(`${where}:DUPLICATE_APPROVAL`)
    seen.add(key)

    if (errors.length === errorsBefore) {
      approvals.push({ taskId, checkId, approvedBy, approvedAt, approvalRef, reason, pilotPlanRef, expiresAt })
    }
  })

  return { approvals, errors }
}

/** Indexes validated approvals for lookup. Duplicates are already rejected by validateApprovals. */
export function indexApprovals(approvals: readonly ApprovalRecord[]): Map<string, ApprovalRecord> {
  return new Map(approvals.map((record) => [approvalKey(record.taskId, record.checkId), record]))
}
