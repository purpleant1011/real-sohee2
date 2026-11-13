import { NextResponse } from 'next/server'

import { authenticateConnectorRequest } from '@/features/local-publishing/device-auth'
import { connectorClaimBodySchema } from '@/features/local-publishing/execution-scope'
import { naverAutomationBlocked } from '@/features/naver-publish/automation-policy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const device = await authenticateConnectorRequest(request)
  if (!device) return NextResponse.json({ code: 'DEVICE_AUTH_REQUIRED' }, { status: 401 })
  const body = request.body === null ? {} : await request.json().catch(() => null)
  const parsed = connectorClaimBodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ code: 'SCOPE_REQUEST_INVALID' }, { status: 400, headers: { 'cache-control': 'no-store' } })

  // V1.2 G0-02: 네이버 외부 자동화 단일 정책 정본에 따라 claim 즉시 차단
  return naverAutomationBlocked('publish')
}
