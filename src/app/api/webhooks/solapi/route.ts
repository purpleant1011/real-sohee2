import type { LedgerPort } from '@/features/kakao/notify/ledger-port'
import { NextResponse, type NextRequest } from 'next/server'
import { getLedger } from '@/features/kakao/webhook/solapi-ledger-holder'
import { SupabaseAlimtalkLedger } from '@/features/kakao/notify/supabase-ledger'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import {
  parseSolapiReport,
  applySolapiReports,
  verifySolapiWebhookAuth,
  type SolapiReport,
} from '@/features/kakao/webhook/solapi-dlr'
import {
  isOutboxReport,
  applyOutboxReports,
  getOutboxRpcClient,
  createDefaultOutboxRpcClient,
} from '@/features/kakao/webhook/outbox-dlr'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BODY_BYTES = 1024 * 1024 // 1MB

/** 주입된 원장이 없으면 운영 Supabase 원장을 쓴다. 환경이 없으면 null(수신만 확인). */
function createDefaultLedger(): LedgerPort | null {
  try {
    return new SupabaseAlimtalkLedger(createAdminSupabaseClient())
  } catch {
    return null
  }
}

/**
 * POST /api/webhooks/solapi
 * Receives Solapi Message Report (DLR) webhook.
 *
 * Security & Constraints:
 * - Fail-closed: 503 only if SOLAPI_WEBHOOK_SECRET is not configured.
 * - Authentication: 401 on missing or invalid secret/signature.
 * - Payload Limit: 413 if body exceeds 1MB.
 * - Non-retryable payloads: 200 { ok: true, ignored: n } for empty body, non-JSON,
 *   unrecognized/unmatched reports, UNKNOWN-only reports, or unrecorded jobs.
 * - Retryable DB failures: 500 only on temporary database errors or unavailable DB client.
 * - Privacy: No secrets, signatures, phone numbers, or raw internal errors are logged or returned.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.SOLAPI_WEBHOOK_SECRET?.trim()
  if (!secret) {
    return NextResponse.json(
      {
        ok: false,
        code: 'WEBHOOK_SECRET_NOT_CONFIGURED',
        message: 'Solapi webhook secret is not configured',
      },
      { status: 503 },
    )
  }

  // Check content-length header early
  const contentLength = req.headers.get('content-length')
  if (contentLength) {
    const bytes = parseInt(contentLength, 10)
    if (!Number.isNaN(bytes) && bytes > MAX_BODY_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Payload exceeds 1MB limit',
        },
        { status: 413 },
      )
    }
  }

  // Verify authentication before consuming or processing untrusted payload
  const isAuthorized = verifySolapiWebhookAuth({
    headers: req.headers,
    searchParams: req.nextUrl.searchParams,
    secret,
  })

  if (!isAuthorized) {
    return NextResponse.json(
      {
        ok: false,
        code: 'UNAUTHORIZED',
        message: 'Invalid webhook secret or signature',
      },
      { status: 401 },
    )
  }

  // Read body and verify byte length
  let rawText: string
  try {
    rawText = await req.text()
  } catch {
    return NextResponse.json(
      {
        ok: true,
        applied: 0,
        received: 0,
        ignored: 0,
      },
      { status: 200 },
    )
  }

  if (!rawText.trim()) {
    return NextResponse.json(
      {
        ok: true,
        applied: 0,
        received: 0,
        ignored: 0,
      },
      { status: 200 },
    )
  }

  const byteLength = new TextEncoder().encode(rawText).length
  if (byteLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Payload exceeds 1MB limit',
      },
      { status: 413 },
    )
  }

  let jsonBody: unknown
  try {
    jsonBody = JSON.parse(rawText)
  } catch {
    return NextResponse.json(
      {
        ok: true,
        applied: 0,
        received: 0,
        ignored: 0,
      },
      { status: 200 },
    )
  }

  const reports = parseSolapiReport(jsonBody)

  // 1. Separate legacy and outbox reports based on correlation key
  const outboxReports: SolapiReport[] = []
  const legacyReports: SolapiReport[] = []

  for (const report of reports) {
    if (isOutboxReport(report)) {
      outboxReports.push(report)
    } else {
      legacyReports.push(report)
    }
  }

  // 2. Process outbox reports
  let outboxApplied = 0
  let outboxIgnored = 0

  if (outboxReports.length > 0) {
    const actionableOutboxReports = outboxReports.filter(
      (r) => r.status === 'DELIVERED' || r.status === 'FAILED',
    )

    if (actionableOutboxReports.length === 0) {
      // UNKNOWN-only outbox reports do not require DB persistence; acknowledge without error
      outboxIgnored = outboxReports.length
    } else {
      const outboxClient = getOutboxRpcClient() ?? createDefaultOutboxRpcClient()
      if (!outboxClient) {
        return NextResponse.json(
          { ok: false, code: 'OUTBOX_ERROR', message: 'Failed to apply outbox reports' },
          { status: 500 },
        )
      }

      try {
        const outboxResult = await applyOutboxReports(outboxReports, outboxClient)
        outboxApplied = outboxResult.applied
        outboxIgnored = outboxResult.ignored
      } catch {
        return NextResponse.json(
          { ok: false, code: 'OUTBOX_ERROR', message: 'Failed to apply outbox reports' },
          { status: 500 },
        )
      }
    }
  }

  // 3. Check legacy ledger if only legacy reports exist
  const ledger = getLedger() ?? createDefaultLedger()
  if (legacyReports.length > 0 && outboxReports.length === 0 && !ledger) {
    return NextResponse.json(
      {
        ok: true,
        applied: 0,
        received: reports.length,
        ignored: legacyReports.length,
        message: 'Ledger not configured; webhook acknowledged without persistence',
      },
      { status: 200 },
    )
  }

  // 4. Process legacy reports
  let legacyApplied = 0
  let legacyIgnored = 0
  if (legacyReports.length > 0) {
    if (!ledger) {
      legacyIgnored += legacyReports.length
    } else {
      try {
        const legacyResult = await applySolapiReports(legacyReports, ledger)
        legacyApplied = legacyResult.applied
        legacyIgnored = legacyResult.ignored
      } catch {
        return NextResponse.json(
          { ok: false, code: 'LEDGER_ERROR', message: 'Failed to apply reports' },
          { status: 500 },
        )
      }
    }
  }

  return NextResponse.json(
    {
      ok: true,
      applied: outboxApplied + legacyApplied,
      received: reports.length,
      ignored: outboxIgnored + legacyIgnored,
    },
    { status: 200 },
  )
}
