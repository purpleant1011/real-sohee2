import { NextResponse } from 'next/server'
import { z } from 'zod'
import { naverAutomationBlocked } from '@/features/naver-publish/automation-policy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const inputSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
  displayName: z.string().trim().min(1).max(120),
  platform: z.enum(['windows', 'macos']),
  clientVersion: z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/).max(40),
}).strict()

export async function POST(request: Request) {
  let input: unknown
  try { input = await request.json() } catch { return NextResponse.json({ code: 'PAIRING_INPUT_INVALID' }, { status: 400 }) }
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return NextResponse.json({ code: 'PAIRING_INPUT_INVALID' }, { status: 400 })

  // V1.2 G0-02: 네이버 외부 자동화 단일 정책 정본에 따라 네이버 연결기 페어링(로그인) 즉시 차단
  return naverAutomationBlocked('login')
}
