import type { SolapiReport } from './solapi-dlr'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

/**
 * UUID v4 / RFC 4122 pattern for idempotencyKey parsing.
 */
const KAKAO_OUTBOX_KEY_REGEX =
  /^kakao-outbox:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

export type OutboxDeliveryStatus = 'DELIVERED' | 'FAILED'

export interface OutboxReport {
  jobId: string
  messageId?: string
  statusCode?: string
  status: OutboxDeliveryStatus
}

export interface OutboxRpcClient {
  rpc(
    fn: 'record_kakao_outbox_delivery',
    params: {
      p_job_id: string
      p_message_id: string | null
      p_status: string
      p_status_code: string | null
    },
  ): Promise<{ data: boolean | null; error: Error | { message: string } | null }>
}

export interface ApplyOutboxReportsResult {
  total: number
  applied: number
  ignored: number
}

/**
 * Parses outbox jobId from idempotencyKey.
 * Strict specification: customFields.idempotencyKey must follow 'kakao-outbox:<UUID>'.
 * Legacy keys, malformed UUIDs, or missing keys return null.
 */
export function parseOutboxJobId(idempotencyKey?: string | null): string | null {
  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    return null
  }
  const trimmed = idempotencyKey.trim()
  const match = trimmed.match(KAKAO_OUTBOX_KEY_REGEX)
  if (!match || !match[1]) {
    return null
  }
  return match[1].toLowerCase()
}

/**
 * Checks whether a Solapi report correlates to an outbox job.
 */
export function isOutboxReport(report: SolapiReport): boolean {
  return parseOutboxJobId(report.customFields?.idempotencyKey) !== null
}

/**
 * Injected RPC client holder for outbox DLR processing.
 * Keeps route files free of non-HTTP exports according to Next.js route rules.
 */
let activeOutboxClient: OutboxRpcClient | null = null

export function getOutboxRpcClient(): OutboxRpcClient | null {
  return activeOutboxClient
}

export function setOutboxRpcClient(client: OutboxRpcClient | null): void {
  activeOutboxClient = client
}

/**
 * Creates default admin Supabase client as OutboxRpcClient.
 * Returns null if Supabase environment variables or credentials are not configured.
 */
export function createDefaultOutboxRpcClient(): OutboxRpcClient | null {
  try {
    return createAdminSupabaseClient() as unknown as OutboxRpcClient
  } catch {
    return null
  }
}

/**
 * Applies Solapi reports to the outbox via RPC `record_kakao_outbox_delivery`.
 *
 * Rules:
 * - Unknown statuses and non-outbox reports are ignored.
 * - Idempotent transitions and conflicts return false from RPC and are marked as ignored.
 * - Database or client errors trigger a static throw so that the outer webhook route returns 500 for retry.
 */
export async function applyOutboxReports(
  reports: SolapiReport[],
  rpcClient: OutboxRpcClient,
): Promise<ApplyOutboxReportsResult> {
  let applied = 0
  let ignored = 0

  for (const report of reports) {
    const jobId = parseOutboxJobId(report.customFields?.idempotencyKey)
    if (!jobId) {
      ignored++
      continue
    }

    if (report.status !== 'DELIVERED' && report.status !== 'FAILED') {
      ignored++
      continue
    }

    const { data, error } = await rpcClient.rpc('record_kakao_outbox_delivery', {
      p_job_id: jobId,
      p_message_id: report.messageId ?? null,
      p_status: report.status,
      p_status_code: report.statusCode ?? null,
    })

    if (error) {
      throw new Error('Failed to record kakao outbox delivery')
    }

    if (data === true) {
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
