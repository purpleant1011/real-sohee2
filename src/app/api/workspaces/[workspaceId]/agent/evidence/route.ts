import { NextRequest, NextResponse } from 'next/server'
import { verifyWorkspaceActor, handleWorkspaceActorError } from '@/lib/auth/workspace-actor-guard'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { isActivityId } from '@/features/agent-activity/activity-event'
import { projectMissionEvidence, type MissionArtifactReview } from '@/features/agent-activity/mission-evidence'
import { getApprovalPreview } from '@/features/approvals/approval-preview-repository'
import { extendFirstPostDraft, readDraftExtensionEvidence } from '@/features/missions/first-post-draft-extension'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }

export async function GET(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await params
    await verifyWorkspaceActor(request, workspaceId)
    const runId = request.nextUrl.searchParams.get('runId')
    const missionId = request.nextUrl.searchParams.get('missionId')
    const contentId = request.nextUrl.searchParams.get('contentId')
    const versionId = request.nextUrl.searchParams.get('versionId')
    const reviewsArtifact = contentId !== null || versionId !== null
    if (!isActivityId(workspaceId) || !isActivityId(runId) || !isActivityId(missionId)
      || (reviewsArtifact && (!isActivityId(contentId) || !isActivityId(versionId)))) {
      return NextResponse.json({ error: 'INVALID_EVIDENCE_SCOPE' }, { status: 400, headers })
    }
    // Member client preserves RLS. Never send raw ledger output or credential rows.
    const db = await createServerSupabaseClient()
    const run = await db.from('conversation_jobs').select('id,workspace_id,plan_data')
      .eq('workspace_id', workspaceId).eq('id', runId).maybeSingle()
    if (run.error) throw new Error('EVIDENCE_UNAVAILABLE')
    if (!run.data || (run.data.plan_data as Record<string, unknown> | null)?.missionId !== missionId) {
      return NextResponse.json({ error: 'EVIDENCE_NOT_FOUND' }, { status: 404, headers })
    }
    const mission = await db.from('marketing_missions').select('id,workspace_id,metadata,content_id,content_version_id')
      .eq('workspace_id', workspaceId).eq('id', missionId).maybeSingle()
    if (mission.error) throw new Error('EVIDENCE_UNAVAILABLE')
    if (!mission.data) return NextResponse.json({ error: 'EVIDENCE_NOT_FOUND' }, { status: 404, headers })
    let artifactReview: MissionArtifactReview | undefined
    if (reviewsArtifact) {
      if (mission.data.content_id !== contentId || mission.data.content_version_id !== versionId) {
        return NextResponse.json({ error: 'ARTIFACT_VERSION_CONFLICT' }, { status: 409, headers })
      }
      const result = await getApprovalPreview(workspaceId, contentId!)
      if (result.error) throw new Error('EVIDENCE_UNAVAILABLE')
      if (result.data.workspaceId !== workspaceId || result.data.contentId !== contentId || result.data.versionId !== versionId) {
        return NextResponse.json({ error: 'ARTIFACT_VERSION_CONFLICT' }, { status: 409, headers })
      }
      // A content preview is not a mission-bound cost/scope approval. Never infer a free quote.
      artifactReview = {
        preview: result.data,
        cost: { state: 'UNKNOWN' },
        approvalAllowed: false,
        blockers: [...result.data.issues.map(issue => issue.message), '게시 비용과 승인 범위를 아직 확인하지 못했습니다.'],
      }
    }
    const steps = await db.from('conversation_job_steps')
      .select('workspace_id,job_id,step_index,capability_id,status,completed_at,output_payload')
      .eq('workspace_id', workspaceId).eq('job_id', runId).eq('capability_id', 'reservation.list')
      .order('step_index', { ascending: false }).limit(20)
    if (steps.error || !Array.isArray(steps.data)) throw new Error('EVIDENCE_UNAVAILABLE')
    const source = await readDraftExtensionEvidence(db, workspaceId)
    const draft = (mission.data.metadata as Record<string, any> | null)?.draft
    const isFirstPost = draft?.missionId === missionId && draft?.workspaceId === workspaceId && draft?.copies
    const extended = source ? extendFirstPostDraft(isFirstPost ? draft : { channels: [{ provider: 'instagram' }, { provider: 'threads' }] }, source) : null
    // The quick-post free policy does not apply to arbitrary marketing missions.
    if (extended && !isFirstPost) delete extended.costQuote
    const evidence = projectMissionEvidence({ workspaceId, missionId, runId }, source?.datasetMode === 'ACTUAL' ? steps.data : [], extended)
    return NextResponse.json({ workspaceId, missionId, runId, evidence, ...(artifactReview ? { artifactReview } : {}) }, { headers })
  } catch (error) {
    const authError = handleWorkspaceActorError(error)
    if (authError) { authError.headers.set('Cache-Control', 'private, no-store'); return authError }
    return NextResponse.json({ error: 'EVIDENCE_UNAVAILABLE' }, { status: 503, headers })
  }
}
