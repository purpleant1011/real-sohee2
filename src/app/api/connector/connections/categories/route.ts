import { NextResponse } from 'next/server'

import { authenticateConnectorRequest } from '@/features/local-publishing/device-auth'
import {
  categorySyncRequestSchema,
} from '@/features/naver-publish/category-sync-contract'
import { naverAutomationBlocked } from '@/features/naver-publish/automation-policy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const device = await authenticateConnectorRequest(request)
  if (!device) {
    return NextResponse.json({ code: 'DEVICE_AUTH_REQUIRED' }, { status: 401 })
  }

  const json = await request.json().catch(() => null)
  const body = categorySyncRequestSchema.safeParse(json)
  if (!body.success) {
    return NextResponse.json({ code: 'CATEGORY_SYNC_INVALID' }, { status: 400 })
  }

  // V1.2 G0-02: 네이버 외부 자동화 단일 정책 정본에 따라 네이버 카테고리 동기화(채우기) 즉시 차단
  return naverAutomationBlocked('fill')
}
