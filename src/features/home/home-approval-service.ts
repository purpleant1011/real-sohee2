import type {
  HomeApprovalItem,
  HomeApprovalsResponse,
  BatchApprovalActionInput,
  BatchApprovalResult,
} from './home-approval-types'
import { computeApprovalFingerprint } from '@/features/engagement/draft'
import { computeDmApprovalFingerprint } from '@/features/engagement/dm/options-generator'
import { createInstagramDmService } from '@/features/engagement/dm/compose'

type AdminClient = any
export type ApprovalUserContext = string | { userId: string; role?: 'owner' | 'manager' }

export async function fetchPendingHomeApprovals(
  admin: AdminClient,
  workspaceId: string
): Promise<HomeApprovalsResponse> {
  // 1. Fetch Autonomy Level from engagement_policies
  let autonomyLevel: 'L1' | 'L2' | 'L3' = 'L2'
  try {
    const { data: policy } = await admin
      .from('engagement_policies')
      .select('autonomy_level')
      .eq('workspace_id', workspaceId)
      .limit(1)
      .maybeSingle()

    if (policy?.autonomy_level === 'L1_MANUAL') {
      autonomyLevel = 'L1'
    } else if (policy?.autonomy_level === 'L3_AUTONOMOUS') {
      autonomyLevel = 'L3'
    } else {
      autonomyLevel = 'L2'
    }
  } catch {
    autonomyLevel = 'L2'
  }

  const items: HomeApprovalItem[] = []
  const autoHandledCount = 0

  // 1-1. Fetch Knowledge Status and SmartPlace Photos for truthful quality gating
  let placePhotos: string[] = []
  let factsCount = 0
  let sourcesCount = 0
  try {
    const [{ count: fCount }, { count: sCount }, { data: placeSource }] = await Promise.all([
      admin.from('knowledge_facts').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
      admin.from('knowledge_sources').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
      admin.from('knowledge_sources')
        .select('refresh_policy')
        .eq('workspace_id', workspaceId)
        .eq('channel_type', 'naver_place')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    factsCount = fCount || 0
    sourcesCount = sCount || 0
    const photos = placeSource?.refresh_policy?.placeSummary?.photos
    if (Array.isArray(photos)) {
      placePhotos = photos.filter((p: any) => typeof p === 'string' && p.startsWith('http'))
    }
  } catch {
    // Non-blocking in test/isolated environments
  }

  // 2. Fetch pending social comments and drafts
  try {
    const { data: comments } = await admin
      .from('social_comments')
      .select('id, channel, author_handle, comment_text, classification, status, created_at')
      .eq('workspace_id', workspaceId)
      .in('status', ['DRAFTED', 'RECEIVED'])
      .order('created_at', { ascending: false })
      .limit(30)

    if (Array.isArray(comments) && comments.length > 0) {
      const commentIds = comments.map((c: any) => c.id)
      const { data: drafts } = await admin
        .from('comment_reply_drafts')
        .select('comment_id, draft_text, is_auto_approved')
        .eq('workspace_id', workspaceId)
        .in('comment_id', commentIds)

      const draftMap = new Map<string, any>()
      if (Array.isArray(drafts)) {
        for (const d of drafts) {
          draftMap.set(d.comment_id, d)
        }
      }

      for (const comment of comments) {
        const draft = draftMap.get(comment.id)
        if (!draft?.draft_text) continue

        const isCompliment =
          comment.classification === 'THANKS' ||
          comment.classification === 'GREETING' ||
          comment.classification === 'COMPLIMENT'

        // Truth invariant: without independent delivery evidence, compliments stay pending and are
        // never counted as auto-handled (autoHandledCount remains 0).

        const channelLabel = comment.channel === 'instagram' ? '인스타그램' : '스레드'
        const channelType = comment.channel === 'instagram' ? 'instagram' : 'threads'
        const approvalFingerprint = computeApprovalFingerprint(workspaceId, comment.id, draft.draft_text)

        items.push({
          id: `comment:${comment.id}`,
          category: 'comment_reply',
          channel: channelType,
          title: `${channelLabel} 댓글 답글 승인`,
          targetLabel: `@${comment.author_handle}`,
          sourceSnippet: comment.comment_text,
          draftSnippet: draft.draft_text,
          urgency: isCompliment ? '일상 소통' : '답변 요망',
          roiImpact: {
            type: 'retention',
            label: '소통 채널',
            value: channelLabel,
          },
          metadata: {
            commentId: comment.id,
            channel: comment.channel,
            classification: comment.classification,
            approvalFingerprint,
          },
          createdAt: comment.created_at || new Date().toISOString(),
        })
      }
    }
  } catch (err) {
    console.error('[fetchPendingHomeApprovals] comments query failed:', err)
  }

  // 3. Fetch pending quick posts (marketing_missions)
  try {
    const { data: missions } = await admin
      .from('marketing_missions')
      .select('id, status, metadata, created_at')
      .eq('workspace_id', workspaceId)
      .in('status', ['AWAITING_APPROVAL', 'draft'])
      .order('created_at', { ascending: false })
      .limit(10)

    if (Array.isArray(missions)) {
      const seenCaptions = new Set<string>()

      for (const mission of missions) {
        const meta = mission.metadata || {}
        const topic = meta.topic || '소셜 콘텐츠 기획'
        const rawCaption = meta.caption || meta.text || meta.summary || ''

        // 🌟 품질 게이트: 알맹이 없는 더미 텍스트이거나 20자 미만인 빈 제안은 사장님에게 노출하지 않음
        if (!rawCaption || rawCaption.trim() === '소희가 작성한 매장 소식 콘텐츠입니다.' || rawCaption.trim().length < 20) {
          continue
        }

        const caption = rawCaption.trim()

        // 🌟 중복 방지: 동일한 캡션이 2개 이상 반복 노출되는 현상 차단
        const normalized = caption.replace(/\s+/g, '').slice(0, 40)
        if (seenCaptions.has(normalized)) {
          continue
        }
        seenCaptions.add(normalized)

        // 🌟 이미지 자동 연동: 미션 이미지 > 연동된 스마트플레이스 실제 사진
        const imageUrl =
          meta.imageUrl ||
          meta.image_url ||
          meta.renditions?.[0]?.url ||
          meta.assetUrl ||
          (placePhotos.length > 0 ? placePhotos[0] : null)

        const hashtags = Array.isArray(meta.hashtags)
          ? meta.hashtags
          : ['#청라뷰티', '#1인샵집중케어', '#에스테틱']

        // Generate clean preview title from first line of caption or topic
        const firstLine = caption.split('\n')[0].replace(/^["'\[]/, '').replace(/["'\]]$/, '').trim()
        const displayTitle = firstLine.length > 5 ? firstLine.slice(0, 45) : topic

        items.push({
          id: `post:${mission.id}`,
          category: 'post_publish',
          channel: 'multi',
          title: '소셜 포스팅 발행 승인',
          targetLabel: displayTitle,
          sourceSnippet: topic,
          draftSnippet: caption.slice(0, 160) + (caption.length > 160 ? '...' : ''),
          fullCaption: caption,
          imageUrl,
          hashtags,
          goldenTimeLabel: '화·목 19:00 추천 발행',
          urgency: '골든타임 예약 대기',
          roiImpact: {
            type: 'reach',
            label: '발행 채널',
            value: (meta.channels || ['instagram', 'threads']).join(' · '),
          },
          metadata: {
            missionId: mission.id,
            channels: meta.channels || ['instagram', 'threads'],
          },
          createdAt: mission.created_at || new Date().toISOString(),
        })
      }
    }
  } catch (err) {
    console.error('[fetchPendingHomeApprovals] posts query failed:', err)
  }

  // 4. Fetch pending Instagram DMs
  try {
    const { data: dmThreads } = await admin
      .from('instagram_dm_threads')
      .select('id, customer_handle, customer_name, last_message_text, last_message_at, expires_at, status')
      .eq('workspace_id', workspaceId)
      .eq('status', 'NEEDS_REPLY')
      .order('last_message_at', { ascending: false })
      .limit(10)

    if (Array.isArray(dmThreads) && dmThreads.length > 0) {
      const threadIds = dmThreads.map((t: any) => t.id)
      const { data: drafts } = await admin
        .from('instagram_dm_drafts')
        .select('thread_id, draft_text')
        .eq('workspace_id', workspaceId)
        .in('thread_id', threadIds)

      const draftMap = new Map<string, string>()
      if (Array.isArray(drafts)) {
        for (const d of drafts) {
          if (d.draft_text) draftMap.set(d.thread_id, d.draft_text)
        }
      }

      for (const thread of dmThreads) {
        let urgencyText = '답변 대기'
        if (thread.expires_at) {
          const remainingMs = Math.max(0, new Date(thread.expires_at).getTime() - Date.now())
          const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60))
          urgencyText = remainingHours > 0 ? `${remainingHours}시간 남음` : '만료 임박'
        }

        const customerDisplay = thread.customer_name
          ? `${thread.customer_name} (@${thread.customer_handle})`
          : `@${thread.customer_handle}`

        const msg = thread.last_message_text || ''
        const actualDraft = draftMap.get(thread.id) || ''
        const draftFingerprint = actualDraft
          ? computeDmApprovalFingerprint(workspaceId, thread.id, actualDraft)
          : undefined

        items.push({
          id: `dm:${thread.id}`,
          category: 'dm_reply',
          channel: 'instagram',
          title: '인스타그램 DM 답장 승인',
          targetLabel: customerDisplay,
          sourceSnippet: msg || '고객 문의',
          draftSnippet: actualDraft,
          fullCaption: actualDraft,
          urgency: urgencyText,
          roiImpact: {
            type: 'revenue',
            label: '상담 채널',
            value: `@${thread.customer_handle} 1:1 DM`,
          },
          metadata: {
            threadId: thread.id,
            customerHandle: thread.customer_handle,
            customerName: thread.customer_name,
            hasDraft: Boolean(actualDraft),
            approvalFingerprint: draftFingerprint,
          },
          createdAt: thread.last_message_at || new Date().toISOString(),
        })
      }
    }
  } catch (err) {
    console.error('[fetchPendingHomeApprovals] dms query failed:', err)
  }

  // Sort by createdAt descending
  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const summary = {
    total: items.length,
    comments: items.filter((i) => i.category === 'comment_reply').length,
    posts: items.filter((i) => i.category === 'post_publish').length,
    dms: items.filter((i) => i.category === 'dm_reply').length,
    proposals: items.filter((i) => i.category === 'proposal').length,
  }

  const autoHandledLabel: string | undefined = undefined

  return {
    autonomyLevel,
    items,
    autoHandledCount,
    autoHandledLabel,
    summary,
    knowledgeStatus: {
      factsCount,
      sourcesCount,
      needsKnowledgePrompt: factsCount < 3,
    },
  }
}

export async function executeBatchHomeApprovals(
  admin: AdminClient,
  workspaceId: string,
  input: BatchApprovalActionInput,
  userContext: ApprovalUserContext = '00000000-0000-0000-0000-000000000000'
): Promise<BatchApprovalResult> {
  const { action, itemIds = [], all = false } = input
  const succeededIds: string[] = []
  const failedIds: string[] = []
  const reconciliationRequiredIds: string[] = []

  const userId = typeof userContext === 'string' ? userContext : userContext?.userId || '00000000-0000-0000-0000-000000000000'
  const role: 'owner' | 'manager' = typeof userContext === 'object' && userContext?.role === 'manager' ? 'manager' : 'owner'

  // If all is requested, fetch all pending
  let targetIds = itemIds
  if (all) {
    const pending = await fetchPendingHomeApprovals(admin, workspaceId)
    targetIds = pending.items.map((i) => i.id)
  }

  for (const rawId of targetIds) {
    const [type, id] = rawId.split(':')
    try {
      // 1. Invariant: Any createBooking request from home approval hub is strictly forbidden
      // Fail closed: reject the entire request instead of creating or ignoring
      if (input.createBooking) {
        failedIds.push(rawId)
        continue
      }

      // 2. Invariant: all: true blind sending of DMs is strictly forbidden on server
      if (all && type === 'dm') {
        failedIds.push(rawId)
        continue
      }

      if (type === 'comment') {
        // Verify comment existence and current status
        const { data: comment, error: commentSelectErr } = await admin
          .from('social_comments')
          .select('id, status')
          .eq('id', id)
          .eq('workspace_id', workspaceId)
          .maybeSingle()

        if (commentSelectErr || !comment) {
          failedIds.push(rawId)
          continue
        }

        // Only allow transitions from DRAFTED or RECEIVED
        if (comment.status !== 'DRAFTED' && comment.status !== 'RECEIVED') {
          failedIds.push(rawId)
          continue
        }

        if (action === 'approve') {
          // Find draft
          const { data: draft, error: draftErr } = await admin
            .from('comment_reply_drafts')
            .select('id, draft_text')
            .eq('workspace_id', workspaceId)
            .eq('comment_id', id)
            .maybeSingle()

          if (draftErr || !draft || !draft.draft_text) {
            failedIds.push(rawId)
            continue
          }

          const fingerprint = computeApprovalFingerprint(workspaceId, id, draft.draft_text)
          const clientFingerprint = input.fingerprints?.[rawId]
          if (!clientFingerprint || clientFingerprint !== fingerprint) {
            // The preview the user approved no longer matches the stored draft (or was never
            // verified by the client). Never approve text the user has not seen.
            failedIds.push(rawId)
            continue
          }

          // CAS filter on draft UPDATE: id + workspace_id + comment_id + draft_text stops a
          // concurrent draft edit from being approved under the old fingerprint.
          const { data: updatedDrafts, error: draftUpdateErr } = await admin
            .from('comment_reply_drafts')
            .update({
              approved_fingerprint: fingerprint,
              approved_by: userId,
              approved_at: new Date().toISOString(),
              is_auto_approved: false,
            })
            .eq('id', draft.id)
            .eq('workspace_id', workspaceId)
            .eq('comment_id', id)
            .eq('draft_text', draft.draft_text)
            .select('id')

          if (draftUpdateErr || !updatedDrafts || updatedDrafts.length === 0) {
            failedIds.push(rawId)
            continue
          }

          const revertDraftApproval = async (): Promise<boolean> => {
            const { error } = await admin
              .from('comment_reply_drafts')
              .update({
                approved_fingerprint: null,
                approved_by: null,
                approved_at: null,
                is_auto_approved: false,
              })
              .eq('id', draft.id)
              .eq('workspace_id', workspaceId)
              .eq('approved_fingerprint', fingerprint)
            return !error
          }

          const { data: updatedComments, error: commentUpdateErr } = await admin
            .from('social_comments')
            .update({ status: 'APPROVED' })
            .eq('id', id)
            .eq('workspace_id', workspaceId)
            .eq('status', comment.status)
            .select('id')

          if (commentUpdateErr || !updatedComments || updatedComments.length === 0) {
            // The draft binding is already committed. Compensate it so a retry does not inherit
            // a half-applied approval; if compensation itself fails we cannot state the outcome.
            const draftReverted = await revertDraftApproval()
            if (draftReverted) failedIds.push(rawId)
            else reconciliationRequiredIds.push(rawId)
            continue
          }

          // Concurrent-edit window: the draft may have been edited between the CAS binding and
          // the comment status update (an edit resets the draft approval while the comment stays
          // DRAFTED). Re-read and undo both writes unless the approved text still stands.
          const { data: verifiedDraft, error: verifyDraftErr } = await admin
            .from('comment_reply_drafts')
            .select('draft_text, approved_fingerprint')
            .eq('workspace_id', workspaceId)
            .eq('comment_id', id)
            .maybeSingle()

          const stillApprovedAsSeen =
            !verifyDraftErr &&
            verifiedDraft?.draft_text === draft.draft_text &&
            verifiedDraft?.approved_fingerprint === fingerprint

          if (!stillApprovedAsSeen) {
            const { data: revertedComments, error: revertCommentErr } = await admin
              .from('social_comments')
              .update({ status: comment.status })
              .eq('id', id)
              .eq('workspace_id', workspaceId)
              .eq('status', 'APPROVED')
              .select('id')
            const draftReverted = await revertDraftApproval()
            const fullyReverted = !revertCommentErr && Array.isArray(revertedComments) && revertedComments.length > 0
            if (verifyDraftErr || !fullyReverted || !draftReverted) reconciliationRequiredIds.push(rawId)
            else failedIds.push(rawId)
            continue
          }
        } else {
          // Dismiss
          const { data: dismissedComments, error: dismissErr } = await admin
            .from('social_comments')
            .update({ status: 'DISMISSED' })
            .eq('id', id)
            .eq('workspace_id', workspaceId)
            .eq('status', comment.status)
            .select('id')

          if (dismissErr || !dismissedComments || dismissedComments.length === 0) {
            failedIds.push(rawId)
            continue
          }
        }
        succeededIds.push(rawId)
      } else if (type === 'post') {
        // Verify post existence and current status
        const { data: mission, error: missionSelectErr } = await admin
          .from('marketing_missions')
          .select('id, status')
          .eq('id', id)
          .eq('workspace_id', workspaceId)
          .maybeSingle()

        if (missionSelectErr || !mission) {
          failedIds.push(rawId)
          continue
        }

        // Only allow transitions from AWAITING_APPROVAL or draft
        if (mission.status !== 'AWAITING_APPROVAL' && mission.status !== 'draft') {
          failedIds.push(rawId)
          continue
        }

        if (action === 'approve') {
          const { data: updatedMissions, error: postErr } = await admin
            .from('marketing_missions')
            .update({ status: 'APPROVED' })
            .eq('id', id)
            .eq('workspace_id', workspaceId)
            .eq('status', mission.status)
            .select('id')

          if (postErr || !updatedMissions || updatedMissions.length === 0) {
            failedIds.push(rawId)
            continue
          }
        } else {
          const { data: cancelledMissions, error: postCancelErr } = await admin
            .from('marketing_missions')
            .update({ status: 'CANCELLED' })
            .eq('id', id)
            .eq('workspace_id', workspaceId)
            .eq('status', mission.status)
            .select('id')

          if (postCancelErr || !cancelledMissions || cancelledMissions.length === 0) {
            failedIds.push(rawId)
            continue
          }
        }
        succeededIds.push(rawId)
      } else if (type === 'dm') {
        // Find thread
        const { data: thread, error: threadErr } = await admin
          .from('instagram_dm_threads')
          .select('*')
          .eq('id', id)
          .eq('workspace_id', workspaceId)
          .maybeSingle()

        if (threadErr || !thread) {
          failedIds.push(rawId)
          continue
        }

        // Already SENT or non-NEEDS_REPLY threads cannot be transitioned to DISMISSED or re-sent
        if (thread.status === 'SENT' || thread.status !== 'NEEDS_REPLY') {
          failedIds.push(rawId)
          continue
        }

        if (action === 'approve') {
          // Verify draft exists
          const { data: draft, error: draftErr } = await admin
            .from('instagram_dm_drafts')
            .select('id, draft_text, approved_fingerprint')
            .eq('workspace_id', workspaceId)
            .eq('thread_id', id)
            .maybeSingle()

          if (draftErr || !draft || !draft.draft_text?.trim()) {
            failedIds.push(rawId)
            continue
          }

          // Fingerprint validation: sha256(workspaceId:threadId:draftText)
          // Must provide a valid matching fingerprint from the preview; missing fingerprint is strictly rejected
          const expectedFingerprint = computeDmApprovalFingerprint(workspaceId, id, draft.draft_text)
          const clientFingerprint = input.fingerprints?.[rawId]
          if (!clientFingerprint || clientFingerprint !== expectedFingerprint) {
            // Preview draft has changed or was never verified; fail closed
            failedIds.push(rawId)
            continue
          }

          // Bind approved_fingerprint into draft before invoking send gate
          // CAS filter: .eq('draft_text', draft.draft_text) ensures no concurrent modification occurred
          const { data: boundDrafts, error: bindErr } = await admin
            .from('instagram_dm_drafts')
            .update({
              approved_fingerprint: expectedFingerprint,
              updated_at: new Date().toISOString(),
            })
            .eq('workspace_id', workspaceId)
            .eq('thread_id', id)
            .eq('draft_text', draft.draft_text)
            .select('id')

          if (bindErr || !boundDrafts || boundDrafts.length === 0) {
            failedIds.push(rawId)
            continue
          }

          // External DM send must go through verified send gate
          try {
            const dmService = createInstagramDmService(admin)
            const sendResult = await dmService.send(thread, { type: role, userId })
            // Success requires independent readback (sent) AND a locally reconciled record.
            const providerUncertain =
              sendResult?.providerOutcome === 'DELIVERY_UNKNOWN' ||
              sendResult?.providerOutcome === 'ACCEPTED_BUT_UNVERIFIED'
            const locallyUnreconciled =
              sendResult?.localOutcome === 'RECONCILIATION_REQUIRED' ||
              sendResult?.localOutcome === 'PERSISTENCE_FAILED'

            if (sendResult?.sent === true && !locallyUnreconciled) {
              succeededIds.push(rawId)
            } else if (providerUncertain || locallyUnreconciled) {
              // The provider may already hold a message we could not record. Reporting this as a
              // plain failure would invite a retry that duplicates the DM, so it is reconciliation
              // only — never failedIds.
              reconciliationRequiredIds.push(rawId)
            } else {
              failedIds.push(rawId)
            }
          } catch (sendErr) {
            console.error('[executeBatchHomeApprovals] DM send gate failed:', sendErr)
            failedIds.push(rawId)
          }
        } else {
          // Dismiss - only if status is NEEDS_REPLY (verify affected rows)
          const { data: dismissedThreads, error: dismissErr } = await admin
            .from('instagram_dm_threads')
            .update({ status: 'DISMISSED' })
            .eq('id', id)
            .eq('workspace_id', workspaceId)
            .eq('status', 'NEEDS_REPLY')
            .select('id')

          if (dismissErr || !dismissedThreads || dismissedThreads.length === 0) {
            failedIds.push(rawId)
          } else {
            succeededIds.push(rawId)
          }
        }
      } else {
        // Unknown or unsupported proposal ID cannot be marked succeeded
        failedIds.push(rawId)
      }
    } catch (itemErr) {
      console.error(`[executeBatchHomeApprovals] failed on ${rawId}:`, itemErr)
      failedIds.push(rawId)
    }
  }

  return {
    succeededIds,
    failedIds,
    reconciliationRequiredIds,
    processedCount: succeededIds.length,
  }
}
