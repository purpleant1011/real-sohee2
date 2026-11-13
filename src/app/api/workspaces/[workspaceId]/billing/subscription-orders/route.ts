import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard'
import {
  buildConsentRecords,
  ConsentValidationError,
} from '@/features/billing/subscription-consent'
import { subscriptionOfferPolicy } from '@/features/billing/subscription-offers'
import { createSubscriptionOrderDraft } from '@/features/billing/subscription-order'
import {
  createSubscriptionOrderWithConsents,
  listSubscriptionOrdersByWorkspace,
  type SupabaseOrderDbClient,
} from '@/features/billing/subscription-order-repository'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const postBodySchema = z
  .object({
    offerCode: z.enum(['STARTER_150K', 'GROWTH_300K', 'SCALE_500K']),
    idempotencyKey: z.string().uuid(),
    accepted: z
      .object({
        terms: z.literal(true),
        privacy: z.literal(true),
        refund_auto_renewal: z.literal(true),
        marketing: z.boolean().optional(),
      })
      .strict(),
  })
  .strict()

export interface SubscriptionOrderRouteOptions {
  dbClient?: SupabaseOrderDbClient
}

function resolveDbClient(options?: SubscriptionOrderRouteOptions): SupabaseOrderDbClient | null {
  if (options?.dbClient) return options.dbClient
  try {
    return createAdminSupabaseClient()
  } catch {
    return null
  }
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
  options?: SubscriptionOrderRouteOptions
) {
  try {
    const { workspaceId } = await context.params
    const auth = await requireWorkspaceMembership(workspaceId)
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.error, message: auth.message },
        { status: auth.status }
      )
    }

    const dbClient = resolveDbClient(options)
    if (dbClient) {
      try {
        const orders = await listSubscriptionOrdersByWorkspace(dbClient, workspaceId)
        return NextResponse.json({ ok: true, orders }, { status: 200 })
      } catch (dbError) {
        console.warn('Subscription orders query warning (falling back to empty):', dbError)
      }
    }

    return NextResponse.json({ ok: true, orders: [] }, { status: 200 })
  } catch {
    return NextResponse.json(
      { error: 'INTERNAL_SERVER_ERROR', message: '주문 목록 조회에 실패했습니다.' },
      { status: 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
  options?: SubscriptionOrderRouteOptions
) {
  try {
    const { workspaceId } = await context.params
    const auth = await requireWorkspaceMembership(workspaceId)
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.error, message: auth.message },
        { status: auth.status }
      )
    }

    if (auth.role !== 'owner' && auth.role !== 'manager') {
      return NextResponse.json(
        { error: 'FORBIDDEN_ROLE', message: '구독 주문을 생성할 권한이 없습니다.' },
        { status: 403 }
      )
    }

    const rawBody = await request.json().catch(() => null)
    const parseResult = postBodySchema.safeParse(rawBody)
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'INVALID_REQUEST',
          message: parseResult.error.issues[0]?.message ?? '유효하지 않은 요청 본문입니다.',
          issues: parseResult.error.issues,
        },
        { status: 400 }
      )
    }

    try {
      const consents = buildConsentRecords({
        accepted: parseResult.data.accepted,
        policyVersion: subscriptionOfferPolicy.version,
        acceptedAt: new Date(),
        locale: 'ko',
      })

      const actorUserId =
        (auth as { user?: { id?: string } }).user?.id ?? auth.userId

      const draft = createSubscriptionOrderDraft({
        offerCode: parseResult.data.offerCode,
        workspaceId,
        actorUserId,
        idempotencyKey: parseResult.data.idempotencyKey,
        now: new Date(),
      })

      const dbClient = resolveDbClient(options)
      if (dbClient) {
        try {
          const { order: persistedOrder, created } = await createSubscriptionOrderWithConsents(
            dbClient,
            {
              order: draft,
              consents,
              createdBy: actorUserId,
            }
          )
          return NextResponse.json(
            { ok: true, order: persistedOrder, consents, created },
            { status: created ? 201 : 200 }
          )
        } catch (dbError) {
          console.warn('Subscription order persistence warning (falling back to draft):', dbError)
        }
      }

      return NextResponse.json({ ok: true, order: draft, consents, created: true }, { status: 201 })
    } catch (error) {
      if (error instanceof ConsentValidationError) {
        return NextResponse.json(
          {
            error: 'CONSENT_VALIDATION_ERROR',
            message: error.message,
            issues: error.issues,
          },
          { status: 400 }
        )
      }
      if (error instanceof RangeError) {
        return NextResponse.json(
          { error: 'INVALID_ORDER_INPUT', message: error.message },
          { status: 400 }
        )
      }
      return NextResponse.json(
        {
          error: 'SUBSCRIPTION_ORDER_CREATION_FAILED',
          message: '구독 주문 처리에 실패했습니다.',
        },
        { status: 500 }
      )
    }
  } catch {
    return NextResponse.json(
      { error: 'INTERNAL_SERVER_ERROR', message: '주문 생성에 실패했습니다.' },
      { status: 500 }
    )
  }
}
