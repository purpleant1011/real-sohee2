import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { getContentDetail } from '@/features/content/repository'
import { buildNaverManuscriptText } from '@/features/content/naver-manuscript'
import { loadNaverRevisionReadiness, type NaverRevisionReadiness } from '@/features/content/naver-revision-readiness'
import type { ApprovalPreviewIssue, ApprovalPreviewSnapshot, ContentDetail } from '@/features/content/types'
import { composeMetaPostText, evaluateMetaChannelLimits } from '@/features/publishing/meta-content-text'
import { missingPublishScopes } from '@/features/channels/required-publish-scopes'

type QueryResult = PromiseLike<{ data: unknown; error: unknown }>

export type ApprovalPreviewGateway = Readonly<{
  getContentDetail(workspaceId: string, contentId: string): Promise<ActionResult<ContentDetail>>
  listConnections(workspaceId: string, channel: 'instagram' | 'threads' | 'naver_blog'): QueryResult
  listApprovals(workspaceId: string, contentId: string, versionId: string): QueryResult
  readNaverRevisionReadiness?(): Promise<NaverRevisionReadiness>
  listMetaCredentials?(workspaceId: string, channel: 'instagram' | 'threads'): QueryResult
}>

const uuid = z.string().uuid()
const connectionStatus = z.enum([
  'disconnected', 'connecting', 'connected', 'expired', 'missing_permission',
  'wrong_account', 'provider_error', 'error', 'reauth_required', 'target_mismatch',
  'unavailable', 'revoked',
])
const connectionRow = z.object({
  id: uuid,
  workspace_id: uuid,
  channel: z.enum(['instagram', 'threads', 'naver_blog']),
  status: connectionStatus,
  account_label: z.string().trim().min(1).max(120).nullable(),
  token_expires_at: z.string().datetime({ offset: true }).nullable().optional(),
}).strict()
const approvalRow = z.object({
  id: uuid,
  workspace_id: uuid,
  content_id: uuid,
  version_id: uuid,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  status: z.enum(['approved', 'rejected']),
  decided_at: z.string().datetime({ offset: true }),
}).strict()
const metaCredentialRow = z.object({
  channel_connection_id: uuid.optional(),
  provider: z.enum(['instagram', 'threads']),
  status: z.string(),
  granted_scopes: z.array(z.string()).nullable().optional(),
  token_expires_at: z.string().nullable().optional(),
}).passthrough()

function failure(message = '게시 미리보기를 불러오지 못했어요.'): ActionResult<ApprovalPreviewSnapshot> {
  return { error: { message, requestId: 'approval-preview' } }
}

async function productionGateway(): Promise<ApprovalPreviewGateway> {
  const { createServerSupabaseClient } = await import('@/lib/supabase/server')
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  const supabase = await createServerSupabaseClient()
  const admin = createAdminSupabaseClient()
  return {
    getContentDetail: (workspaceId, contentId) => getContentDetail(workspaceId, contentId),
    readNaverRevisionReadiness: () => loadNaverRevisionReadiness(supabase),
    listConnections(workspaceId, channel) {
      if (channel === 'naver_blog') {
        return supabase.from('browser_channel_connections')
          .select('id, workspace_id, channel, status, account_label:external_account_label')
          .eq('workspace_id', workspaceId)
          .eq('channel', channel)
          .order('updated_at', { ascending: false })
          .limit(2)
      }
      return supabase.from('channel_connections')
        .select('id, workspace_id, channel, status, account_label, token_expires_at')
        .eq('workspace_id', workspaceId)
        .eq('channel', channel)
        .order('updated_at', { ascending: false })
        .limit(2)
    },
    listApprovals(workspaceId, contentId, versionId) {
      return supabase.from('approvals')
        .select('id, workspace_id, content_id, version_id, fingerprint, status, decided_at')
        .eq('workspace_id', workspaceId)
        .eq('content_id', contentId)
        .eq('version_id', versionId)
        .order('decided_at', { ascending: false })
        .limit(1)
    },
    listMetaCredentials(workspaceId, channel) {
      return admin.from('meta_channel_credentials')
        .select('channel_connection_id, provider, status, token_expires_at, granted_scopes')
        .eq('workspace_id', workspaceId)
        .eq('provider', channel)
        .eq('status', 'active')
        .order('updated_at', { ascending: false })
        .limit(1)
    },
  }
}

function addIssue(issues: ApprovalPreviewIssue[], code: string, message: string, recoveryHref?: string) {
  issues.push(Object.freeze({ code, message, ...(recoveryHref ? { recoveryHref } : {}) }))
}

function previewConnectionStatus(status: z.infer<typeof connectionStatus> | undefined): ApprovalPreviewSnapshot['account']['status'] {
  if (!status || status === 'revoked') return 'disconnected'
  if (status === 'reauth_required') return 'expired'
  if (status === 'target_mismatch') return 'wrong_account'
  if (status === 'unavailable') return 'provider_error'
  return status
}

export async function getApprovalPreview(
  workspaceId: string,
  contentId: string,
  providedGateway?: ApprovalPreviewGateway,
): Promise<ActionResult<ApprovalPreviewSnapshot>> {
  if (!uuid.safeParse(workspaceId).success || !uuid.safeParse(contentId).success) return failure()

  try {
    const gateway = providedGateway ?? await productionGateway()
    const detailResult = await gateway.getContentDetail(workspaceId, contentId)
    if (detailResult.error || detailResult.data.id !== contentId || detailResult.data.currentVersionId === null) {
      console.error('[sohee:approval-preview-failed]', { phase: 'content_detail', hasError: Boolean(detailResult.error) })
      return failure()
    }
    const detail = detailResult.data
    if (detail.channel !== 'instagram' && detail.channel !== 'threads' && detail.channel !== 'naver_blog') {
      console.error('[sohee:approval-preview-failed]', { phase: 'unsupported_channel' })
      return failure('이 채널은 아직 실제 게시를 지원하지 않아요.')
    }
    const current = detail.versions.find((version) => version.id === detail.currentVersionId)
    if (!current) {
      console.error('[sohee:approval-preview-failed]', { phase: 'current_version' })
      return failure()
    }

    const [connectionResult, approvalResult, revisionReadiness, credentialResult] = await Promise.all([
      gateway.listConnections(workspaceId, detail.channel),
      gateway.listApprovals(workspaceId, contentId, current.id),
      detail.channel === 'naver_blog'
        ? (gateway.readNaverRevisionReadiness?.() ?? Promise.resolve('unavailable' as const)).catch(() => 'unavailable' as const)
        : Promise.resolve(undefined),
      (detail.channel === 'instagram' || detail.channel === 'threads') && typeof gateway.listMetaCredentials === 'function'
        ? gateway.listMetaCredentials(workspaceId, detail.channel)
        : Promise.resolve({ data: null, error: null }),
    ])
    const connections = z.array(connectionRow).safeParse(connectionResult.data)
    const approvals = z.array(approvalRow).safeParse(approvalResult.data)
    if (connectionResult.error || approvalResult.error || !connections.success || !approvals.success) {
      console.error('[sohee:approval-preview-failed]', {
        phase: 'connections_or_approvals',
        connectionError: Boolean(connectionResult.error),
        approvalError: Boolean(approvalResult.error),
        connectionsParsed: connections.success,
        approvalsParsed: approvals.success,
      })
      return failure()
    }
    if (
      connections.data.some((row) => row.workspace_id !== workspaceId || row.channel !== detail.channel)
      || approvals.data.some((row) => row.workspace_id !== workspaceId || row.content_id !== contentId || row.version_id !== current.id)
    ) {
      console.error('[sohee:approval-preview-failed]', { phase: 'scope_mismatch' })
      return failure()
    }

    const issues: ApprovalPreviewIssue[] = []
    const sortedMedia = [...current.media].sort((left, right) => left.position - right.position)
    const positionsValid = sortedMedia.every((media, index) => media.position === index + 1)
      && new Set(sortedMedia.map((media) => media.position)).size === sortedMedia.length
    if (!positionsValid) addIssue(issues, 'media_order', '이미지 순서를 다시 정리해 주세요.')
    if (sortedMedia.some((media) => media.rightsStatus !== 'confirmed')) {
      addIssue(issues, 'media_rights', '모든 이미지의 사용권을 확인해 주세요.')
    }
    if (sortedMedia.some((media) => media.altText.trim().length === 0)) {
      addIssue(issues, 'media_alt_text', '각 이미지의 설명을 입력해 주세요.')
    }
    if (!current.rightsConfirmed || !current.generationEvidenceConfirmed) {
      addIssue(issues, 'evidence', '사용권과 생성 근거를 확인해 주세요.')
    }
    if (current.disclosure.trim().length === 0) {
      addIssue(issues, 'disclosure', '게시 고지를 확인해 주세요.')
    }

    let text: string
    let visibility: ApprovalPreviewSnapshot['visibility'] = null
    let naverBlocks: ApprovalPreviewSnapshot['naverBlocks']
    let naverCopy: ApprovalPreviewSnapshot['naverCopy']
    if (detail.channel === 'naver_blog') {
      const payload = current.structuredPayload
      if (!payload || payload.channel !== 'naver_blog') {
        console.error('[sohee:approval-preview-failed]', { phase: 'naver_payload' })
        return failure('네이버 블로그 본문을 다시 확인해 주세요.')
      }
      const placementIds = payload.imagePlacements.map((placement) => placement.mediaId.toLowerCase())
      const blockIds = payload.editorBlocks?.filter((block) => block.kind === 'image').map((block) => block.mediaId.toLowerCase())
      if (!positionsValid
        || placementIds.length !== sortedMedia.length
        || new Set(placementIds).size !== placementIds.length
        || placementIds.some((id, index) => id !== sortedMedia[index]?.id.toLowerCase())
        || (blockIds && (blockIds.length !== placementIds.length || blockIds.some((id, index) => id !== placementIds[index])))) {
        console.error('[sohee:approval-preview-failed]', { phase: 'naver_media_mismatch' })
        return failure('원고와 사진의 연결이 일치하지 않아요. 원고를 다시 확인해 주세요.')
      }
      visibility = payload.visibility ?? 'private'
      naverBlocks = payload.editorBlocks
      naverCopy = Object.freeze({
        title: payload.title,
        introduction: payload.introduction,
        sections: payload.sections.map((section) => ({ ...section })),
        keywords: [...payload.keywords],
        cta: payload.cta,
      })
      text = buildNaverManuscriptText({ ...payload, disclosure: current.disclosure })
    } else {
      try {
        text = composeMetaPostText(current)
      } catch {
        return failure('게시 문구와 해시태그를 다시 확인해 주세요.')
      }
      for (const issue of evaluateMetaChannelLimits({ channel: detail.channel, text, mediaCount: sortedMedia.length })) {
        addIssue(issues, issue.code, issue.message)
      }
    }

    const connection = connections.data.length === 1 ? connections.data[0]! : null
    const tokenExpired = connection?.token_expires_at
      ? Date.parse(connection.token_expires_at) <= Date.now() + 5 * 60_000
      : false
    const rawStatus = tokenExpired ? 'expired' : connection?.status
    const accountStatus = connections.data.length > 1 ? 'wrong_account' : previewConnectionStatus(rawStatus)
    if (connections.data.length > 1) {
      addIssue(issues, 'wrong_account', '연결된 공식 계정이 여러 개예요. 게시할 계정을 다시 연결해 주세요.', '/app/settings/channels')
    } else if (accountStatus !== 'connected') {
      addIssue(issues, `channel_${accountStatus}`, '공식 채널을 다시 연결한 뒤 게시할 수 있어요.', detail.channel === 'naver_blog' ? '/app/settings/channels/naver' : '/app/settings/channels')
    } else if (connection && (detail.channel === 'instagram' || detail.channel === 'threads') && typeof gateway.listMetaCredentials === 'function') {
      const parsedCreds = z.array(metaCredentialRow).safeParse(credentialResult?.data)
      const credential = parsedCreds.success
        ? parsedCreds.data.find((c) => !c.channel_connection_id || c.channel_connection_id === connection.id)
        : null
      const missing = missingPublishScopes(detail.channel, credential?.granted_scopes)
      if (missing.length > 0) {
        const channelDisplayName = detail.channel === 'threads' ? 'Threads' : 'Instagram'
        addIssue(
          issues,
          'channel_missing_scope',
          `${channelDisplayName} 연결이 만료되었거나 권한이 없어요. 채널을 다시 연결해 주세요.`,
          '/app/channels',
        )
      }
    }

    const approval = approvals.data[0] ?? null
    const approvalMatches = approval?.fingerprint === current.fingerprint
    if (approval && !approvalMatches) {
      addIssue(issues, 'approval_stale', '수정된 새 버전을 다시 승인해 주세요.')
    }

    return { data: Object.freeze({
      workspaceId,
      contentId,
      versionId: current.id,
      versionNumber: current.versionNumber,
      fingerprint: current.fingerprint,
      approval: Object.freeze({
        id: approvalMatches ? approval?.id ?? null : null,
        status: approvalMatches ? approval?.status ?? 'unreviewed' : 'unreviewed',
        fingerprint: approvalMatches ? approval?.fingerprint ?? null : null,
      }),
      channel: detail.channel,
      visibility,
      account: Object.freeze({
        connectionId: connections.data.length === 1 ? connection?.id ?? null : null,
        label: connection?.account_label ?? '공식 계정',
        status: accountStatus,
      }),
      caption: current.caption,
      hashtags: Object.freeze([...current.hashtags]),
      disclosure: current.disclosure,
      text,
      ...(naverCopy ? { naverCopy, naverRevisionReadiness: revisionReadiness } : {}),
      ...(naverBlocks ? { naverBlocks: Object.freeze(naverBlocks.map((block) => Object.freeze({ ...block }))) } : {}),
      media: Object.freeze(sortedMedia.map((media) => Object.freeze({
        id: media.id,
        position: media.position,
        mimeType: media.mimeType,
        altText: media.altText,
        src: `/api/workspaces/${workspaceId}/media/${media.id}`,
        // 원본 기준 크기·용량을 서버가 알 때만 내려보낸다. 모르면 null → 화면이 브라우저에서 잰다.
        width: media.width ?? null,
        height: media.height ?? null,
        sizeBytes: media.sizeBytes ?? null,
      }))),
      issues: Object.freeze(issues),
    }) }
  } catch (error) {
    console.error('[sohee:approval-preview-failed]', {
      phase: 'unexpected',
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })
    return failure()
  }
}
