export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { recordFunnelEvent } from '@/features/quick-start/funnel-events'
import { SupabaseVaultSaveRepository } from '@/features/vault/model/supabase-save-repository'
import { VAULT_WRITE_FORBIDDEN_MESSAGE } from '@/features/vault/permissions'
import { saveToVault, VaultSaveError } from '@/features/vault/service/save'
import { recordVaultFunnelEvent, type VaultFunnelChannel } from '@/features/vault/funnel'

const schema = z.object({
  contentId: z.string().uuid(), versionId: z.string().uuid(),
  channels: z.array(z.enum(['instagram', 'threads', 'naver_blog', 'daangn_business'])).min(1).max(4).refine(channels => new Set(channels).size === channels.length),
  targetDate: z.iso.date().nullable().optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
}).strict()

export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  try {
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager', forbiddenMessage: VAULT_WRITE_FORBIDDEN_MESSAGE })
    if (isResponse(auth)) return auth
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: '보관할 내용, 채널과 예정일을 확인해 주세요.', external_posts: 0 }, { status: 422 })
    const result = await saveToVault({ ...parsed.data, targetDate: parsed.data.targetDate ?? null, workspaceId: auth.workspaceId, actorId: auth.userId, actorRole: auth.role }, {
      repository: new SupabaseVaultSaveRepository(auth.admin),
      recordEvent: async ({ event, properties, dedupeKey }) => {
        await recordFunnelEvent({ admin: auth.admin, workspaceId: auth.workspaceId, userId: auth.userId, event, properties, dedupeKey })
        if (event === 'vault.saved' && properties?.channel) {
          try {
            await recordVaultFunnelEvent(
              {
                workspaceId: auth.workspaceId,
                userId: auth.userId,
                event: 'vault_saved',
                channel: properties.channel as VaultFunnelChannel,
                properties: {
                  channel: properties.channel as VaultFunnelChannel,
                  contentId: parsed.data.contentId,
                  versionId: parsed.data.versionId,
                  idempotencyKey: parsed.data.idempotencyKey,
                },
                dedupeKey: `vault_saved:${properties.channel}:${parsed.data.idempotencyKey}`,
              },
              { admin: auth.admin },
            )
          } catch {
            // Best effort telemetry
          }
        }
      },
    })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof VaultSaveError || (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number')) {
      return NextResponse.json({ error: (error as Error).message, external_posts: 0 }, { status: (error as VaultSaveError).status })
    }
    console.error('[vault.save] unexpected error', error)
    return NextResponse.json({ error: '보관하지 못했어요. 잠시 후 다시 시도해 주세요.', external_posts: 0 }, { status: 500 })
  }
}
