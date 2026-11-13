import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateConnectorRequest } from '@/features/local-publishing/device-auth'
import { checkpointRecoveryRequestSchema } from '@/features/local-publishing/execution-scope'
import { naverAutomationBlocked } from '@/features/naver-publish/automation-policy'

export const dynamic = 'force-dynamic'
const headers = { 'cache-control': 'no-store' }
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const device = await authenticateConnectorRequest(request)
  if (!device) return NextResponse.json({ code: 'DEVICE_AUTH_REQUIRED' }, { status: 401, headers })
  const { jobId } = await params
  const body = checkpointRecoveryRequestSchema.safeParse(await request.json().catch(() => null))
  if (!z.string().uuid().safeParse(jobId).success || !body.success) return NextResponse.json({ code: 'SCOPE_RECOVERY_INVALID' }, { status: 400, headers })
  // V1.2 G0-02: 네이버 외부 자동화 단일 정책 정본에 따라 checkpoint 복구 즉시 차단
  return naverAutomationBlocked('publish')
}
