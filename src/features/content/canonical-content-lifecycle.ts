/**
 * Canonical Content & Approval Lifecycle Service (ANI-1023, ANI-1041, ANI-1042, ANI-1043)
 *
 * Implements strict, single-path content lifecycle:
 * WorkItem -> ContentItem -> ContentVersion -> ApprovalDecision -> ExternalActionRequest
 *
 * Enforces Fail-Closed DB SSOT:
 * - ContentItem (public.content_items)
 * - ContentVersion with 64-char hex SHA-256 fingerprint (public.content_versions)
 * - Immutable Approval (public.approvals)
 * - ContentDraft synchronization (public.content_drafts)
 * - Stale Concurrency Protection on Content Revisions
 */

import crypto from 'node:crypto'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { PersistenceError } from '@/lib/errors/persistence-error'
import { assertSupabaseSuccess } from '@/lib/supabase/require-success'

export interface CreateContentParams {
  workspaceId: string
  channel: 'instagram' | 'threads' | 'naver_blog' | 'naver_place'
  title: string
  caption: string
  hashtags?: string[]
  mediaUrls?: string[]
  createdBy?: string
  missionId?: string | null
  traceId?: string | null
}

export interface ReviseContentParams {
  workspaceId: string
  contentId: string
  expectedVersionId: string
  caption: string
  hashtags?: string[]
  mediaUrls?: string[]
  revisionReason?: string
  createdBy?: string
  revisedBy?: string
  missionId?: string | null
  traceId?: string | null
}

export interface ApproveContentParams {
  workspaceId: string
  contentId: string
  versionId: string
  fingerprint: string
  decidedBy?: string
  reason?: string
  missionId?: string | null
  traceId?: string | null
}

export interface CanonicalMediaAssetSummary {
  id: string
  objectPath: string
  sha256Digest: string
  width: number
  height: number
  mimeType: string
}

export interface CanonicalContentRecord {
  contentId: string
  workspaceId: string
  channel: string
  title: string
  status: string
  currentVersionId: string
  versionNumber: number
  caption: string
  hashtags: string[]
  fingerprint: string
  isApproved: boolean
  approvalId?: string
  mediaAssets?: CanonicalMediaAssetSummary[]
  mediaUrls?: string[]
  createdAt: string
  updatedAt: string
}

export interface ResolveContentTargetParams {
  workspaceId: string
  userPrompt: string
  activeContentId?: string
}

export interface ResolveContentTargetResult {
  resolved: boolean
  contentId?: string
  ambiguous?: boolean
  candidateItems?: CanonicalContentRecord[]
  message?: string
}

export function computeCanonicalFingerprint(caption: string): string {
  return crypto.createHash('sha256').update(caption.trim()).digest('hex')
}

export class CanonicalContentLifecycleService {
  /**
   * 1. Creates canonical ContentItem and ContentVersion in a single durable flow
   */
  public static async createContent(params: CreateContentParams): Promise<{
    contentId: string
    versionId: string
    versionNumber: number
    fingerprint: string
    status: string
  }> {
    const {
      workspaceId,
      channel,
      title,
      caption,
      hashtags = [],
      mediaUrls = [],
      createdBy = '00000000-0000-0000-0000-000000000000',
    } = params

    const cleanCaption = caption.trim()
    if (!cleanCaption) {
      throw new PersistenceError('createContent', 'Content caption cannot be empty')
    }

    const fingerprint = computeCanonicalFingerprint(cleanCaption)
    const contentId = crypto.randomUUID()
    const versionId = crypto.randomUUID()
    const now = new Date().toISOString()

    try {
      const supabase = await createServerSupabaseClient()
      const db = supabase as any

      // 1. Insert content_items
      const contentItemMutation = await db
        .from('content_items')
        .insert({
          id: contentId,
          workspace_id: workspaceId,
          channel,
          title: title.slice(0, 200),
          status: 'draft',
          current_version_id: versionId,
          created_by: createdBy,
          created_at: now,
          updated_at: now,
        })
        .select('id')
        .single()

      assertSupabaseSuccess(contentItemMutation, 'CanonicalContentLifecycle.createContent:contentItem')

      // 2. Insert content_versions
      const contentVersionMutation = await db
        .from('content_versions')
        .insert({
          id: versionId,
          workspace_id: workspaceId,
          content_id: contentId,
          version_number: 1,
          caption: cleanCaption,
          hashtags,
          media_urls: mediaUrls,
          generation_evidence: {
            source: 'sohee_agent_orchestrator',
            createdAt: now,
            missionId: params.missionId || null,
            traceId: params.traceId || null,
          },
          fingerprint,
          created_by: createdBy,
          created_at: now,
        })
        .select('id')
        .single()

      assertSupabaseSuccess(contentVersionMutation, 'CanonicalContentLifecycle.createContent:contentVersion')

      // 2.1 Bind to marketing_missions lineage if missionId is present
      if (params.missionId) {
        const binding = await db
          .from('marketing_missions')
          .update({
            content_id: contentId,
            content_version_id: versionId,
            updated_at: now,
          })
          .eq('id', params.missionId)
          .eq('workspace_id', workspaceId)
          .select('id')
          .maybeSingle()
        if (binding.error || !binding.data) {
          throw new PersistenceError('createContent', '원고는 저장되었지만 미션 연결을 확인하지 못했습니다. 상태를 다시 확인해 주세요.', binding.error, 'MISSION_CONTENT_BINDING_FAILED')
        }
      }

      // 3. Sync to content_drafts (Dual-read compatibility)
      await db.from('content_drafts').upsert(
        {
          draft_id: versionId,
          workspace_id: workspaceId,
          topic: title.slice(0, 500),
          channel,
          content: cleanCaption,
          status: 'DRAFT',
          created_at: now,
          updated_at: now,
        },
        { onConflict: 'workspace_id,draft_id' }
      )

      return {
        contentId,
        versionId,
        versionNumber: 1,
        fingerprint,
        status: 'draft',
      }
    } catch (err) {
      if (err instanceof PersistenceError) throw err
      console.error('[CanonicalContentLifecycle] Error creating content:', err)
      throw new PersistenceError('createContent', (err as Error).message || 'Failed to persist canonical content', err)
    }
  }

  /**
   * 2. Revise content into an immutable new ContentVersion with Stale Concurrency Protection (ANI-1041, ANI-1042)
   */
  public static async reviseContent(params: ReviseContentParams): Promise<{
    contentId: string
    versionId: string
    versionNumber: number
    fingerprint: string
    status: 'draft'
  }> {
    const {
      workspaceId,
      contentId,
      expectedVersionId,
      caption,
      hashtags,
      mediaUrls,
      revisionReason = '',
      createdBy,
      revisedBy,
    } = params

    const actorId = createdBy || revisedBy || '00000000-0000-0000-0000-000000000000'

    const cleanCaption = caption.trim()
    if (!cleanCaption) {
      throw new PersistenceError('reviseContent', '수정할 본문 내용이 비어 있습니다.', null, 'EMPTY_CAPTION')
    }

    const newFingerprint = computeCanonicalFingerprint(cleanCaption)
    const newVersionId = crypto.randomUUID()
    const now = new Date().toISOString()

    try {
      const supabase = await createServerSupabaseClient()
      const db = supabase as any

      // 1. Fetch current content item for workspace
      const { data: item, error: itemError } = await db
        .from('content_items')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('id', contentId)
        .maybeSingle()

      if (itemError || !item) {
        throw new PersistenceError('reviseContent', '수정할 콘텐츠를 찾을 수 없습니다.', itemError, 'CONTENT_NOT_FOUND')
      }

      // 2. Stale Concurrency Check: must match expectedVersionId
      if (item.current_version_id !== expectedVersionId) {
        throw new PersistenceError(
          'reviseContent',
          '동시 수정 충돌이 감지되었습니다. 최신 버전을 확인 후 다시 시도해 주세요.',
          null,
          'STALE_VERSION_CONFLICT'
        )
      }

      const previousVersionResult = await db
        .from('content_versions')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('content_id', contentId)
        .eq('id', expectedVersionId)
        .maybeSingle()
      assertSupabaseSuccess(previousVersionResult, 'CanonicalContentLifecycle.reviseContent:previousVersion')
      const previousVersion = previousVersionResult.data
      if (!previousVersion) {
        throw new PersistenceError('reviseContent', '수정할 원본 콘텐츠 버전을 찾을 수 없습니다.', null, 'VERSION_NOT_FOUND')
      }

      const mediaResult = await db
        .from('content_version_media')
        .select('media_asset_id, position')
        .eq('workspace_id', workspaceId)
        .eq('version_id', expectedVersionId)
        .order('position', { ascending: true })
      assertSupabaseSuccess(mediaResult, 'CanonicalContentLifecycle.reviseContent:previousMedia')

      const missionResult = await db.from('marketing_missions').select('*')
        .eq('workspace_id', workspaceId).eq('content_id', contentId).maybeSingle()
      assertSupabaseSuccess(missionResult, 'CanonicalContentLifecycle.reviseContent:mission')
      const mission = missionResult.data
      if (params.missionId && mission?.id !== params.missionId) {
        throw new PersistenceError('reviseContent', '미션과 콘텐츠 연결을 확인할 수 없습니다.', null, 'STALE_VERSION_CONFLICT')
      }
      if (mission) {
        if (mission.status !== 'AWAITING_APPROVAL' || mission.content_version_id !== expectedVersionId || !mission.source_conversation_job_id) {
          throw new PersistenceError('reviseContent', '현재 미션은 원고를 수정할 수 없습니다.', null, 'STALE_VERSION_CONFLICT')
        }
        const approvalsResult = await db.from('agent_approvals').select('id,status,version')
          .eq('workspace_id', workspaceId).eq('action_run_id', mission.source_conversation_job_id).order('id')
        assertSupabaseSuccess(approvalsResult, 'CanonicalContentLifecycle.reviseContent:runApprovals')
        if (!Array.isArray(approvalsResult.data) || approvalsResult.data.some((approval: any) => approval.status === 'APPROVED')) {
          throw new PersistenceError('reviseContent', '이미 승인된 실행은 원고 수정으로 변경할 수 없습니다.', null, 'STALE_VERSION_CONFLICT')
        }
        for (const approval of approvalsResult.data) {
          if (approval.status !== 'PENDING') continue
          const expired = await db.from('agent_approvals')
            .update({ status: 'EXPIRED', version: approval.version + 1, updated_at: now })
            .eq('workspace_id', workspaceId).eq('id', approval.id)
            .eq('status', 'PENDING').eq('version', approval.version).select('id').maybeSingle()
          assertSupabaseSuccess(expired, 'CanonicalContentLifecycle.reviseContent:expireApproval')
          if (!expired.data) throw new PersistenceError('reviseContent', '승인 상태가 변경되었습니다.', null, 'STALE_VERSION_CONFLICT')
        }
        const reserved = await db.from('marketing_missions')
          .update({ status: 'PRODUCING', approval_id: null, updated_at: now })
          .eq('workspace_id', workspaceId).eq('id', mission.id).eq('status', 'AWAITING_APPROVAL')
          .eq('content_version_id', expectedVersionId).eq('updated_at', mission.updated_at).select('id').maybeSingle()
        assertSupabaseSuccess(reserved, 'CanonicalContentLifecycle.reviseContent:reserveMission')
        if (!reserved.data) throw new PersistenceError('reviseContent', '미션 상태가 변경되었습니다.', null, 'STALE_VERSION_CONFLICT')
      }

      // 3. Fetch existing versions to calculate next version_number
      const { data: versions } = await db
        .from('content_versions')
        .select('version_number')
        .eq('workspace_id', workspaceId)
        .eq('content_id', contentId)
        .order('version_number', { ascending: false })

      const maxNumber = versions && versions.length > 0 ? Math.max(...versions.map((v: any) => v.version_number || 1)) : 1
      const nextVersionNumber = maxNumber + 1

      // 4. Insert new version
      const versionMutation = await db
        .from('content_versions')
        .insert({
          id: newVersionId,
          workspace_id: workspaceId,
          content_id: contentId,
          version_number: nextVersionNumber,
          caption: cleanCaption.slice(0, 2200),
          hashtags: (hashtags ?? previousVersion.hashtags ?? []).slice(0, 30),
          disclosure: previousVersion.disclosure ?? '',
          rights: mediaUrls === undefined ? previousVersion.rights : { mediaUrls },
          generation_evidence: { source: 'canonical_content_lifecycle_revision', createdAt: now },
          revision_reason: revisionReason.slice(0, 500),
          fingerprint: newFingerprint,
          created_by: actorId,
          created_at: now,
        })
        .select('id')
        .single()

      assertSupabaseSuccess(versionMutation, 'CanonicalContentLifecycle.reviseContent:contentVersion')

      if (mediaUrls === undefined && mediaResult.data?.length) {
        const mediaMutation = await db.from('content_version_media').insert(
          mediaResult.data.map((media: any) => ({
            workspace_id: workspaceId,
            version_id: newVersionId,
            media_asset_id: media.media_asset_id,
            position: media.position,
          }))
        )
        assertSupabaseSuccess(mediaMutation, 'CanonicalContentLifecycle.reviseContent:preserveMedia')
      }

      // 5. Publish the version only if no other editor has replaced the original.

      const itemUpdate = await db
        .from('content_items')
        .update({
          current_version_id: newVersionId,
          status: 'draft',
          updated_at: now,
        })
        .eq('id', contentId)
        .eq('workspace_id', workspaceId)
        .eq('current_version_id', expectedVersionId)
        .select('id')
        .maybeSingle()

      assertSupabaseSuccess(itemUpdate, 'CanonicalContentLifecycle.reviseContent:contentItems')
      if (!itemUpdate.data) {
        throw new PersistenceError('reviseContent', '동시 수정 충돌이 감지되었습니다. 최신 버전을 확인해 주세요.', null, 'STALE_VERSION_CONFLICT')
      }

      if (mission) {
        const rebound = await db.from('marketing_missions')
          .update({ content_version_id: newVersionId, status: 'AWAITING_APPROVAL', updated_at: now })
          .eq('workspace_id', workspaceId).eq('id', mission.id).eq('status', 'PRODUCING')
          .eq('content_version_id', expectedVersionId).eq('updated_at', now)
          .select('id').maybeSingle()
        if (rebound.error || !rebound.data) {
          throw new PersistenceError('reviseContent', '원고는 저장되었지만 미션 연결을 확인하지 못했습니다. 다시 승인하거나 게시하지 말고 상태를 확인해 주세요.', null, 'REVISION_RECONCILIATION_REQUIRED')
        }
      }

      // 6. Sync to content_drafts
      await db.from('content_drafts').upsert(
        {
          draft_id: newVersionId,
          workspace_id: workspaceId,
          topic: item.title,
          channel: item.channel,
          content: cleanCaption,
          status: 'DRAFT',
          created_at: now,
          updated_at: now,
        },
        { onConflict: 'workspace_id,draft_id' }
      )

      return {
        contentId,
        versionId: newVersionId,
        versionNumber: nextVersionNumber,
        fingerprint: newFingerprint,
        status: 'draft',
      }
    } catch (err) {
      if (err instanceof PersistenceError) throw err
      console.error('[CanonicalContentLifecycle] Error revising content:', err)
      throw new PersistenceError('reviseContent', (err as Error).message || 'Failed to revise canonical content', err)
    }
  }

  /**
   * 3. Approve content version with exact SHA-256 fingerprint verification and readback (ANI-1043)
   */
  public static async approveContentVersion(params: ApproveContentParams): Promise<{
    approvalId: string
    contentId: string
    versionId: string
    fingerprint: string
    status: 'approved'
  }> {
    const {
      workspaceId,
      contentId,
      versionId,
      fingerprint,
      decidedBy = '00000000-0000-0000-0000-000000000000',
      reason = '사장님 직접 원고 최종 승인 완료',
    } = params

    const approvalId = crypto.randomUUID()
    const now = new Date().toISOString()

    try {
      const supabase = await createServerSupabaseClient()
      const db = supabase as any

      // 1. Verify content item exists in workspace
      const { data: item, error: itemError } = await db
        .from('content_items')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('id', contentId)
        .maybeSingle()

      if (itemError || !item) {
        throw new PersistenceError('approveContentVersion', '콘텐츠를 찾을 수 없거나 워크스페이스가 일치하지 않습니다.', itemError, 'WORKSPACE_MISMATCH')
      }

      // 2. Exact version binding: must be latest version (current_version_id === versionId)
      if (item.current_version_id !== versionId) {
        throw new PersistenceError('approveContentVersion', '최신 버전만 승인할 수 있습니다.', null, 'NOT_LATEST_VERSION')
      }

      // 3. Verify version exists and verify fingerprint
      const { data: versionRow, error: versionError } = await db
        .from('content_versions')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('content_id', contentId)
        .eq('id', versionId)
        .maybeSingle()

      if (versionError || !versionRow) {
        throw new PersistenceError('approveContentVersion', '해당 콘텐츠 버전을 찾을 수 없습니다.', versionError, 'VERSION_NOT_FOUND')
      }

      if (versionRow.fingerprint !== fingerprint) {
        throw new PersistenceError('approveContentVersion', '버전 지문(fingerprint)이 일치하지 않습니다.', null, 'FINGERPRINT_MISMATCH')
      }

      // 4. Insert immutable approval
      const approvalMutation = await db
        .from('approvals')
        .insert({
          id: approvalId,
          workspace_id: workspaceId,
          content_id: contentId,
          version_id: versionId,
          fingerprint,
          status: 'approved',
          disclosure_confirmed: true,
          rights_confirmed: true,
          reason: reason.slice(0, 500),
          decided_by: decidedBy,
          decided_at: now,
        })
        .select('id')
        .single()

      assertSupabaseSuccess(approvalMutation, 'CanonicalContentLifecycle.approveContentVersion:approvals')

      // Verify this exact stored decision before propagating approval to content or mission state.
      const { data: readback, error: readbackError } = await db
        .from('approvals')
        .select('id, workspace_id, content_id, version_id, fingerprint, status, decided_by, decided_at, rights_confirmed, disclosure_confirmed')
        .eq('workspace_id', workspaceId)
        .eq('id', approvalId)
        .maybeSingle()

      if (readbackError || !readback || readback.id !== approvalId || readback.workspace_id !== workspaceId
        || readback.content_id !== contentId || readback.version_id !== versionId
        || readback.fingerprint !== fingerprint || readback.status !== 'approved'
        || readback.decided_by !== decidedBy || typeof readback.decided_at !== 'string'
        || !Number.isFinite(Date.parse(readback.decided_at))
        || readback.rights_confirmed !== true || readback.disclosure_confirmed !== true) {
        throw new PersistenceError('approveContentVersion', '승인 레코드 저장 검증(Readback)에 실패했습니다.', readbackError, 'APPROVAL_READBACK_FAILED')
      }

      // 5. Update content_items status
      const itemUpdate = await db
        .from('content_items')
        .update({ status: 'approved', updated_at: now })
        .eq('id', contentId)
        .eq('workspace_id', workspaceId)
        .eq('current_version_id', versionId)
        .select('id')
        .maybeSingle()

      assertSupabaseSuccess(itemUpdate, 'CanonicalContentLifecycle.approveContentVersion:contentItems')
      if (!itemUpdate.data) {
        throw new PersistenceError('approveContentVersion', '승인 중 원고가 변경되었습니다. 최신 버전을 다시 확인해 주세요.', null, 'NOT_LATEST_VERSION')
      }

      // 6. Update content_drafts status
      await db
        .from('content_drafts')
        .update({ status: 'APPROVED', updated_at: now })
        .eq('draft_id', versionId)
        .eq('workspace_id', workspaceId)

      // 6.1 Bind approval to marketing_missions lineage and transition state if missionId is present
      if (params.missionId) {
        try {
          await db
            .from('marketing_missions')
            .update({
              approval_id: approvalId,
              status: 'APPROVED',
              owner_action_required: false,
              updated_at: now,
            })
            .eq('id', params.missionId)
            .eq('workspace_id', workspaceId)

          await db.from('mission_events').insert({
            workspace_id: workspaceId,
            mission_id: params.missionId,
            trace_id: params.traceId || `trc-appr-${approvalId}`,
            from_status: 'AWAITING_APPROVAL',
            to_status: 'APPROVED',
            actor_type: 'USER',
            actor_id: decidedBy,
            event_name: 'MISSION_APPROVED',
            payload: { contentId, versionId, fingerprint, reason },
            occurred_at: now,
          })
        } catch (mApprErr) {
          console.warn('[CanonicalContentLifecycle] Non-fatal mission approval notice:', mApprErr)
        }
      }

      return {
        approvalId,
        contentId,
        versionId,
        fingerprint,
        status: 'approved',
      }
    } catch (err) {
      if (err instanceof PersistenceError) throw err
      console.error('[CanonicalContentLifecycle] Error approving content:', err)
      throw new PersistenceError('approveContentVersion', (err as Error).message || 'Failed to persist approval', err)
    }
  }

  /**
   * 4. Get single canonical content item with active version & approval status (ANI-1042)
   */
  public static async getContent(workspaceId: string, contentId: string): Promise<CanonicalContentRecord | null> {
    try {
      const supabase = await createServerSupabaseClient()
      const db = supabase as any

      const { data: item, error: itemError } = await db
        .from('content_items')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('id', contentId)
        .maybeSingle()

      if (itemError || !item) return null

      const { data: version } = await db
        .from('content_versions')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('id', item.current_version_id)
        .maybeSingle()

      if (!version) return null

      const { data: approval } = await db
        .from('approvals')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('version_id', item.current_version_id)
        .eq('status', 'approved')
        .maybeSingle()

      // Query associated media assets via content_version_media (version_id SSOT)
      let mediaAssets: CanonicalMediaAssetSummary[] = []
      let mediaUrls: string[] = []
      try {
        const { data: mediaRows } = await db
          .from('content_version_media')
          .select('position, role, media_asset_id')
          .eq('workspace_id', workspaceId)
          .eq('version_id', version.id)
          .order('position', { ascending: true })

        if (mediaRows && mediaRows.length > 0) {
          const assetIds = mediaRows.map((r: any) => r.media_asset_id)
          const { data: assetRecords } = await db
            .from('media_assets')
            .select('id, object_path, sha256_digest, width, height, mime_type')
            .eq('workspace_id', workspaceId)
            .in('id', assetIds)

          if (assetRecords && assetRecords.length > 0) {
            const assetMap = new Map<string, any>(assetRecords.map((a: any) => [a.id, a]))
            mediaAssets = mediaRows
              .map((r: any) => assetMap.get(r.media_asset_id))
              .filter(Boolean)
              .map((a: any) => ({
                id: a.id,
                objectPath: a.object_path,
                sha256Digest: a.sha256_digest,
                width: a.width,
                height: a.height,
                mimeType: a.mime_type,
              }))
            mediaUrls = mediaAssets.map((m) => `/api/workspaces/${workspaceId}/media/${m.id}`)
          }
        }
      } catch (mediaErr) {
        console.warn('[CanonicalContentLifecycle] Failed to fetch media assets for version:', version.id, mediaErr)
      }

      return {
        contentId: item.id,
        workspaceId: item.workspace_id,
        channel: item.channel,
        title: item.title,
        status: item.status,
        currentVersionId: version.id,
        versionNumber: version.version_number,
        caption: version.caption,
        hashtags: version.hashtags || [],
        fingerprint: version.fingerprint,
        isApproved: !!approval,
        approvalId: approval?.id,
        mediaAssets,
        mediaUrls,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }
    } catch (err) {
      console.error('[CanonicalContentLifecycle] Error getting content:', err)
      return null
    }
  }

  /**
   * 5. Resolve ambiguous user reference ('이거/아까 거/마지막 초안') to canonical ContentItem (ANI-1042)
   */
  public static async resolveAmbiguousContentTarget(params: ResolveContentTargetParams): Promise<ResolveContentTargetResult> {
    const { workspaceId, userPrompt, activeContentId } = params

    // 1. Explicit active content provided
    if (activeContentId) {
      const active = await CanonicalContentLifecycleService.getContent(workspaceId, activeContentId)
      if (active) {
        return { resolved: true, contentId: active.contentId }
      }
    }

    // 2. Query workspace content items
    const items = await CanonicalContentLifecycleService.listWorkspaceContents(workspaceId)
    if (items.length === 0) {
      return { resolved: false, message: '수정할 수 있는 콘텐츠 초안이 없습니다.' }
    }

    // 3. Exactly 1 content item exists
    if (items.length === 1) {
      return { resolved: true, contentId: items[0].contentId }
    }

    // 4. Try title or channel matching
    const matching = items.filter(it =>
      userPrompt.includes(it.title) ||
      (it.channel && userPrompt.toLowerCase().includes(it.channel.toLowerCase()))
    )
    if (matching.length === 1) {
      return { resolved: true, contentId: matching[0].contentId }
    }

    // 5. Multiple items exist without explicit context -> Ambiguity!
    return {
      resolved: false,
      ambiguous: true,
      candidateItems: items.slice(0, 5),
      message: '어떤 콘텐츠를 수정할지 선택해 주세요.',
    }
  }

  /**
   * 6. Get all canonical contents for workspace. Prohibits fake samples in production ACTUAL.
   */
  public static async listWorkspaceContents(workspaceId: string): Promise<CanonicalContentRecord[]> {
    const db = await createServerSupabaseClient() as any
    const { data: items, error: itemsError } = await db
      .from('content_items')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })

    if (itemsError || !items) throw new Error('콘텐츠 목록을 조회하지 못했습니다.')
    if (items.length === 0) return []

    // Batch by current version instead of serial per-item round trips. Every query retains RLS
    // and the explicit tenant filter; bounded IN lists also avoid oversized request URLs.
    const readRelated = async (table: string, columns: string, key: string, ids: string[]): Promise<any[]> => {
      const rows: any[] = []
      const uniqueIds = [...new Set(ids.filter(Boolean))]
      for (let offset = 0; offset < uniqueIds.length; offset += 50) {
        let query = db.from(table).select(columns).eq('workspace_id', workspaceId)
          .in(key, uniqueIds.slice(offset, offset + 50))
        if (table === 'approvals') query = query.eq('status', 'approved')
        if (table === 'content_version_media') query = query.order('position', { ascending: true })
        const { data, error } = await query
        // Do not project a truncated relationship set as complete approval/media truth.
        if (error || !data || data.length >= 1000) throw new Error('콘텐츠 상세 정보를 조회하지 못했습니다.')
        rows.push(...data)
      }
      return rows
    }
    const versionIds = items.map((item: any) => item.current_version_id)
    const [versions, approvals, mediaRows] = await Promise.all([
      readRelated('content_versions', '*', 'id', versionIds),
      readRelated('approvals', '*', 'version_id', versionIds),
      readRelated('content_version_media', 'version_id, position, role, media_asset_id', 'version_id', versionIds),
    ])
    const assets = await readRelated('media_assets', 'id, object_path, sha256_digest, width, height, mime_type',
      'id', mediaRows.map(row => row.media_asset_id))
    const versionMap = new Map<string, any>(versions.map(version => [version.id, version]))
    const approvalMap = new Map<string, any>()
    for (const approval of approvals) {
      if (approvalMap.has(approval.version_id)) throw new Error('콘텐츠 승인 정보를 확인하지 못했습니다.')
      approvalMap.set(approval.version_id, approval)
    }
    const assetMap = new Map<string, any>(assets.map(asset => [asset.id, asset]))
    const mediaByVersion = new Map<string, any[]>()
    for (const row of mediaRows) {
      const group = mediaByVersion.get(row.version_id) || []
      group.push(row)
      mediaByVersion.set(row.version_id, group)
    }

    return items.map((item: any): CanonicalContentRecord => {
      const version = versionMap.get(item.current_version_id)
      if (!version) throw new Error('콘텐츠 버전 정보를 확인하지 못했습니다.')
      const approval = approvalMap.get(version.id)
      const mediaAssets: CanonicalMediaAssetSummary[] = (mediaByVersion.get(version.id) || []).map(row => {
        const asset = assetMap.get(row.media_asset_id)
        if (!asset) throw new Error('콘텐츠 이미지 정보를 확인하지 못했습니다.')
        return { id: asset.id, objectPath: asset.object_path, sha256Digest: asset.sha256_digest,
          width: asset.width, height: asset.height, mimeType: asset.mime_type }
      })
      return {
        contentId: item.id,
        workspaceId: item.workspace_id,
        channel: item.channel,
        title: item.title,
        status: item.status,
        currentVersionId: version.id,
        versionNumber: version.version_number,
        caption: version.caption,
        hashtags: version.hashtags || [],
        fingerprint: version.fingerprint,
        isApproved: !!approval,
        approvalId: approval?.id,
        mediaAssets,
        mediaUrls: mediaAssets.map(media => `/api/workspaces/${workspaceId}/media/${media.id}`),
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }
    })
  }
}
