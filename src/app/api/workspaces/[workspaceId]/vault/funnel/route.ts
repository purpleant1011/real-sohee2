export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import {
  queryVaultFunnel,
  recordVaultFunnelEvent,
  VAULT_FUNNEL_CHANNELS,
  type VaultFunnelChannel,
} from '@/features/vault/funnel'

const clientPostSchema = z.object({
  event: z.literal('preview_opened', {
    message: '보관함 퍼널은 미리보기 열림 이벤트만 직접 기록할 수 있어요.',
  }),
  channel: z.enum(VAULT_FUNNEL_CHANNELS, {
    message: '올바른 채널을 선택해 주세요.',
  }),
  contentId: z.string().uuid({ message: '콘텐츠 식별자를 확인해 주세요.' }),
  versionId: z.string().uuid({ message: '버전 식별자를 확인해 주세요.' }),
}).strict()

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params
  try {
    const auth = await authorizeQuickRequest(workspaceId)
    if (isResponse(auth)) return auth

    const rawBody = await request.json().catch(() => null)
    const parsed = clientPostSchema.safeParse(rawBody)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message || '요청 정보를 확인해 주세요.'
      return NextResponse.json({ error: issue }, { status: 422 })
    }

    const { event, channel, contentId, versionId } = parsed.data
    // 서버가 workspace+event+channel+content+version으로 결정한다. 클라이언트 키는 받지 않는다(무제한 삽입 방지).
    const dedupeKey = `${event}:${auth.workspaceId}:${channel}:${contentId}:${versionId}`

    const result = await recordVaultFunnelEvent(
      {
        workspaceId: auth.workspaceId,
        userId: auth.userId,
        event,
        channel,
        properties: {
          contentId,
          versionId,
        },
        dedupeKey,
      },
      { admin: auth.admin },
    )

    return NextResponse.json(
      { ok: true, dedupeKey: result.dedupeKey },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('[vault.funnel.post] unexpected error:', error)
    return NextResponse.json(
      { error: '퍼널 이벤트를 기록하지 못했어요. 잠시 후 다시 시도해 주세요.' },
      { status: 500 },
    )
  }
}

const getQuerySchema = z.object({
  from: z.string().refine((val) => Number.isFinite(Date.parse(val)), {
    message: '조회 시작 일시를 올바르게 입력해 주세요.',
  }),
  to: z.string().refine((val) => Number.isFinite(Date.parse(val)), {
    message: '조회 종료 일시를 올바르게 입력해 주세요.',
  }),
  channel: z
    .enum([...VAULT_FUNNEL_CHANNELS, 'ALL'])
    .optional()
    .default('ALL'),
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params
  try {
    const auth = await authorizeQuickRequest(workspaceId)
    if (isResponse(auth)) return auth

    const url = new URL(request.url)
    const rawQuery = {
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
      channel: url.searchParams.get('channel') || 'ALL',
    }

    const parsed = getQuerySchema.safeParse(rawQuery)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message || '조회 기간을 확인해 주세요.'
      return NextResponse.json({ error: issue }, { status: 422 })
    }

    const { from, to, channel } = parsed.data
    const readModel = await queryVaultFunnel(
      { admin: auth.admin },
      {
        workspaceId: auth.workspaceId,
        period: { from, to },
        channel: channel as VaultFunnelChannel | 'ALL',
      },
    )

    return NextResponse.json(readModel, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    console.error('[vault.funnel.get] unexpected error:', error)
    return NextResponse.json(
      { error: '퍼널 통계를 조회하지 못했어요. 잠시 후 다시 시도해 주세요.' },
      { status: 500 },
    )
  }
}
