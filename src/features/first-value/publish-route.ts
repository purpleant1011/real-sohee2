import { NextResponse } from 'next/server'
import { z } from 'zod'
import { calculateApprovalFingerprint } from '@/lib/evidence/approval-fingerprint'
import { firstValuePublishOutcome } from '@/features/publishing/first-value-outcome'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { readQuickPostApprovalReadiness } from '@/features/quick-start/quick-post-approval-readiness'
import { evaluateApprovalActions } from '@/features/vault/approval-policy'
import { evaluateChannelSpec } from '@/features/vault/channel-spec'
import { POST as approveMission } from '@/app/api/missions/first-post/approve/route'
import { POST as publishMission } from '@/app/api/missions/first-post/publish/route'
import { POST as retryMission } from '@/app/api/missions/first-post/publish/retry/route'
import { isMetaLiveAllowed } from '@/lib/safety/meta-live-allowlist'
import {
  CONNECTION_IDENTITY_MISSING,
  CONNECTION_IDENTITY_MISSING_MESSAGE,
} from '@/features/channels/constants'
import {
  revalidateApprovedFactSnapshot,
  getDefaultFactSnapshotResolver,
  createWorkspaceFactReader,
} from '@/features/publishing/fact-snapshot-gate'

const bodySchema = z.object({
  missionId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  fingerprint: z.string().min(1).max(128),
  reviewedImageIds: z.array(z.string().min(1).max(2048)).max(100),
  retryChannel: z.enum(['instagram', 'threads']).optional(),
}).strict()
const APPROVAL_PHRASE = '이 버전 승인하고 발행'

/** Publication is opt-in, rechecked against server truth, and delegates to the existing approval/receipt pipeline. */
export async function handleFirstValuePublish(request: Request): Promise<NextResponse> {
  const auth = await authorizeQuickRequest(request.headers.get('x-workspace-id'), { requireRole: 'manager' })
  if (isResponse(auth)) return auth
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: '게시물을 확인해 주세요.', code: 'INVALID_PAYLOAD' }, { status: 422 })
  try {
    const { data: mission, error } = await auth.admin.from('marketing_missions').select('id,status,metadata')
      .eq('workspace_id', auth.workspaceId).eq('id', parsed.data.missionId).maybeSingle()
    if (error) {
      console.error('[first-value] mission lookup query error', { error, workspaceId: auth.workspaceId, missionId: parsed.data.missionId })
      throw error
    }
    if (!mission || mission.metadata?.lane !== 'QUICK_POST' || !['AWAITING_APPROVAL', 'APPROVED', 'EXECUTING', 'FAILED'].includes(mission.status)) {
      console.error('[first-value] publish rejected: draft mission not found or invalid status', {
        missionId: parsed.data.missionId,
        status: mission?.status,
        lane: mission?.metadata?.lane,
        workspaceId: auth.workspaceId,
      })
      return NextResponse.json({ error: '승인할 초안을 찾지 못했어요.', code: 'DRAFT_NOT_FOUND' }, { status: 404 })
    }

    // Bind the decision to what this client actually reviewed, never to an unseen latest draft.
    const currentFingerprint = calculateApprovalFingerprint(mission.metadata.payload)
    if (parsed.data.revision !== (mission.metadata.quick?.revision ?? 1) ||
        parsed.data.fingerprint !== currentFingerprint ||
        mission.metadata.draftFingerprint !== currentFingerprint ||
        parsed.data.reviewedImageIds.length !== mission.metadata.payload.imageIds.length ||
        parsed.data.reviewedImageIds.some((imageId, index) => imageId !== mission.metadata.payload.imageIds[index])) {
      return NextResponse.json({
        error: '글이 변경되었어요. 최신 내용을 확인한 뒤 다시 승인해 주세요.',
        code: 'STALE_DRAFT',
      }, { status: 409 })
    }

    if (!isMetaLiveAllowed(auth.workspaceId)) {
      return NextResponse.json({
        error: '아직 이 계정에서는 실제 게시를 열지 않았어요. 곧 열릴 예정이에요.',
        code: 'WORKSPACE_NOT_IN_LIVE_ROLLOUT',
      }, { status: 403 })
    }

    // P0: Precheck fact snapshot freshness before readiness reading or probe
    // Locked to auth.workspaceId and reusable across stages (outcomes are never memoized)
    const factReader = createWorkspaceFactReader(
      auth.workspaceId,
      async (columns) => {
        const { data, error } = await auth.admin
          .from('knowledge_facts')
          .select(columns)
          .eq('workspace_id', auth.workspaceId)
        return { data, error }
      },
      auth.admin
    )

    const initialFactGate = await revalidateApprovedFactSnapshot({
      admin: factReader,
      workspaceId: auth.workspaceId,
      previousSnapshot: mission.metadata?.factSnapshot,
      resolver: getDefaultFactSnapshotResolver(),
      learningDependencies: mission.metadata?.learningDependencies,
      learningEpoch: mission.metadata?.learningEpoch,
    })
    if (!initialFactGate.ok) {
      return NextResponse.json({
        error: initialFactGate.error,
        code: initialFactGate.code,
        reason: initialFactGate.reason,
      }, { status: initialFactGate.status })
    }

    const headers = { 'content-type': 'application/json', 'x-workspace-id': auth.workspaceId }

    let readiness = await readQuickPostApprovalReadiness(auth.admin, auth.workspaceId)
    const channelItems = mission.metadata.payload?.channels ?? []
    const targetChannels = channelItems.map((c: any) => c.provider as 'instagram' | 'threads')

    if (targetChannels.length === 0) {
      console.error('[first-value] publish rejected: missing target channel', { channels: channelItems, workspaceId: auth.workspaceId })
      return NextResponse.json({ error: '게시물을 올릴 채널을 확인해 주세요.', code: 'CHANNEL_NOT_CONNECTED' }, { status: 422 })
    }

    // Auto-probe fallback: 최근 channel_verification_runs 영수증이 없거나 만료된 경우, 발행 직전 1회 온디맨드 검증 후 재평가
    for (const target of targetChannels) {
      if (!readiness.verifiedChannels.includes(target)) {
        try {
          const { loadChannelCredentialByChannel } = await import('@/features/channels/credential-repository')
          const cred = await loadChannelCredentialByChannel(auth.workspaceId, target)
          if (cred?.accessToken && cred?.externalAccountId) {
            const { verifyPostOAuthChannelCapability } = await import('@/features/channels/dual-channel-verification')
            console.info(`[first-value] attempting on-demand capability verification before publication for ${target}`, { workspaceId: auth.workspaceId })
            await verifyPostOAuthChannelCapability({
              workspaceId: auth.workspaceId,
              channel: target,
              accessToken: cred.accessToken,
              providerAccountId: cred.externalAccountId,
              adminClient: auth.admin,
            })
          }
        } catch (probeErr) {
          console.warn(`[first-value] on-demand capability probe failed for ${target}:`, probeErr)
        }
      }
    }
    readiness = await readQuickPostApprovalReadiness(auth.admin, auth.workspaceId)

    const verifiedTargets = targetChannels.filter((target: 'instagram' | 'threads') =>
      (readiness.verifiedChannels as readonly string[]).includes(target)
    )
    if (verifiedTargets.length === 0) {
      console.error('[first-value] publish rejected: no channel verified', {
        targetChannels,
        verifiedChannels: readiness.verifiedChannels,
        stage: readiness.stage,
        workspaceId: auth.workspaceId,
      })

      const { data: connections } = await auth.admin
        .from('channel_connections')
        .select('channel,status,external_account_id')
        .eq('workspace_id', auth.workspaceId)

      const identityMissing = (connections ?? []).find(
        (c: any) =>
          targetChannels.includes(c.channel) &&
          ['connected', 'verified'].includes(c.status?.toLowerCase()) &&
          !c.external_account_id
      )

      if (identityMissing) {
        return NextResponse.json({
          error: CONNECTION_IDENTITY_MISSING_MESSAGE,
          code: CONNECTION_IDENTITY_MISSING,
          channel: identityMissing.channel,
        }, { status: 403 })
      }

      return NextResponse.json({
        error: '채널 연결 상태를 확인하지 못했어요. 채널을 다시 확인해 주세요.',
        code: 'CHANNEL_NOT_VERIFIED',
      }, { status: 403 })
    }

    const review = process.env.META_APP_REVIEW_STATUS?.toUpperCase() === 'APPROVED' ? 'APPROVED' : 'UNKNOWN'
    if (review !== 'APPROVED') {
      console.error('[first-value] publish rejected: META_APP_REVIEW_STATUS is not APPROVED', {
        reviewStatus: process.env.META_APP_REVIEW_STATUS,
        workspaceId: auth.workspaceId,
      })
      return NextResponse.json({
        error: '게시 기능을 준비하고 있어요. 글은 보관함에 안전하게 담아 둘게요.',
        code: 'PUBLISH_NOT_ENABLED',
      }, { status: 403 })
    }

    const copies = mission.metadata.payload?.copies
    const imageIds: string[] = mission.metadata.payload?.imageIds ?? []

    const allowedTargets: Array<'instagram' | 'threads'> = []
    let lastPolicyMessage: string | null = null

    for (const target of verifiedTargets) {
      const media = imageIds.map(() => ({ type: 'image' as const, format: 'jpeg' }))
      const spec = target === 'instagram'
        ? evaluateChannelSpec('instagram', {
            caption: copies?.instagram?.caption ?? '',
            hashtags: copies?.instagram?.hashtags ?? [],
            media,
          })
        : evaluateChannelSpec('threads', { text: copies?.threads?.content ?? '', media: [] })

      const policy = evaluateApprovalActions({
        channel: target,
        readiness: readiness.stage,
        connection: 'VERIFIED',
        providerReviewStatus: review,
        specResult: spec,
        targetTime: null,
      })

      const hasContent = target === 'instagram'
        ? Boolean(copies?.instagram?.caption?.trim()) && imageIds.length > 0
        : Boolean(copies?.threads?.content?.trim())

      if (policy.PUBLISH.allowed && hasContent) {
        allowedTargets.push(target)
      } else {
        lastPolicyMessage = policy.PUBLISH.message || '채널과 글을 확인해 주세요.'
      }
    }

    if (allowedTargets.length === 0) {
      console.error('[first-value] publish rejected by policy', {
        verifiedTargets,
        message: lastPolicyMessage,
        workspaceId: auth.workspaceId,
      })
      return NextResponse.json({
        error: lastPolicyMessage ?? '채널과 글을 확인해 주세요.',
        code: 'PUBLISH_POLICY_REJECTED',
      }, { status: 403 })
    }

    // Do not authorize one channel and silently execute the full persisted target set.
    if (allowedTargets.length !== targetChannels.length) {
      return NextResponse.json({
        error: '이 초안에 포함된 채널 중 게시할 수 없는 채널이 있어요. 채널을 다시 확인하거나 글을 보관해 주세요.',
        code: 'TARGET_CHANNEL_NOT_ELIGIBLE',
      }, { status: 403 })
    }

    // A retry is a new external action: recheck current permissions before delegating.
    if (parsed.data.retryChannel) {
      // P0: Re-validate approved fact snapshot freshness immediately before retryMission delegation
      const retryFactGate = await revalidateApprovedFactSnapshot({
        admin: factReader,
        workspaceId: auth.workspaceId,
        previousSnapshot: mission.metadata?.factSnapshot,
        resolver: getDefaultFactSnapshotResolver(),
        learningDependencies: mission.metadata?.learningDependencies,
        learningEpoch: mission.metadata?.learningEpoch,
      })
      if (!retryFactGate.ok) {
        return NextResponse.json({
          error: retryFactGate.error,
          code: retryFactGate.code,
          reason: retryFactGate.reason,
        }, { status: retryFactGate.status })
      }

      const retried = await retryMission(new Request(new URL('/api/missions/first-post/publish/retry', request.url), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          missionId: mission.id,
          targetChannel: parsed.data.retryChannel,
        }),
      }))
      if (!retried.ok) {
        const errData = await retried.json().catch(() => ({}))
        return NextResponse.json({
          error: errData.error ?? '다시 시도하지 못했어요. 채널 연결 상태를 확인해 주세요.',
          code: errData.code ?? 'RETRY_FAILED',
        }, { status: retried.status })
      }
      const retryResult = await retried.json()
      const execResult = retryResult.executionResult
      const channels = (mission.metadata.payload?.channels ?? []).map((c: any) => c.provider as 'instagram' | 'threads')
      return NextResponse.json({
        ...firstValuePublishOutcome(channels, execResult),
        channel: parsed.data.retryChannel,
        executionResult: execResult,
      }, { headers: { 'Cache-Control': 'no-store' } })
    }

    if (mission.status !== 'APPROVED') {
      const approved = await approveMission(new Request(new URL('/api/missions/first-post/approve', request.url), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          missionId: mission.id,
          fingerprint: parsed.data.fingerprint,
          isExplicitlyApproved: true,
          explicitPhrase: APPROVAL_PHRASE,
        }),
      }))
      if (!approved.ok) {
        const errData = await approved.json().catch(() => ({}))
        console.error('[first-value] approveMission call failed', {
          status: approved.status,
          code: errData.code,
          error: errData.error,
          workspaceId: auth.workspaceId,
          missionId: mission.id,
        })
        if (['FINGERPRINT_MISMATCH_REJECTED', 'CONCURRENT_APPROVAL_CONFLICT'].includes(errData.code)) {
          return NextResponse.json({
            error: '글이 변경되었어요. 최신 내용을 확인한 뒤 다시 승인해 주세요.',
            code: 'STALE_DRAFT',
          }, { status: 409 })
        }
        return NextResponse.json({
          error: errData.error ?? '승인 상태를 확인하지 못했어요. 다시 확인해 주세요.',
          code: errData.code ?? 'APPROVAL_FAILED',
        }, { status: approved.status })
      }
    }

    // P0: Final fact snapshot verification before publish delegation (mandatory even if already APPROVED)
    const publishFactGate = await revalidateApprovedFactSnapshot({
      admin: factReader,
      workspaceId: auth.workspaceId,
      previousSnapshot: mission.metadata?.factSnapshot,
      resolver: getDefaultFactSnapshotResolver(),
      learningDependencies: mission.metadata?.learningDependencies,
      learningEpoch: mission.metadata?.learningEpoch,
    })
    if (!publishFactGate.ok) {
      return NextResponse.json({
        error: publishFactGate.error,
        code: publishFactGate.code,
        reason: publishFactGate.reason,
      }, { status: publishFactGate.status })
    }

    const published = await publishMission(new Request(new URL('/api/missions/first-post/publish', request.url), {
      method: 'POST',
      headers,
      body: JSON.stringify({ missionId: mission.id }),
    }))
    if (!published.ok) {
      const errData = await published.json().catch(() => ({}))
      console.error('[first-value] publishMission call failed', {
        status: published.status,
        code: errData.code,
        error: errData.error,
        workspaceId: auth.workspaceId,
        missionId: mission.id,
      })
      return NextResponse.json({
        error: errData.error ?? '발행하지 못했어요. 채널 연결 상태를 확인해 주세요.',
        code: errData.code ?? 'PUBLISH_EXECUTION_FAILED',
      }, { status: published.status })
    }

    const result = await published.json()
    const execResult = result.executionResult
    return NextResponse.json({
      ...firstValuePublishOutcome(targetChannels, execResult),
      executionResult: execResult,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[first-value] publish failed unexpectedly', error)
    return NextResponse.json({ error: '발행 준비를 확인하지 못했어요.', code: 'TRANSIENT_ERROR' }, { status: 503 })
  }
}
