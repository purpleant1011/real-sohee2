import { NextResponse, type NextRequest } from 'next/server'
import {
  decideWebhookHandling,
  mapWebhookToOrderEvent,
  verifyPortOneWebhook,
  type VerifyWebhookFn,
} from '@/lib/finops/portone-webhook-verifier'
import {
  recordWebhookEvent,
  applyOrderTransitionFromWebhook,
  type WebhookRepositoryDatabaseClient,
} from '@/features/billing/subscription-webhook-repository'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const seenWebhookIds = new Set<string>()

export function clearSeenWebhookIds(): void {
  seenWebhookIds.clear()
}

export interface PortOneWebhookOptions {
  seenIds?: Set<string>
  verify?: VerifyWebhookFn
  secret?: string
  dbClient?: WebhookRepositoryDatabaseClient
}

function resolveDbClient(options?: PortOneWebhookOptions): WebhookRepositoryDatabaseClient | null {
  if (options?.dbClient) return options.dbClient
  try {
    return createAdminSupabaseClient()
  } catch {
    return null
  }
}

export function GET(): NextResponse {
  return NextResponse.json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, { status: 405 })
}

export async function POST(
  req: NextRequest,
  options?: PortOneWebhookOptions
): Promise<NextResponse> {
  const secret = options?.secret ?? process.env.PORTONE_WEBHOOK_SECRET?.trim()
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'WEBHOOK_SECRET_NOT_CONFIGURED' },
      { status: 503 }
    )
  }

  const rawBody = await req.text()
  const headers: Record<string, string> = {}
  req.headers.forEach((value, key) => {
    headers[key] = value
  })

  const verification = await verifyPortOneWebhook({
    rawBody,
    headers,
    secret,
    verify: options?.verify,
  })

  if (!verification.ok) {
    return NextResponse.json(
      { ok: false, error: 'INVALID_WEBHOOK_SIGNATURE' },
      { status: 400 }
    )
  }

  const seenIds = options?.seenIds ?? seenWebhookIds
  const eventPayload = {
    ...(typeof verification.webhook === 'object' && verification.webhook !== null
      ? verification.webhook
      : {}),
    webhookId: verification.webhookId,
  }

  const decision = decideWebhookHandling(eventPayload, seenIds)

  if (decision.action === 'ignore_duplicate') {
    return NextResponse.json(
      { ok: true, status: 'ignored_duplicate', eventId: decision.eventId },
      { status: 200 }
    )
  }

  if (decision.action === 'reject') {
    return NextResponse.json(
      { ok: false, error: 'INVALID_WEBHOOK_EVENT' },
      { status: 400 }
    )
  }

  const dbClient = resolveDbClient(options)
  const webhookData = (verification.webhook as Record<string, any>)?.data
  const rawPaymentId = webhookData?.paymentId ?? null
  // orderId가 UUID 형식인 경우에만 DB order_id로 연계
  const orderId =
    typeof rawPaymentId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawPaymentId)
      ? rawPaymentId
      : null

  if (dbClient) {
    try {
      const recordResult = await recordWebhookEvent(dbClient, {
        providerEventId: decision.eventId,
        orderId,
      })
      if (recordResult.duplicate) {
        if (seenIds instanceof Set) {
          seenIds.add(decision.eventId)
        }
        return NextResponse.json(
          { ok: true, status: 'ignored_duplicate', eventId: decision.eventId },
          { status: 200 }
        )
      }
    } catch (recordError) {
      console.warn('Durable webhook recording warning (continuing with in-memory check):', recordError)
    }
  }

  if (seenIds instanceof Set) {
    seenIds.add(decision.eventId)
  }

  const orderEvent = mapWebhookToOrderEvent(verification.webhook)
  if (!orderEvent) {
    return NextResponse.json(
      { ok: true, status: 'ignored_unsupported', eventId: decision.eventId },
      { status: 200 }
    )
  }

  let transitionResult = null
  if (dbClient && orderId) {
    const transitionEvent =
      orderEvent.type === 'paid'
        ? 'paid'
        : orderEvent.type === 'cancelled' || orderEvent.type === 'partial_cancelled'
        ? 'cancelled'
        : orderEvent.type === 'failed'
        ? 'failed'
        : null

    if (transitionEvent) {
      try {
        transitionResult = await applyOrderTransitionFromWebhook(dbClient, {
          orderId,
          event: transitionEvent,
          providerEventId: decision.eventId,
        })
      } catch (transitionError) {
        console.warn('Order transition from webhook warning:', transitionError)
      }
    }
  }

  return NextResponse.json(
    {
      ok: true,
      status: 'processed',
      eventId: decision.eventId,
      orderEvent,
      ...(transitionResult ? { transition: transitionResult } : {}),
    },
    { status: 200 }
  )
}
