import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createLiveDemoService, isLiveDemoBusiness } from '@/features/channel-studio/dev/live-demo'
import { ChannelDraftError } from '@/features/channel-studio/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const generateSchema = z.strictObject({ topic: z.string().trim().min(1).max(300), requestKey: z.string().uuid(), includeImage: z.boolean().optional() })
const editSchema = z.strictObject({
  requestKey: z.string().uuid(),
  channel: z.enum(['instagram', 'threads', 'naver_blog', 'daangn_business']),
  edits: z.strictObject({
    title: z.string().max(200).optional(), text: z.string().max(20_000).optional(),
    caption: z.string().max(20_000).optional(), hashtags: z.array(z.string().max(50)).max(30).optional(),
  }).refine((value) => Object.keys(value).length > 0),
})

function demo(request: Request) {
  // 개발 환경에서만 열린다. 운영에서는 존재하지 않는 경로처럼 404.
  if (process.env.NODE_ENV === 'production') return null
  const business = new URL(request.url).searchParams.get('biz')
  return createLiveDemoService(isLiveDemoBusiness(business) ? business : 'cafe')
}

function failure(error: unknown) {
  if (error instanceof ChannelDraftError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  console.error('[dev/channel-studio] unexpected failure', error instanceof Error ? error.name : 'unknown')
  return NextResponse.json({ error: '글을 만드는 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.', code: 'MODEL_FAILED' }, { status: 503 })
}

export async function POST(request: Request) {
  const service = demo(request)
  if (!service) return new NextResponse(null, { status: 404 })
  const body = generateSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: '주제와 요청 정보를 확인해 주세요.', code: 'VALIDATION_FAILED' }, { status: 400 })
  try { return NextResponse.json({ draft: await service.generate(body.data.topic, body.data.requestKey) }, { headers: { 'Cache-Control': 'no-store' } }) } catch (error) { return failure(error) }
}

export async function PATCH(request: Request) {
  const service = demo(request)
  if (!service) return new NextResponse(null, { status: 404 })
  const body = editSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: '수정할 내용을 확인해 주세요.', code: 'VALIDATION_FAILED' }, { status: 400 })
  try { return NextResponse.json({ draft: await service.edit(body.data.requestKey, body.data.channel, body.data.edits) }, { headers: { 'Cache-Control': 'no-store' } }) } catch (error) { return failure(error) }
}
