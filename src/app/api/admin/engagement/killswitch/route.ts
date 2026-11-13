export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireOperatorAnyScope } from '@/features/operator-auth/require-operator'
import { handleAdminGuardError } from '@/features/operator-auth/admin-route-guard'
import {
  engagementKillSwitchRequestSchema,
} from '@/features/operator-engagement/schemas'
import {
  executeEngagementKillSwitch,
} from '@/features/operator-engagement/engagement-repository'

export async function POST(req: NextRequest) {
  try {
    const operator = await requireOperatorAnyScope('system.read')

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json(
        { error: 'INVALID_JSON', message: '올바른 JSON 요청 본문이 필요합니다.' },
        { status: 400 },
      )
    }

    const parsed = engagementKillSwitchRequestSchema.safeParse(body)
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]
      return NextResponse.json(
        {
          error: 'VALIDATION_FAILED',
          message: firstIssue?.message || '요청 입력값이 올바르지 않습니다.',
          details: parsed.error.flatten(),
        },
        { status: 400 },
      )
    }

    const result = await executeEngagementKillSwitch(parsed.data, operator.userId)

    return NextResponse.json(result, { status: 200 })
  } catch (err: unknown) {
    return handleAdminGuardError(err)
  }
}
