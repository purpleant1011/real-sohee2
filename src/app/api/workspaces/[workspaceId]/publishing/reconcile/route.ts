export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { CanonicalActionLedgerService } from '@/features/external-actions/canonical-action-ledger'
import { loadChannelCredentialByChannel } from '@/features/channels/credential-repository'
import { getPostReadback } from '@/lib/providers/instagram-provider'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params

  // Cross-tenant guard: this reads external action records and channel credentials, so a
  // non-member must be refused before any lookup.
  const auth = await authorizeQuickRequest(workspaceId)
  if (isResponse(auth)) return auth

  try {
    const body = await request.json()
    const { actionRequestId } = body

    if (!actionRequestId) {
      return NextResponse.json(
        { success: false, error: 'actionRequestId is required' },
        { status: 400 }
      )
    }

    const supabase = await createServerSupabaseClient()
    const db = supabase as any

    // 1. Fetch action request to get channel and targetExternalId
    const { data: actionReq, error: reqError } = await db
      .from('external_action_requests')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', actionRequestId)
      .maybeSingle()

    if (reqError || !actionReq) {
      return NextResponse.json(
        { success: false, error: 'Action request not found' },
        { status: 404 }
      )
    }

    if (actionReq.status !== 'unknown_result' && actionReq.status !== 'executing') {
      return NextResponse.json({
        success: true,
        reconciled: false,
        status: actionReq.status,
        message: `Action request is already in status '${actionReq.status}'. No reconciliation needed.`,
      })
    }

    const channelKey = actionReq.channel as 'instagram' | 'threads'
    const cred = await loadChannelCredentialByChannel(workspaceId, channelKey)

    // 2. Fetch latest attempt to get provider_reference or target
    const { data: attempt } = await db
      .from('external_action_attempts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('action_request_id', actionRequestId)
      .order('attempt_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    const providerRef = attempt?.provider_reference || actionReq.exact_payload?.postId

    const outcome = await CanonicalActionLedgerService.reconcileUnknownRequest({
      workspaceId,
      actionRequestId,
      readbackFn: async () => {
        if (!providerRef || !cred?.accessToken) {
          return { isLive: false }
        }

        const readback = await getPostReadback(providerRef, cred.accessToken, {
          channel: channelKey,
        })

        if (!readback.isLive || !readback.permalink || !readback.postId) {
          return { isLive: false }
        }

        return {
          isLive: true,
          externalPostId: readback.postId,
          permalink: readback.permalink,
          observedPayload: {
            caption: readback.caption,
            readbackRequestId: readback.readbackRequestId,
            observedAt: readback.observedAt,
            captionDigest: readback.captionDigest,
          },
        }
      },
    })

    return NextResponse.json({
      success: outcome.reconciled,
      reconciled: outcome.reconciled,
      status: outcome.status,
      resultUrl: outcome.resultUrl,
      receiptId: outcome.receiptId,
      message: outcome.reconciled
        ? '외부 채널 실게시물이 정상 확인되어 상태가 성공으로 복구되었습니다.'
        : '외부 채널에서 게시물을 확인할 수 없어 불확실 상태(RESULT_UNKNOWN)가 유지됩니다.',
    })
  } catch (err: unknown) {
    console.error('[ReconcileRoute] Error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Reconcile failed' },
      { status: 500 }
    )
  }
}
