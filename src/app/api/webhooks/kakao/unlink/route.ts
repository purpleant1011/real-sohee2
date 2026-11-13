import { NextResponse, type NextRequest } from 'next/server'
import {
  handleKakaoUnlinkWebhook,
  InMemoryIdempotencyStore,
  type KakaoUnlinkHandler,
} from '@/features/kakao/webhook'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Module-level idempotency store for the route
const routeIdempotencyStore = new InMemoryIdempotencyStore()

// Injectable handler for unlink events (default: no-op)
let activeUnlinkHandler: KakaoUnlinkHandler | null = null

/**
 * Injects a custom onUnlinked handler (e.g. for testing or domain service wiring).
 */
export function setKakaoUnlinkHandlerForTesting(handler: KakaoUnlinkHandler | null): void {
  activeUnlinkHandler = handler
}

/**
 * Resets route handler state and clears idempotency cache (for testing isolation).
 */
export function resetKakaoWebhookForTesting(): void {
  activeUnlinkHandler = null
  routeIdempotencyStore.clear()
}

/**
 * POST /api/webhooks/kakao/unlink
 * Receives Kakao User Unlink webhook requests.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.KAKAO_WEBHOOK_SECRET
  const authHeader = req.headers.get('authorization')

  let rawBody: unknown
  const contentType = req.headers.get('content-type') || ''

  try {
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await req.formData()
      const params = new URLSearchParams()
      formData.forEach((value, key) => {
        if (typeof value === 'string') {
          params.set(key, value)
        }
      })
      rawBody = params
    } else {
      rawBody = await req.json()
    }
  } catch {
    return NextResponse.json(
      {
        ok: false,
        code: 'INVALID_PAYLOAD',
        message: 'Could not parse request body as JSON or Form data',
      },
      { status: 400 },
    )
  }

  const result = await handleKakaoUnlinkWebhook({
    authHeader,
    secret,
    rawBody,
    onUnlinked: activeUnlinkHandler ?? undefined,
    idempotencyStore: routeIdempotencyStore,
  })

  return NextResponse.json(result.body, { status: result.status })
}

/**
 * GET /api/webhooks/kakao/unlink
 * Kakao console also supports GET method delivering unlink event via query parameters.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.KAKAO_WEBHOOK_SECRET
  const authHeader = req.headers.get('authorization')

  const searchParams = req.nextUrl.searchParams

  const result = await handleKakaoUnlinkWebhook({
    authHeader,
    secret,
    rawBody: searchParams,
    onUnlinked: activeUnlinkHandler ?? undefined,
    idempotencyStore: routeIdempotencyStore,
  })

  return NextResponse.json(result.body, { status: result.status })
}
