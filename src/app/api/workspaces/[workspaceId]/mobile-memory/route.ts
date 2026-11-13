export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { decideMemoryProposal } from '@/features/mobile-settings/server/memory-decision'
import {
  buildMemorySnapshot,
  type MemoryFactRow,
  type MemoryProposalRow,
  type SourceResult,
} from '@/features/mobile-settings/server/memory-snapshot'

const NO_STORE = { 'Cache-Control': 'no-store' }

const failed = <T,>(): SourceResult<T> => ({ ok: false, value: null })

/**
 * 확인 대기 제안. `sohee_studio_proposals` 는 service_role 만 select 할 수 있어
 * (마이그레이션 20261016090509: authenticated 권한 회수) RLS 대신 인증이 확정한 workspace_id 로만 좁혀 읽는다.
 * goal 제안은 기억이 아니라 목표이므로 이 화면에서 다루지 않는다.
 */
async function readProposals(auth: { admin: any; workspaceId: string }): Promise<SourceResult<MemoryProposalRow[]>> {
  try {
    const { data, error } = await auth.admin
      .from('sohee_studio_proposals')
      .select('id, category, content, source_message_id, created_at')
      .eq('workspace_id', auth.workspaceId)
      .eq('kind', 'fact')
      .eq('status', 'proposed')
      .order('created_at', { ascending: false })
      .limit(50)
    if (error || !Array.isArray(data)) return failed()
    return {
      ok: true,
      value: data.map((row: any) => ({
        id: row.id,
        category: row.category,
        content: row.content,
        createdAt: row.created_at,
        sourceMessageId: row.source_message_id ?? null,
      })),
    }
  } catch {
    return failed()
  }
}

/** 현재 확정 지식. 사용자 세션 RLS(멤버 읽기)로만 조회한다. */
async function readFacts(auth: { supabase: any; workspaceId: string }): Promise<SourceResult<MemoryFactRow[]>> {
  try {
    const { data, error } = await auth.supabase
      .from('knowledge_facts')
      .select('id, category, content, approved_at')
      .eq('workspace_id', auth.workspaceId)
      .eq('status', 'active')
      .order('valid_from', { ascending: false })
      .limit(200)
    if (error || !Array.isArray(data)) return failed()
    return {
      ok: true,
      value: data.map((row: any) => ({
        id: row.id,
        category: row.category,
        content: row.content,
        approvedAt: row.approved_at ?? null,
      })),
    }
  } catch {
    return failed()
  }
}

/**
 * 가게 기억 승인 목록(읽기, ANI-1709).
 * workspace 는 요청 경로가 아니라 인증이 확정한 값만 쓰고, 응답은 no-store 이다.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
  if (isResponse(auth)) return auth

  const now = new Date().toISOString()
  const [proposals, facts] = await Promise.all([readProposals(auth), readFacts(auth)])
  const snapshot = buildMemorySnapshot({ workspaceId: auth.workspaceId, now, proposals, facts })

  // 조회 실패도 200 으로 빈 목록을 주지 않는다: 둘 다 실패면 503 + error.
  return NextResponse.json(snapshot, {
    status: snapshot.loadState === 'error' ? 503 : 200,
    headers: NO_STORE,
  })
}

/**
 * 사장님이 화면에서 직접 누른 1회 확인만 받는다. `confirm: true` 가 없으면 쓰지 않는다
 * (자동 승인 금지). 같은 결정 재시도·동시 결정은 RPC 가 원자적으로 판정하고,
 * 이 라우트는 결과를 decided / already_handled / not_found / unavailable 로만 알린다.
 */
const decisionRequestSchema = z.object({
  proposalId: z.string().uuid(),
  decision: z.enum(['confirm', 'reject']),
  confirm: z.literal(true),
}).strict()

export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
  if (isResponse(auth)) return auth

  const raw = await request.json().catch(() => null)
  const parsed = decisionRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: '결정 내용을 다시 확인해 주세요.' }, { status: 400, headers: NO_STORE })
  }

  const result = await decideMemoryProposal({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    proposalId: parsed.data.proposalId,
    decision: parsed.data.decision,
    admin: auth.admin,
  })

  if (result.outcome === 'decided' || result.outcome === 'already_handled') {
    return NextResponse.json(result, { headers: NO_STORE })
  }
  if (result.outcome === 'invalid_proposal') {
    return NextResponse.json(
      { ...result, error: '확인할 내용이 없어 승인하지 않았어요. 화면을 새로 고쳐 확인해 주세요.' },
      { status: 422, headers: NO_STORE },
    )
  }
  if (result.outcome === 'not_found') {
    return NextResponse.json(
      { ...result, error: '이미 처리됐거나 찾을 수 없는 항목이에요.' },
      { status: 404, headers: NO_STORE },
    )
  }
  return NextResponse.json(
    { ...result, error: '저장하지 못했어요. 잠시 후 다시 시도해 주세요.' },
    { status: 503, headers: NO_STORE },
  )
}
