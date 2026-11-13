import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import type {
  ContentDetail,
  ContentMediaAsset,
  ContentListItem,
  ContentListResult,
  ContentVersionMedia,
  ContentVersionSummary,
  WorkFilter,
} from './types'
import { channelContentSchema, normalizeStoredChannelPayload } from './channel-content-schema'

type QueryResult<T> = Promise<{ data: T | null; error: unknown }>

export type ContentRepositoryGateway = {
  listItems(workspaceId: string): QueryResult<unknown>
  listCurrentVersions(workspaceId: string, versionIds: readonly string[]): QueryResult<unknown>
  listFailedContentIds(workspaceId: string): QueryResult<unknown>
  getItem(workspaceId: string, contentId: string): QueryResult<unknown>
  listVersions(workspaceId: string, contentId: string): QueryResult<unknown>
  listVersionMedia(workspaceId: string, versionIds: readonly string[]): QueryResult<unknown>
  listConfirmedMedia(workspaceId: string): QueryResult<unknown>
}

const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime({ offset: true })
const filterSchema = z.enum(['all', 'in_progress', 'recovery', 'approved'])

const itemRowSchema = z
  .object({
    id: uuidSchema,
    workspace_id: uuidSchema,
    title: z.string().min(1).max(200),
    channel: z.enum(['instagram', 'threads', 'naver_blog', 'naver_place', 'daangn_business']),
    status: z.enum(['draft', 'review', 'approved', 'scheduled', 'published', 'archived']),
    current_version_id: uuidSchema.nullable(),
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .strict()

const currentVersionRowSchema = z
  .object({
    id: uuidSchema,
    content_id: uuidSchema,
    version_number: z.number().int().positive(),
    caption: z.string().min(1).max(2_200),
    created_at: timestampSchema,
  })
  .strict()

const versionRowSchema = currentVersionRowSchema
  .extend({
    workspace_id: uuidSchema,
    hashtags: z.array(z.string()),
    disclosure: z.string().max(500),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    revision_reason: z.string().max(500).nullable(),
    rights: z.object({ confirmed: z.boolean().optional() }).passthrough(),
    generation_evidence: z.object({ confirmed: z.boolean().optional() }).passthrough(),
    structured_payload: z.unknown(),
    harness_rule_ids: z.array(uuidSchema),
    content_version_knowledge: z.array(
      z.object({ knowledge_item_id: uuidSchema }).strict(),
    ),
  })
  .strict()

const versionMediaResultSchema = z
  .object({
    links: z.array(
      z
        .object({
          workspace_id: uuidSchema,
          version_id: uuidSchema,
          media_asset_id: uuidSchema,
          position: z.number().int().min(0).max(19),
          media_assets: z
            .object({
              id: uuidSchema,
              workspace_id: uuidSchema,
              mime_type: z.string().min(1).max(120),
              rights_status: z.enum(['pending', 'confirmed', 'rejected']),
              // 원본 기준 크기·용량. 업로드 전 사진이나 옛 행은 null 일 수 있다.
              width: z.number().int().min(0).max(100_000).nullable(),
              height: z.number().int().min(0).max(100_000).nullable(),
              size_bytes: z.number().int().min(0).max(1_000_000_000).nullable(),
            })
            .strict(),
        })
        .strict(),
    ),
    artifacts: z.array(
      z
        .object({
          version_id: uuidSchema.nullable(),
          artifact_slides: z.array(
            z
              .object({
                position: z.number().int().min(1).max(20),
                role: z.enum(['cover', 'detail', 'proof', 'action']),
                media_asset_id: uuidSchema.nullable(),
                alt_text: z.string().max(500),
                rights_status: z.enum(['pending', 'confirmed', 'rejected']),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict()

const failedContentRowSchema = z.object({ content_id: uuidSchema }).strict()
const mediaRowSchema = z
  .object({
    id: uuidSchema,
    workspace_id: uuidSchema,
    mime_type: z.string().min(1).max(120),
    size_bytes: z.number().int().positive().max(10 * 1024 * 1024),
    created_at: timestampSchema,
  })
  .strict()

function failure<T>(message: string, requestId: string): ActionResult<T> {
  return { error: { message, requestId } }
}

async function createSupabaseGateway(): Promise<ContentRepositoryGateway> {
  const { createServerSupabaseClient } = await import('@/lib/supabase/server')
  const supabase = await createServerSupabaseClient()

  return {
    async listItems(workspaceId) {
      return supabase
        .from('content_items')
        .select(
          'id, workspace_id, title, channel, status, current_version_id, created_at, updated_at',
        )
        .eq('workspace_id', workspaceId)
        .order('updated_at', { ascending: false })
        .limit(201)
    },
    async listCurrentVersions(workspaceId, versionIds) {
      if (versionIds.length === 0) return { data: [], error: null }
      return supabase
        .from('content_versions')
        .select('id, content_id, version_number, caption, created_at')
        .eq('workspace_id', workspaceId)
        .in('id', [...versionIds])
    },
    async listFailedContentIds(workspaceId) {
      return supabase
        .from('schedules')
        .select('content_id')
        .eq('workspace_id', workspaceId)
        .eq('status', 'failed')
        .limit(201)
    },
    async getItem(workspaceId, contentId) {
      return supabase
        .from('content_items')
        .select(
          'id, workspace_id, title, channel, status, current_version_id, created_at, updated_at',
        )
        .eq('workspace_id', workspaceId)
        .eq('id', contentId)
        .maybeSingle()
    },
    async listVersions(workspaceId, contentId) {
      return supabase
        .from('content_versions')
        .select(
          'id, workspace_id, content_id, version_number, caption, hashtags, disclosure, fingerprint, revision_reason, rights, generation_evidence, structured_payload, harness_rule_ids, created_at, content_version_knowledge(knowledge_item_id)',
        )
        .eq('workspace_id', workspaceId)
        .eq('content_id', contentId)
        .order('version_number', { ascending: false })
    },
    async listVersionMedia(workspaceId, versionIds) {
      if (versionIds.length === 0) {
        return { data: { links: [], artifacts: [] }, error: null }
      }

      const [linksResult, artifactsResult] = await Promise.all([
        supabase
          .from('content_version_media')
          .select(
            'workspace_id, version_id, media_asset_id, position, media_assets!content_version_media_workspace_id_media_asset_id_fkey(id, workspace_id, mime_type, rights_status, width, height, size_bytes)',
          )
          .eq('workspace_id', workspaceId)
          .in('version_id', [...versionIds])
          .order('position', { ascending: true }),
        supabase
          .from('conversation_artifacts')
          .select(
            'version_id, artifact_slides(position, role, media_asset_id, alt_text, rights_status)',
          )
          .eq('workspace_id', workspaceId)
          .in('version_id', [...versionIds]),
      ])

      return {
        data: { links: linksResult.data, artifacts: artifactsResult.data },
        error: linksResult.error ?? artifactsResult.error,
      }
    },
    async listConfirmedMedia(workspaceId) {
      return supabase
        .from('media_assets')
        .select('id, workspace_id, mime_type, size_bytes, created_at')
        .eq('workspace_id', workspaceId)
        .eq('bucket_id', 'content-media')
        .eq('kind', 'content')
        .eq('rights_status', 'confirmed')
        .order('created_at', { ascending: false })
        .limit(50)
    },
  }
}

export async function listConfirmedContentMedia(
  workspaceId: string,
  providedGateway?: ContentRepositoryGateway,
): Promise<ActionResult<readonly ContentMediaAsset[]>> {
  const parsedWorkspaceId = uuidSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) {
    return failure('미디어 요청을 확인해 주세요.', 'content-media-input')
  }

  try {
    const gateway = providedGateway ?? (await createSupabaseGateway())
    const result = await gateway.listConfirmedMedia(parsedWorkspaceId.data)
    const rows = z.array(mediaRowSchema).safeParse(result.data)
    if (result.error || !rows.success) {
      return failure('사용 가능한 미디어를 불러오지 못했습니다.', 'content-media')
    }

    return {
      data: rows.data
        .filter((row) => row.workspace_id === parsedWorkspaceId.data)
        .map((row) => ({
          id: row.id,
          mimeType: row.mime_type,
          sizeBytes: row.size_bytes,
          createdAt: row.created_at,
        })),
    }
  } catch {
    return failure('사용 가능한 미디어를 불러오지 못했습니다.', 'content-media')
  }
}

function isRecoveryItem(status: string, failedContentIds: ReadonlySet<string>, id: string) {
  return status === 'scheduled' && failedContentIds.has(id)
}

/** 원본 크기·용량은 양수만 사실로 받는다. 0 이나 음수는 '모름'(null)이다. */
function knownSize(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function isInProgress(status: string) {
  return status === 'draft' || status === 'review'
}

function isApproved(status: string) {
  return status === 'approved' || status === 'scheduled' || status === 'published'
}

function matchesFilter(item: ContentListItem, filter: WorkFilter) {
  if (filter === 'all') return true
  if (filter === 'in_progress') return isInProgress(item.status)
  if (filter === 'recovery') return item.needsRecovery
  return !item.needsRecovery && isApproved(item.status)
}

export async function listContent(
  workspaceId: string,
  filter: WorkFilter = 'all',
  cursor: string | null = null,
  search = '',
  providedGateway?: ContentRepositoryGateway,
): Promise<ActionResult<ContentListResult>> {
  const parsedWorkspaceId = uuidSchema.safeParse(workspaceId)
  const parsedFilter = filterSchema.safeParse(filter)
  const parsedCursor = cursor === null ? { success: true as const, data: null } : timestampSchema.safeParse(cursor)
  if (!parsedWorkspaceId.success || !parsedFilter.success || !parsedCursor.success) {
    return failure('업무 결과 목록 요청을 확인해 주세요.', 'content-list-input')
  }

  try {
    const gateway = providedGateway ?? (await createSupabaseGateway())
    const [itemsResult, failedResult] = await Promise.all([
      gateway.listItems(parsedWorkspaceId.data),
      gateway.listFailedContentIds(parsedWorkspaceId.data),
    ])
    const parsedItems = z.array(itemRowSchema).safeParse(itemsResult.data)
    const parsedFailed = z.array(failedContentRowSchema).safeParse(failedResult.data)

    if (itemsResult.error || failedResult.error || !parsedItems.success || !parsedFailed.success) {
      return failure(
        '업무 결과 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        'content-list',
      )
    }

    const failedContentIds = new Set(parsedFailed.data.map((row) => row.content_id))
    const normalizedSearch = search.trim().toLocaleLowerCase('ko-KR').slice(0, 100)
    const searchedRows = parsedItems.data.filter(
      (row) =>
        row.workspace_id === parsedWorkspaceId.data &&
        (normalizedSearch.length === 0 ||
          row.title.toLocaleLowerCase('ko-KR').includes(normalizedSearch)),
    )
    const currentVersionIds = searchedRows.flatMap((row) =>
      row.current_version_id ? [row.current_version_id] : [],
    )
    const versionResult = await gateway.listCurrentVersions(
      parsedWorkspaceId.data,
      currentVersionIds,
    )
    const parsedVersions = z.array(currentVersionRowSchema).safeParse(versionResult.data)
    if (versionResult.error || !parsedVersions.success) {
      return failure(
        '업무 결과 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        'content-list',
      )
    }

    const versionById = new Map(parsedVersions.data.map((version) => [version.id, version]))
    const allItems: ContentListItem[] = searchedRows.map((row) => {
      const currentVersion = row.current_version_id
        ? versionById.get(row.current_version_id)
        : undefined
      return {
        id: row.id,
        title: row.title,
        status: row.status,
        channel: row.channel,
        currentVersionId: row.current_version_id,
        currentVersionNumber: currentVersion?.version_number ?? null,
        currentCaption: currentVersion?.caption ?? null,
        updatedAt: row.updated_at,
        source: 'actual',
        needsRecovery: isRecoveryItem(row.status, failedContentIds, row.id),
      }
    })

    const cursorTime = parsedCursor.data === null ? null : Date.parse(parsedCursor.data)
    const filteredItems = allItems.filter(
      (item) =>
        matchesFilter(item, parsedFilter.data) &&
        (cursorTime === null || Date.parse(item.updatedAt) < cursorTime),
    )
    const pageItems = filteredItems.slice(0, 20)

    return {
      data: {
        items: pageItems,
        nextCursor:
          filteredItems.length > pageItems.length
            ? (pageItems.at(-1)?.updatedAt ?? null)
            : null,
      },
    }
  } catch {
    return failure(
      '업무 결과 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
      'content-list',
    )
  }
}

function toVersionSummary(
  row: z.infer<typeof versionRowSchema>,
  media: readonly ContentVersionMedia[],
): ContentVersionSummary {
  return {
    id: row.id,
    versionNumber: row.version_number,
    caption: row.caption,
    hashtags: row.hashtags,
    disclosure: row.disclosure,
    fingerprint: row.fingerprint,
    revisionReason: row.revision_reason,
    createdAt: row.created_at,
    rightsConfirmed: row.rights.confirmed === true,
    generationEvidenceConfirmed: row.generation_evidence.confirmed === true,
    mediaCount: media.length,
    media,
    structuredPayload: channelContentSchema.safeParse(normalizeStoredChannelPayload(row.structured_payload)).data ?? null,
    knowledgeIds: row.content_version_knowledge.map((knowledge) => knowledge.knowledge_item_id),
    harnessRuleIds: row.harness_rule_ids,
  }
}

export async function getContentDetail(
  workspaceId: string,
  contentId: string,
  providedGateway?: ContentRepositoryGateway,
): Promise<ActionResult<ContentDetail>> {
  const parsedWorkspaceId = uuidSchema.safeParse(workspaceId)
  const parsedContentId = uuidSchema.safeParse(contentId)
  if (!parsedWorkspaceId.success || !parsedContentId.success) {
    return failure('요청한 작업을 찾을 수 없습니다.', 'content-not-found')
  }

  try {
    const gateway = providedGateway ?? (await createSupabaseGateway())
    const itemResult = await gateway.getItem(parsedWorkspaceId.data, parsedContentId.data)
    if (itemResult.error) {
      return failure(
        '작업 상세를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        'content-detail',
      )
    }

    const parsedItem = itemRowSchema.safeParse(itemResult.data)
    if (!parsedItem.success || parsedItem.data.workspace_id !== parsedWorkspaceId.data) {
      return failure('요청한 작업을 찾을 수 없습니다.', 'content-not-found')
    }

    const versionResult = await gateway.listVersions(parsedWorkspaceId.data, parsedContentId.data)
    const parsedVersions = z.array(versionRowSchema).safeParse(versionResult.data)
    if (versionResult.error || !parsedVersions.success) {
      return failure(
        '작업 상세를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        'content-detail',
      )
    }

    const workspaceVersions = parsedVersions.data.filter(
      (version) =>
        version.workspace_id === parsedWorkspaceId.data &&
        version.content_id === parsedContentId.data,
    )
    const mediaResult = await gateway.listVersionMedia(
      parsedWorkspaceId.data,
      workspaceVersions.map((version) => version.id),
    )
    const parsedMedia = versionMediaResultSchema.safeParse(mediaResult.data)
    if (mediaResult.error || !parsedMedia.success) {
      return failure(
        '작업 상세를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        'content-detail',
      )
    }

    const slideByVersionAndMedia = new Map(
      parsedMedia.data.artifacts.flatMap((artifact) =>
        artifact.version_id
          ? artifact.artifact_slides.flatMap((slide) =>
              slide.media_asset_id
                ? [[`${artifact.version_id}:${slide.media_asset_id}`, slide] as const]
                : [],
            )
          : [],
      ),
    )
    const payloadMediaByVersionAndMedia = new Map<string, Readonly<{
      altText: string
      role: ContentVersionMedia['role']
    }>>()
    for (const version of workspaceVersions) {
      const payload = channelContentSchema.safeParse(normalizeStoredChannelPayload(version.structured_payload)).data
      const placements = payload?.channel === 'naver_blog'
        ? payload.imagePlacements
        : payload?.channel === 'instagram' ? payload.slides : []
      for (const placement of placements) {
        payloadMediaByVersionAndMedia.set(`${version.id}:${placement.mediaId}`, {
          altText: placement.altText,
          role: placement.placement === 'inline' ? 'detail' : placement.placement,
        })
      }
    }
    const mediaByVersion = new Map<string, ContentVersionMedia[]>()
    for (const link of parsedMedia.data.links) {
      if (
        link.workspace_id !== parsedWorkspaceId.data ||
        link.media_assets.workspace_id !== parsedWorkspaceId.data ||
        link.media_asset_id !== link.media_assets.id
      ) {
        continue
      }

      const slide = slideByVersionAndMedia.get(`${link.version_id}:${link.media_asset_id}`)
      const payloadMedia = payloadMediaByVersionAndMedia.get(`${link.version_id}:${link.media_asset_id}`)
      const media = mediaByVersion.get(link.version_id) ?? []
      media.push({
        id: link.media_assets.id,
        position: link.position + 1,
        mimeType: link.media_assets.mime_type,
        altText: slide?.alt_text ?? payloadMedia?.altText ?? `${link.position + 1}번 게시 이미지`,
        role: slide?.role ?? payloadMedia?.role ?? null,
        rightsStatus: link.media_assets.rights_status,
        width: knownSize(link.media_assets.width),
        height: knownSize(link.media_assets.height),
        sizeBytes: knownSize(link.media_assets.size_bytes),
      })
      mediaByVersion.set(link.version_id, media)
    }
    for (const media of mediaByVersion.values()) {
      media.sort((left, right) => left.position - right.position)
    }

    const versions = workspaceVersions.map((version) =>
      toVersionSummary(version, mediaByVersion.get(version.id) ?? []),
    )
    const currentVersion = versions.find(
      (version) => version.id === parsedItem.data.current_version_id,
    )

    return {
      data: {
        id: parsedItem.data.id,
        title: parsedItem.data.title,
        status: parsedItem.data.status,
        channel: parsedItem.data.channel,
        currentVersionId: parsedItem.data.current_version_id,
        currentVersionNumber: currentVersion?.versionNumber ?? null,
        createdAt: parsedItem.data.created_at,
        updatedAt: parsedItem.data.updated_at,
        source: 'actual',
        versions,
      },
    }
  } catch {
    return failure(
      '작업 상세를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
      'content-detail',
    )
  }
}
