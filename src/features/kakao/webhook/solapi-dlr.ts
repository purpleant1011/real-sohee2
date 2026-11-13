import { createHash, timingSafeEqual } from 'node:crypto'
import {
  type LedgerPort,
  type LedgerStatus,
  canTransition,
} from '../notify/ledger-port'

export type SolapiDlrStatus = 'DELIVERED' | 'FAILED' | 'UNKNOWN'

export interface SolapiReport {
  messageId?: string
  statusCode?: string
  status: SolapiDlrStatus
  customFields?: Record<string, string>
}

export interface ApplySolapiReportsResult {
  total: number
  applied: number
  ignored: number
}

/**
 * Constant-time string equality check using SHA-256 to prevent timing attacks
 * and handle arbitrary length strings safely.
 */
function safeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const hashA = createHash('sha256').update(a, 'utf8').digest()
  const hashB = createHash('sha256').update(b, 'utf8').digest()
  return timingSafeEqual(hashA, hashB)
}

/**
 * Verifies Solapi Webhook signature / shared secret.
 *
 * Supported mechanisms:
 * 1. Official Solapi specification (https://developers.solapi.com/api/webhook):
 *    - Header `X-Solapi-Secret` carrying SHA1(secret) hex or plaintext secret.
 * 2. Authorization header:
 *    - `Authorization: Bearer <secret>` or `Authorization: <secret>`.
 * 3. URL query parameter:
 *    - `?secret=<secret>`.
 *
 * All comparisons are constant-time.
 * Fail-closed: returns false if expectedSecret is missing or empty.
 */
export function verifySolapiWebhookAuth(params: {
  headers: Headers
  searchParams?: URLSearchParams
  secret?: string | null
}): boolean {
  const secret = params.secret?.trim()
  if (!secret) {
    return false
  }

  const sha1Expected = createHash('sha1').update(secret, 'utf8').digest('hex')

  const candidateTokens: string[] = []

  // 1. X-Solapi-Secret header
  const solapiSecretHeader = params.headers.get('x-solapi-secret')?.trim()
  if (solapiSecretHeader) {
    candidateTokens.push(solapiSecretHeader)
  }

  // 2. Authorization header
  const authHeader = params.headers.get('authorization')?.trim()
  if (authHeader) {
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i)
    if (bearerMatch?.[1]) {
      candidateTokens.push(bearerMatch[1].trim())
    } else {
      candidateTokens.push(authHeader)
    }
  }

  // 3. Query parameter
  const querySecret = params.searchParams?.get('secret')?.trim()
  if (querySecret) {
    candidateTokens.push(querySecret)
  }

  if (candidateTokens.length === 0) {
    return false
  }

  for (const token of candidateTokens) {
    // Check against plaintext secret
    if (safeCompare(token, secret)) {
      return true
    }
    // Check against SHA1 hex hash (Solapi official webhook spec)
    if (safeCompare(token, sha1Expected)) {
      return true
    }
  }

  return false
}

/**
 * Parses raw webhook payload into standardized SolapiReport array.
 * Supports both single object and array of report items.
 * Ignores invalid or unrecognized objects.
 */
export function parseSolapiReport(payload: unknown): SolapiReport[] {
  if (!payload || typeof payload !== 'object') {
    return []
  }

  const rawItems = Array.isArray(payload) ? payload : [payload]
  const reports: SolapiReport[] = []

  for (const item of rawItems) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const raw = item as Record<string, unknown>
    const messageId = typeof raw.messageId === 'string' && raw.messageId.trim()
      ? raw.messageId.trim()
      : undefined

    const statusCode = raw.statusCode !== undefined && raw.statusCode !== null
      ? String(raw.statusCode).trim()
      : undefined

    let customFields: Record<string, string> | undefined
    if (raw.customFields && typeof raw.customFields === 'object' && !Array.isArray(raw.customFields)) {
      customFields = {}
      for (const [k, v] of Object.entries(raw.customFields)) {
        if (v !== undefined && v !== null) {
          customFields[k] = String(v)
        }
      }
    }

    // Determine status:
    // 1. Explicit status string if present
    const explicitStatus = typeof raw.status === 'string' ? raw.status.toUpperCase() : ''
    let status: SolapiDlrStatus = 'UNKNOWN'

    if (explicitStatus === 'COMPLETE' || explicitStatus === 'DELIVERED' || explicitStatus === 'SUCCESS') {
      status = 'DELIVERED'
    } else if (explicitStatus === 'FAILED' || explicitStatus === 'FAILURE' || explicitStatus === 'ERROR') {
      status = 'FAILED'
    } else if (statusCode) {
      if (statusCode === '4000') {
        status = 'DELIVERED'
      } else if (
        statusCode.startsWith('5') ||
        statusCode.startsWith('6') ||
        statusCode.startsWith('7') ||
        statusCode.toUpperCase() === 'FAILED'
      ) {
        status = 'FAILED'
      } else {
        status = 'UNKNOWN'
      }
    }

    // If item has neither messageId nor customFields nor valid statusCode, ignore it
    if (!messageId && !statusCode && !customFields && status === 'UNKNOWN') {
      continue
    }

    reports.push({
      messageId,
      statusCode,
      status,
      customFields,
    })
  }

  return reports
}

/**
 * Applies parsed Solapi reports to the ledger.
 *
 * Matching precedence:
 * 1. customFields.idempotencyKey -> ledger.get(key)
 * 2. report.messageId -> ledger.findByProviderMessageId(messageId)
 *
 * Duplicate transitions are safely ignored (idempotent).
 * UNKNOWN statuses and unmatched reports are ignored.
 */
export async function applySolapiReports(
  reports: SolapiReport[],
  ledger: LedgerPort,
  nowIso?: string,
): Promise<ApplySolapiReportsResult> {
  const now = nowIso ?? new Date().toISOString()
  let applied = 0
  let ignored = 0

  for (const report of reports) {
    let record = null

    // 1st priority: customFields.idempotencyKey
    const idempotencyKey = report.customFields?.idempotencyKey
    if (idempotencyKey) {
      record = await ledger.get(idempotencyKey)
    }

    // 2nd priority fallback: providerMessageId
    if (!record && report.messageId) {
      record = await ledger.findByProviderMessageId(report.messageId)
    }

    if (!record) {
      ignored++
      continue
    }

    if (report.status !== 'DELIVERED' && report.status !== 'FAILED') {
      ignored++
      continue
    }

    const targetStatus: LedgerStatus = report.status

    if (!canTransition(record.status, targetStatus)) {
      ignored++
      continue
    }

    const patch: { providerMessageId?: string; error?: string } = {}
    if (report.messageId) {
      patch.providerMessageId = report.messageId
    }
    if (targetStatus === 'FAILED') {
      patch.error = `Solapi status ${report.statusCode ?? 'FAILED'}`
    }

    const transitioned = await ledger.transition(
      record.idempotencyKey,
      targetStatus,
      patch,
      now,
    )

    if (transitioned) {
      applied++
    } else {
      ignored++
    }
  }

  return {
    total: reports.length,
    applied,
    ignored,
  }
}
