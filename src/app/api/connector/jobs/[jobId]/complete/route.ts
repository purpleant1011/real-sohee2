import { NextResponse } from 'next/server'
import { z } from 'zod'

import { authenticateConnectorRequest } from '@/features/local-publishing/device-auth'
import { naverAutomationBlocked } from '@/features/naver-publish/automation-policy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: Readonly<{ params: Promise<{ jobId: string }> }>) {
  const device = await authenticateConnectorRequest(request)
  if (!device) return NextResponse.json({ code: 'DEVICE_AUTH_REQUIRED' }, { status: 401 })
  const { jobId } = await context.params
  if (!z.string().uuid().safeParse(jobId).success) return NextResponse.json({ code: 'COMPLETION_INVALID' }, { status: 400 })
  try { await request.json() } catch { return NextResponse.json({ code: 'COMPLETION_INVALID' }, { status: 400 }) }

  // V1.2 G0-02: 네이버 외부 자동화 단일 정책 정본에 따라 complete 즉시 차단
  return naverAutomationBlocked('publish')
}
