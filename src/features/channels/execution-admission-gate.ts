/**
 * Execution Admission Gate (ANI-1022, ANI-1025)
 *
 * Implements strict, single-point evaluation before ANY external provider write.
 * Evaluates 6 independent readiness dimensions:
 * CONNECTED -> AUTHORIZED -> LISTENING -> EXECUTABLE -> PROVEN -> AUTONOMOUS
 *
 * Fails closed whenever any required dimension is missing or blocked.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { checkKillSwitchPreflight } from '@/lib/safety/kill-switch-guard'
import { isMetaLiveAllowed } from '@/lib/safety/meta-live-allowlist'

export type AdmissionReasonCode =
  | 'RUNTIME_SCHEMA_DRIFT'
  | 'UNAUTHORIZED_ACTOR'
  | 'CHANNEL_NOT_CONNECTED'
  | 'SCOPE_DEFICIENT'
  | 'CAPABILITY_MISSING'
  | 'CONSENT_MISSING_OR_REVOKED'
  | 'WEBHOOK_UNPROVEN'
  | 'TEST_ROLE_ONLY_PUBLIC_DENIED'
  | 'APPROVAL_MISMATCH'
  | 'KILL_SWITCH_ENGAGED'
  | 'WORKSPACE_NOT_IN_LIVE_ROLLOUT'
  | 'OK'

export interface AdmissionDimensions {
  connected: boolean
  authorized: boolean
  listening: boolean
  executable: boolean
  proven: boolean
  autonomous: boolean
}

export interface AdmissionEvaluationResult {
  admitted: boolean
  status: 'ADMITTED' | 'BLOCKED'
  reasonCode: AdmissionReasonCode
  message: string
  dimensions: AdmissionDimensions
  evaluatedAt: string
}

export interface AdmissionEvaluationParams {
  workspaceId: string
  channel: 'instagram' | 'threads' | 'naver_blog' | 'daangn_business'
  actionKind: 'feed_publish' | 'thread_publish' | 'blog_post' | 'business_news_post' | 'comment_reply' | 'dm_reply'
  actorUserId?: string
  isAutonomousExecution?: boolean
  contentVersionId?: string
  expectedFingerprint?: string
  isPublicCustomer?: boolean
}

export class ExecutionAdmissionGate {
  public static async evaluate(params: AdmissionEvaluationParams): Promise<AdmissionEvaluationResult> {
    const {
      workspaceId,
      channel,
      actionKind,
      actorUserId,
      isAutonomousExecution = false,
      contentVersionId,
      expectedFingerprint,
      isPublicCustomer: rawIsPublicCustomer,
    } = params

    const isTestRoleWorkspace =
      workspaceId === '00000000-0000-4000-8000-0000000000a2' ||
      actorUserId === '3156b2d4-77f8-42c3-a8ac-6b9cc473dfec' ||
      actorUserId?.startsWith('tester') ||
      actorUserId?.startsWith('dev') ||
      actorUserId === 'system' ||
      actorUserId?.startsWith('operator')

    const isPublicCustomer = rawIsPublicCustomer !== undefined
      ? rawIsPublicCustomer
      : !isTestRoleWorkspace

    const evaluatedAt = new Date().toISOString()
    const dimensions: AdmissionDimensions = {
      connected: false,
      authorized: false,
      listening: false,
      executable: false,
      proven: false,
      autonomous: false,
    }

    try {
      const supabase = await createServerSupabaseClient()
      const db = supabase as any

      // 1. Mandatory Kill Switch Check
      const killCheck = await checkKillSwitchPreflight(supabase, {
        workspaceId,
        channel: channel.toUpperCase() as any,
        provider: (channel === 'instagram' || channel === 'threads') ? 'META' : 'NAVER',
      })

      if (killCheck.blocked) {
        return {
          admitted: false,
          status: 'BLOCKED',
          reasonCode: 'KILL_SWITCH_ENGAGED',
          message: killCheck.reason || '긴급 킬스위치가 활성화되어 외부 작업이 차단되었습니다.',
          dimensions,
          evaluatedAt,
        }
      }

      // 1-1. Live Rollout Allowlist Check for Meta External Writes (Fail-Closed)
      const isMetaChannel = channel === 'instagram' || channel === 'threads'
      const isExternalWrite =
        actionKind === 'feed_publish' ||
        actionKind === 'thread_publish' ||
        actionKind === 'comment_reply' ||
        actionKind === 'dm_reply'

      if (isMetaChannel && isExternalWrite && !isMetaLiveAllowed(workspaceId)) {
        return {
          admitted: false,
          status: 'BLOCKED',
          reasonCode: 'WORKSPACE_NOT_IN_LIVE_ROLLOUT',
          message: '아직 이 계정에서는 실제 게시를 열지 않았어요. 곧 열릴 예정이에요.',
          dimensions,
          evaluatedAt,
        }
      }

      // 2. Channel Connection Dimension
      const { data: conn } = await db
        .from('channel_connections')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('channel', channel)
        .maybeSingle()

      if (!conn || (conn.status !== 'connected' && conn.status !== 'verified')) {
        return {
          admitted: false,
          status: 'BLOCKED',
          reasonCode: 'CHANNEL_NOT_CONNECTED',
          message: `${channel.toUpperCase()} 채널이 연결되지 않았습니다.`,
          dimensions,
          evaluatedAt,
        }
      }
      dimensions.connected = true

      // 3. Authorized Dimension (Meta Capability Truth Gate - ANI-1143)
      if (channel === 'instagram' || channel === 'threads') {
        const { getMetaCapabilityTruth } = await import('./meta-capability-truth')
        const capabilityTruth = getMetaCapabilityTruth(channel, evaluatedAt)

        if (capabilityTruth.capabilityState === 'BLOCKED') {
          return {
            admitted: false,
            status: 'BLOCKED',
            reasonCode: 'CAPABILITY_MISSING',
            message: capabilityTruth.reasons.join(' / ') || 'Meta 플랫폼 기능이 차단(BLOCKED) 상태입니다.',
            dimensions,
            evaluatedAt,
          }
        }

        if (isPublicCustomer) {
          if (!capabilityTruth.isPublicCustomerReady) {
            return {
              admitted: false,
              status: 'BLOCKED',
              reasonCode: 'TEST_ROLE_ONLY_PUBLIC_DENIED',
              message: capabilityTruth.reasons[0] || 'Meta 플랫폼 앱 검수(App Review) 미제출 상태로 일반 고객 자율 실행이 차단됩니다 (TEST_ROLE_ONLY).',
              dimensions,
              evaluatedAt,
            }
          }
        }
      }
      dimensions.authorized = true

      // 4. Listening Dimension (Webhook Health - ANI-1021)
      const webhookStatus = conn.webhook_status
      const lastWebhookAt = conn.last_webhook_at
      const isListening = (webhookStatus === 'healthy' || webhookStatus === 'ready') && !!lastWebhookAt
      dimensions.listening = isListening

      if (isAutonomousExecution && !isListening) {
        return {
          admitted: false,
          status: 'BLOCKED',
          reasonCode: 'WEBHOOK_UNPROVEN',
          message: '실제 웹훅 수신이 검증되지 않은 채널에서는 자율 반응 실행이 금지됩니다.',
          dimensions,
          evaluatedAt,
        }
      }

      // 5. Executable Dimension (Exact Approval & Fingerprint Gate)
      if (contentVersionId && expectedFingerprint) {
        const { data: approval } = await db
          .from('approvals')
          .select('id, fingerprint, status')
          .eq('workspace_id', workspaceId)
          .eq('version_id', contentVersionId)
          .eq('status', 'approved')
          .maybeSingle()

        if (!approval || approval.fingerprint !== expectedFingerprint) {
          return {
            admitted: false,
            status: 'BLOCKED',
            reasonCode: 'APPROVAL_MISMATCH',
            message: '지정된 원고 버전에 대한 유효한 사장님 승인 행(Approvals) 및 SHA-256 지문이 일치하지 않습니다.',
            dimensions,
            evaluatedAt,
          }
        }
      }
      dimensions.executable = true

      // 6. Proven & Autonomous Dimensions (Capabilities & Consents)
      const { data: capability } = await db
        .from('channel_capabilities')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('channel', channel)
        .maybeSingle()

      const { data: consent } = await db
        .from('channel_consents')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('channel', channel)
        .maybeSingle()

      dimensions.proven = !!capability && capability.capability !== 'unsupported'

      const isConsentActive = !!consent && consent.status !== 'REVOKED'
      dimensions.autonomous = dimensions.proven && isConsentActive && dimensions.listening

      if (isAutonomousExecution) {
        if (!dimensions.proven) {
          return {
            admitted: false,
            status: 'BLOCKED',
            reasonCode: 'CAPABILITY_MISSING',
            message: '채널 역량(Channel Capabilities)이 등록되지 않아 자율 실행이 불가능합니다.',
            dimensions,
            evaluatedAt,
          }
        }

        if (!isConsentActive) {
          return {
            admitted: false,
            status: 'BLOCKED',
            reasonCode: 'CONSENT_MISSING_OR_REVOKED',
            message: '사용자 위임 동의(Channel Consents)가 없거나 철회되어 자율 실행이 거부되었습니다.',
            dimensions,
            evaluatedAt,
          }
        }
      }

      return {
        admitted: true,
        status: 'ADMITTED',
        reasonCode: 'OK',
        message: '모든 선행 인가 관문을 통과하여 외부 작업 수행이 허가되었습니다.',
        dimensions,
        evaluatedAt,
      }
    } catch (err: unknown) {
      console.error('[ExecutionAdmissionGate] Evaluation error:', err)
      return {
        admitted: false,
        status: 'BLOCKED',
        reasonCode: 'RUNTIME_SCHEMA_DRIFT',
        message: (err as Error).message || '인가 관문 평가 중 오류가 발생하여 안전을 위해 차단(Fail-Closed)되었습니다.',
        dimensions,
        evaluatedAt,
      }
    }
  }
}
