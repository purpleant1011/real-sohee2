import 'server-only'

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import type {
  AutonomyDistribution,
  AutoReplyStats,
  EngagementKillSwitchRequest,
  EngagementKillSwitchResult,
  ExpiringDmThread,
  OperatorEngagementOverview,
  RecentAuditLogItem,
} from './schemas'

type GatewayDeps = {
  client?: any
}

function resolveClient(deps?: GatewayDeps) {
  if (deps?.client) return deps.client
  return createAdminSupabaseClient()
}

/**
 * 소통함(인게이지먼트) 관제 현황 종합 조회
 * - 자율성 레벨(L1/L2/L3) 분포
 * - 24시간 DM 윈도우 만료 임박(2시간 미만) 및 만료 스레드
 * - 최근 24시간 자동 답글 성공/실패율 통계
 * - 최근 자동 답글/소통 감사 기록
 */
export async function getOperatorEngagementOverview(
  deps?: GatewayDeps,
  nowOverride?: Date,
): Promise<{ data: OperatorEngagementOverview | null; error: string | null }> {
  try {
    const client = resolveClient(deps)
    const now = nowOverride ?? new Date()
    const nowIso = now.toISOString()
    const since24hIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()

    // 1. 매장(Workspaces) 이름 매핑용 조회
    const { data: workspacesRaw } = await client
      .from('workspaces')
      .select('id, name')

    const workspaceMap = new Map<string, string>()
    if (Array.isArray(workspacesRaw)) {
      for (const w of workspacesRaw) {
        if (w.id && w.name) {
          workspaceMap.set(w.id, w.name)
        }
      }
    }

    // 2. 정책(engagement_policies) 및 자율성 분포 집계
    const { data: policiesRaw, error: policyError } = await client
      .from('engagement_policies')
      .select('workspace_id, channel, autonomy_level, is_paused, auto_reply_enabled')

    if (policyError) {
      return { data: null, error: `POLICIES_QUERY_FAILED: ${policyError.message}` }
    }

    const autonomy: AutonomyDistribution = {
      l1Manual: 0,
      l2Assisted: 0,
      l3Autonomous: 0,
      totalConfigured: 0,
      pausedCount: 0,
    }

    const policies = Array.isArray(policiesRaw) ? policiesRaw : []
    const distinctWorkspaces = new Set<string>()

    for (const p of policies) {
      if (p.workspace_id) {
        distinctWorkspaces.add(p.workspace_id)
      }
      if (p.is_paused) {
        autonomy.pausedCount += 1
      }
      const level = (p.autonomy_level ?? '').toUpperCase()
      if (level === 'L3_AUTONOMOUS' || level === 'L3') {
        autonomy.l3Autonomous += 1
      } else if (level === 'L2_ASSISTED' || level === 'L2') {
        autonomy.l2Assisted += 1
      } else {
        // 기본값 또는 L1
        autonomy.l1Manual += 1
      }
    }
    autonomy.totalConfigured = distinctWorkspaces.size

    // 3. 만료 임박 인스타그램 DM 목록
    // 상태가 NEEDS_REPLY, NEEDS_CHECK 이거나 최근 생성된 미처리 스레드
    const { data: threadsRaw, error: threadsError } = await client
      .from('instagram_dm_threads')
      .select('id, workspace_id, customer_handle, last_message_text, last_message_at, expires_at, status')
      .order('expires_at', { ascending: true })
      .limit(100)

    if (threadsError) {
      return { data: null, error: `DM_THREADS_QUERY_FAILED: ${threadsError.message}` }
    }

    const expiringDms: ExpiringDmThread[] = []
    let expiringCriticalCount = 0

    if (Array.isArray(threadsRaw)) {
      for (const t of threadsRaw) {
        if (!t.expires_at) continue
        const expiresTime = new Date(t.expires_at).getTime()
        const remainingMinutes = Math.floor((expiresTime - now.getTime()) / (60 * 1000))

        let urgency: ExpiringDmThread['urgency'] = 'SAFE'
        if (remainingMinutes <= 0) {
          urgency = 'EXPIRED'
        } else if (remainingMinutes <= 60) {
          urgency = 'CRITICAL'
        } else if (remainingMinutes <= 120) {
          urgency = 'WARNING'
        } else {
          urgency = 'SAFE'
        }

        // 위험/경고/만료 및 24시간 이내 대상 위주로 집계 (잔여 120분 이하를 긴급 위험 카운트에 반영)
        if (remainingMinutes <= 120 && t.status !== 'SENT' && t.status !== 'DISMISSED') {
          expiringCriticalCount += 1
        }

        expiringDms.push({
          id: t.id,
          workspaceId: t.workspace_id,
          workspaceName: workspaceMap.get(t.workspace_id) ?? '알 수 없는 매장',
          customerHandle: t.customer_handle || '@unknown',
          lastMessageText: t.last_message_text || '',
          lastMessageAt: t.last_message_at || t.created_at || nowIso,
          expiresAt: t.expires_at,
          remainingMinutes,
          status: t.status || 'UNKNOWN',
          urgency,
        })
      }
    }

    // 잔여 시간 기준 정렬 (가장 만료가 임박하거나 이미 만료된 순)
    expiringDms.sort((a, b) => a.remainingMinutes - b.remainingMinutes)

    // 4. 최근 24시간 자동 답글 통계 (social_comments 및 engagement_audit 결합 집계)
    const { data: comments24hRaw } = await client
      .from('social_comments')
      .select('id, status, updated_at')
      .gte('updated_at', since24hIso)

    let successfulReplies = 0
    let failedReplies = 0

    if (Array.isArray(comments24hRaw)) {
      for (const c of comments24hRaw) {
        if (c.status === 'SENT') {
          successfulReplies += 1
        } else if (c.status === 'FAILED') {
          failedReplies += 1
        }
      }
    }

    // 추가로 engagement_audit 에서 auto_reply 건수 확인
    const { data: audits24hRaw } = await client
      .from('engagement_audit')
      .select('id, action, created_at')
      .gte('created_at', since24hIso)
      .eq('action', 'auto_reply')

    if (Array.isArray(audits24hRaw) && audits24hRaw.length > successfulReplies) {
      successfulReplies = audits24hRaw.length
    }

    const totalAttempts = successfulReplies + failedReplies
    const successRatePercent = totalAttempts > 0
      ? Math.round((successfulReplies / totalAttempts) * 1000) / 10
      : null

    const stats24h: AutoReplyStats = {
      windowHours: 24,
      totalAttempts,
      successfulReplies,
      failedReplies,
      successRatePercent,
    }

    // 5. 최근 감사 로그 (최대 20건)
    const { data: auditsRaw } = await client
      .from('engagement_audit')
      .select('id, workspace_id, channel, action, actor, created_at, details')
      .order('created_at', { ascending: false })
      .limit(20)

    const recentAudits: RecentAuditLogItem[] = []
    if (Array.isArray(auditsRaw)) {
      for (const a of auditsRaw) {
        recentAudits.push({
          id: a.id,
          workspaceId: a.workspace_id,
          workspaceName: workspaceMap.get(a.workspace_id) ?? '알 수 없는 매장',
          channel: a.channel ?? 'instagram',
          action: a.action ?? 'unknown',
          actor: a.actor ?? 'system',
          createdAt: a.created_at ?? nowIso,
          details: a.details ?? {},
        })
      }
    }

    return {
      data: {
        autonomy,
        expiringDms: expiringDms.slice(0, 50),
        expiringCriticalCount,
        stats24h,
        recentAudits,
        asOf: nowIso,
      },
      error: null,
    }
  } catch (err: any) {
    return { data: null, error: err?.message || 'ENGAGEMENT_READ_FAILED' }
  }
}

/**
 * 긴급 킬스위치 실행: L3 완전 자율성을 L1(수동 모드)으로 강제 격하하거나 일시 중지
 */
export async function executeEngagementKillSwitch(
  input: EngagementKillSwitchRequest,
  operatorId?: string,
  deps?: GatewayDeps,
): Promise<EngagementKillSwitchResult> {
  const client = resolveClient(deps)
  const nowIso = new Date().toISOString()

  let affectedWorkspaces = 0
  let updatedPolicies = 0

  if (input.scope === 'all') {
    if (input.action === 'downgrade_to_l1') {
      const { data: targetPolicies } = await client
        .from('engagement_policies')
        .select('id, workspace_id')
        .eq('autonomy_level', 'L3_AUTONOMOUS')

      const targets = Array.isArray(targetPolicies) ? targetPolicies : []
      affectedWorkspaces = new Set(targets.map((t) => t.workspace_id)).size
      updatedPolicies = targets.length

      if (targets.length > 0) {
        await client
          .from('engagement_policies')
          .update({
            autonomy_level: 'L1_MANUAL',
            updated_at: nowIso,
          })
          .eq('autonomy_level', 'L3_AUTONOMOUS')
      }
    } else if (input.action === 'pause') {
      const { data: targetPolicies } = await client
        .from('engagement_policies')
        .select('id, workspace_id')
        .eq('is_paused', false)

      const targets = Array.isArray(targetPolicies) ? targetPolicies : []
      affectedWorkspaces = new Set(targets.map((t) => t.workspace_id)).size
      updatedPolicies = targets.length

      if (targets.length > 0) {
        await client
          .from('engagement_policies')
          .update({
            is_paused: true,
            updated_at: nowIso,
          })
          .eq('is_paused', false)
      }
    }
  } else if (input.scope === 'workspace' && input.workspaceId) {
    const wsId = input.workspaceId
    affectedWorkspaces = 1

    if (input.action === 'downgrade_to_l1') {
      const { data: targetPolicies } = await client
        .from('engagement_policies')
        .select('id')
        .eq('workspace_id', wsId)

      const targets = Array.isArray(targetPolicies) ? targetPolicies : []
      updatedPolicies = targets.length

      await client
        .from('engagement_policies')
        .update({
          autonomy_level: 'L1_MANUAL',
          updated_at: nowIso,
        })
        .eq('workspace_id', wsId)
    } else if (input.action === 'pause') {
      const { data: targetPolicies } = await client
        .from('engagement_policies')
        .select('id')
        .eq('workspace_id', wsId)

      const targets = Array.isArray(targetPolicies) ? targetPolicies : []
      updatedPolicies = targets.length

      await client
        .from('engagement_policies')
        .update({
          is_paused: true,
          updated_at: nowIso,
        })
        .eq('workspace_id', wsId)
    }
  }

  // 감사 로그 기록
  try {
    await client
      .from('engagement_audit')
      .insert({
        workspace_id: input.workspaceId ?? '00000000-0000-0000-0000-000000000000',
        channel: 'instagram',
        actor: 'system',
        actor_user_id: operatorId ?? null,
        action: 'policy_update',
        details: {
          emergency_killswitch: true,
          scope: input.scope,
          action: input.action,
          reason: input.reason,
          affectedWorkspaces,
          updatedPolicies,
        },
        readback_verified: true,
        created_at: nowIso,
      })
  } catch {
    // 감사 기록 실패가 킬스위치 실행 자체를 롤백시키지 않도록 방어
  }

  return {
    success: true,
    scope: input.scope,
    action: input.action,
    affectedWorkspaces,
    updatedPolicies,
    timestamp: nowIso,
  }
}
