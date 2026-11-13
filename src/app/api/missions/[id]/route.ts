export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { readPreferredWorkspaceIdFromCookies } from '@/features/auth/active-workspace.server'
import { resolveCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { buildCanonicalMissionDTO } from '@/lib/mission-os/mission-read-model'
import { validateMissionContract } from '@/lib/mission-os/mission-contract'
import { computeContractApprovalHash } from '@/lib/mission-os/mission-plan-diff'

interface RouteParams {
  params: Promise<{ id: string }>
}

async function resolveConversationHref(
  client: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  workspaceId: string,
  sourceJobId: unknown,
): Promise<string | null> {
  const jobId = z.string().uuid().safeParse(sourceJobId)
  if (!jobId.success) return null
  try {
    const job = await client.from('conversation_jobs').select('id, workspace_id, thread_id')
      .eq('workspace_id', workspaceId).eq('id', jobId.data).maybeSingle()
    if (job.error || !job.data || job.data.workspace_id !== workspaceId || job.data.id !== jobId.data) return null
    const threadId = z.string().uuid().safeParse(job.data.thread_id)
    if (!threadId.success) return null
    const thread = await client.from('conversation_threads').select('id, workspace_id, status')
      .eq('workspace_id', workspaceId).eq('id', threadId.data).maybeSingle()
    if (thread.error || !thread.data || thread.data.workspace_id !== workspaceId || thread.data.id !== threadId.data || thread.data.status !== 'active') return null
    return `/app/conversations/${threadId.data}`
  } catch {
    return null
  }
}

/**
 * GET /api/missions/[id]
 * Canonical Mission Projection API (Hardened Minimal Projection)
 *
 * Guarantees:
 * 1. Active workspace context via readPreferredWorkspaceIdFromCookies & resolveCurrentWorkspaceContext (401/403/404/500 separation)
 * 2. Strict tenant isolation: eq('id', id).eq('workspace_id', workspace.workspaceId)
 * 3. Minimal allowlist output: only returns canonicalDto. Raw DB metadata, internal
 *    snapshot views (adminView/agentView), and stack traces are strictly not exposed.
 * 4. Cache-Control: no-store
 */
export async function GET(_req: Request, { params }: RouteParams) {
  try {
    const { id } = await params
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: '올바른 업무 식별자가 필요합니다.' }, { status: 400 })
    }

    const preferredId = await readPreferredWorkspaceIdFromCookies()
    const resolution = await resolveCurrentWorkspaceContext(preferredId)

    if (resolution.status === 'expired') {
      return NextResponse.json({ error: '인증 세션이 필요합니다.' }, { status: 401 })
    }
    if (resolution.status === 'forbidden') {
      return NextResponse.json({ error: '해당 워크스페이스에 대한 접근 권한이 없습니다.' }, { status: 403 })
    }
    if (resolution.status === 'missing') {
      return NextResponse.json({ error: '워크스페이스를 찾을 수 없습니다.' }, { status: 404 })
    }
    if (resolution.status === 'error') {
      return NextResponse.json({ error: '워크스페이스 확인 중 일시적인 오류가 발생했습니다.' }, { status: 500 })
    }

    const workspace = resolution.context

    const supabase = await createServerSupabaseClient()
    const { data: mission, error } = await (supabase as any)
      .from('marketing_missions')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', workspace.workspaceId)
      .maybeSingle()

    if (error) {
      console.error('[GET /api/missions/[id] db error]:', error)
      return NextResponse.json(
        { error: '업무 상세를 조회하는 중 데이터베이스 오류가 발생했습니다.' },
        { status: 500 }
      )
    }

    if (!mission) {
      return NextResponse.json({
        success: false,
        error: '해당 마케팅 업무를 찾을 수 없습니다.',
        code: 'MISSION_NOT_FOUND',
      }, { status: 404 })
    }

    const canonicalDto = buildCanonicalMissionDTO(mission)
    const snapshotVersion = Number(mission.metadata?.snapshot_version ?? 1)
    const conversationHref = await resolveConversationHref(supabase, workspace.workspaceId, mission.source_conversation_job_id)

    let contractApproval = null
    if (canonicalDto.executionState === 'NEEDS_DECISION' && ['owner', 'manager'].includes(workspace.role)) {
      try {
        const contract = validateMissionContract(mission.metadata?.contract)
        const channelNames: Record<string, string> = { instagram: '인스타그램', threads: '스레드' }
        contractApproval = {
          // Request binding only; never rendered as a fingerprint or content approval ID.
          payload_hash: computeContractApprovalHash(contract),
          review_lines: [
            `목표: ${contract.goal}`,
            `대상 채널: ${contract.service_scope.map((channel) => channelNames[channel] || '기타 채널').join(' · ')}`,
            `예산 상한: ${contract.budget_caps.max_cost_minor_units.toLocaleString('ko-KR')} ${contract.budget_caps.currency === 'CREDIT' ? '크레딧' : contract.budget_caps.currency}`,
            `성과 목표: ${contract.success_criterion.target_value.toLocaleString('ko-KR')}${contract.success_criterion.unit || '건'}`,
            `계약 만료: ${new Date(contract.expires_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`,
          ],
        }
      } catch {
        // Malformed contracts are still readable, but cannot offer an approval request token.
      }
    }

    // Security: Only return allowlisted review fields, never raw metadata or admin snapshots
    return NextResponse.json({
      success: true,
      canonicalDto,
      snapshot_version: snapshotVersion,
      contract_approval: contractApproval,
      conversation_href: conversationHref,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    })
  } catch (err: unknown) {
    console.error('[GET /api/missions/[id] unexpected error]:', err)
    return NextResponse.json(
      { error: '업무 상세를 조회하는 중 일시적인 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
