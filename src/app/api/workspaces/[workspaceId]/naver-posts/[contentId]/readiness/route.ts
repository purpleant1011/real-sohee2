import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import {
  evaluateEditorialReadiness,
  type ReadinessInput,
  type ReadinessInputImage,
} from '@/features/channel-studio/naver/editorial-readiness'
import { buildNaverManuscriptText } from '@/features/content/naver-manuscript'
import { loadApprovedFactSnapshot } from '@/features/knowledge/approved-fact-resolver'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ workspaceId: string; contentId: string }> }
const noStore = { 'Cache-Control': 'private, no-store' }
const ids = z.object({
  workspaceId: z.string().uuid(),
  contentId: z.union([z.string().uuid(), z.literal('latest')]),
})

const error = (status: number, code: string, message: string) =>
  NextResponse.json({ error: message, errorCode: code }, { status, headers: noStore })

class LookupUnavailable extends Error {}

interface StoredNaverPayload {
  channel?: string
  title?: string
  introduction?: string
  sections?: Array<{ heading?: string; body: string }>
  conclusion?: string
  keywords?: string[]
  cta?: string
  editorBlocks?: any[]
  disclosure?: string
  images?: Array<{
    sourceKind?: 'OWNER_UPLOAD' | 'AI_ILLUSTRATION'
    rightsStatus?: 'CONFIRMED' | 'UNCONFIRMED'
    altText?: string
    aiLabeled?: boolean
  }>
  readerQuestions?: string[]
}

export async function GET(_request: Request, { params }: Context) {
  try {
    const scope = ids.safeParse(await params)
    if (!scope.success) return error(400, 'VALIDATION_FAILED', '조회할 원고를 확인해 주세요.')
    const { workspaceId, contentId } = scope.data

    const auth = await authorizeQuickRequest(workspaceId)
    if (isResponse(auth)) return auth
    if (auth.workspaceId !== workspaceId) return error(403, 'WORKSPACE_FORBIDDEN', '이 매장에 접근할 수 없어요.')

    const db = auth.supabase

    const readLatestContent = async () => {
      const result = await db
        .from('content_items')
        .select('id, workspace_id, channel, title, current_version_id, created_at')
        .eq('workspace_id', workspaceId)
        .eq('channel', 'naver_blog')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (result.error) throw new LookupUnavailable()
      return result.data
    }

    const readContent = async (targetId: string) => {
      const result = await db
        .from('content_items')
        .select('id, workspace_id, channel, title, current_version_id, created_at')
        .eq('workspace_id', workspaceId)
        .eq('id', targetId)
        .eq('channel', 'naver_blog')
        .maybeSingle()
      if (result.error) throw new LookupUnavailable()
      return result.data
    }

    const contentData = contentId === 'latest' ? await readLatestContent() : await readContent(contentId)
    if (!contentData || contentData.workspace_id !== workspaceId || !contentData.current_version_id) {
      return error(404, 'NAVER_CONTENT_NOT_FOUND', '원고를 찾을 수 없어요.')
    }

    const versionResult = await db
      .from('content_versions')
      .select('id, workspace_id, content_id, structured_payload, hashtags')
      .eq('workspace_id', workspaceId)
      .eq('id', contentData.current_version_id)
      .maybeSingle()
    if (versionResult.error) throw new LookupUnavailable()
    const version = versionResult.data
    if (!version || version.workspace_id !== workspaceId || version.content_id !== contentData.id) {
      return error(404, 'NAVER_VERSION_NOT_FOUND', '원고 버전을 찾을 수 없어요.')
    }

    // 이전 글 제목 목록 조회 (유사도 검사용)
    let priorPostTitles: string[] | undefined
    const priorResult = await db
      .from('content_items')
      .select('title')
      .eq('workspace_id', workspaceId)
      .eq('channel', 'naver_blog')
      .neq('id', contentData.id)
      .limit(20)
    if (!priorResult.error && Array.isArray(priorResult.data)) {
      priorPostTitles = priorResult.data
        .map((row: { title?: string }) => row.title)
        .filter((t: unknown): t is string => typeof t === 'string' && t.trim().length > 0)
    }

    const payload = (version.structured_payload ?? {}) as StoredNaverPayload
    const title = payload.title || contentData.title || ''

    const manuscript = {
      title,
      introduction: payload.introduction ?? '',
      sections: Array.isArray(payload.sections)
        ? payload.sections.map((s) => ({ heading: s.heading ?? '', body: s.body ?? '' }))
        : [],
      keywords: payload.keywords,
      cta: payload.cta,
      editorBlocks: payload.editorBlocks,
      disclosure: payload.disclosure,
    }
    const body = buildNaverManuscriptText(manuscript, 'body')

    const tags = Array.isArray(payload.keywords)
      ? payload.keywords
      : Array.isArray(version.hashtags)
        ? version.hashtags
        : []

    let images: ReadinessInputImage[] | undefined
    if (Array.isArray(payload.editorBlocks)) {
      const imageBlocks = payload.editorBlocks.filter(
        (block): block is { kind: 'image'; mediaId?: string; altText?: string } =>
          Boolean(block && typeof block === 'object' && block.kind === 'image'),
      )

      if (imageBlocks.length === 0) {
        images = []
      } else {
        const mediaIds = imageBlocks
          .map((b) => b.mediaId)
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)

        if (mediaIds.length === 0) {
          images = undefined
        } else {
          const mediaResult = await db
            .from('media_assets')
            .select('id, workspace_id, rights_status, provenance_kind, generation_metadata')
            .eq('workspace_id', workspaceId)
            .in('id', mediaIds)

          if (mediaResult.error || !Array.isArray(mediaResult.data)) {
            images = undefined
          } else {
            type MediaRow = {
              id: string
              workspace_id: string
              rights_status?: string | null
              provenance_kind?: string | null
              generation_metadata?: unknown
            }
            const mediaMap = new Map<string, MediaRow>()
            for (const row of mediaResult.data as MediaRow[]) {
              if (row && typeof row.id === 'string' && row.workspace_id === workspaceId) {
                mediaMap.set(row.id, row)
              }
            }

            const resolvedImages: ReadinessInputImage[] = []
            for (const block of imageBlocks) {
              if (!block.mediaId) continue
              const asset = mediaMap.get(block.mediaId)
              if (!asset) continue

              const hasMetadata =
                asset.generation_metadata != null &&
                (typeof asset.generation_metadata === 'object'
                  ? Object.keys(asset.generation_metadata as object).length > 0
                  : String(asset.generation_metadata).trim().length > 0)
              const isAiProvenance =
                typeof asset.provenance_kind === 'string' &&
                /AI|GENERAT/i.test(asset.provenance_kind)

              const isAi = hasMetadata || isAiProvenance
              const sourceKind: 'AI_ILLUSTRATION' | 'OWNER_UPLOAD' = isAi
                ? 'AI_ILLUSTRATION'
                : 'OWNER_UPLOAD'
              const rightsStatus: 'CONFIRMED' | 'UNCONFIRMED' =
                asset.rights_status === 'confirmed' ? 'CONFIRMED' : 'UNCONFIRMED'
              const altText = typeof block.altText === 'string' ? block.altText : undefined
              const aiLabeled = isAi ? Boolean(payload.disclosure?.trim()) : undefined

              resolvedImages.push({
                sourceKind,
                rightsStatus,
                altText,
                aiLabeled,
              })
            }

            images = resolvedImages.length > 0 ? resolvedImages : undefined
          }
        }
      }
    } else if (Array.isArray(payload.images)) {
      images = payload.images.map((img) => ({
        sourceKind: img.sourceKind === 'AI_ILLUSTRATION' ? 'AI_ILLUSTRATION' : 'OWNER_UPLOAD',
        rightsStatus: img.rightsStatus === 'CONFIRMED' ? 'CONFIRMED' : 'UNCONFIRMED',
        altText: img.altText,
        aiLabeled: img.aiLabeled,
      }))
    } else {
      images = undefined
    }

    const hasCta = Boolean(payload.cta?.trim())

    const url = new URL(_request.url, 'http://localhost')
    const qParams = url.searchParams.getAll('q')
    const validQuestions = qParams
      .map((q) => q.trim())
      .filter((q) => q.length >= 1 && q.length <= 200)
      .slice(0, 5)

    const readerQuestions: string[] | undefined =
      validQuestions.length > 0
        ? validQuestions
        : Array.isArray(payload.readerQuestions)
          ? payload.readerQuestions
          : undefined

    // 승인된 가게 사실만 근거로 쓴다. 조회 실패/테넌트 불일치면 undefined → 해당 축은 미평가(0점 날조 금지).
    let approvedFacts: string[] | undefined
    try {
      const snapshot = await loadApprovedFactSnapshot(auth.admin as unknown as Parameters<typeof loadApprovedFactSnapshot>[0], workspaceId)
      if (snapshot.workspaceId === workspaceId && snapshot.facts.every((fact) => fact.workspace_id === workspaceId)) {
        approvedFacts = snapshot.facts.map((fact) => fact.content)
      }
    } catch {
      approvedFacts = undefined
    }

    const readinessInput: ReadinessInput = {
      title,
      body,
      tags,
      approvedFacts,
      readerQuestions,
      priorPostTitles,
      images,
      hasCta,
    }

    const evaluation = evaluateEditorialReadiness(readinessInput)

    return NextResponse.json(evaluation, { headers: noStore })
  } catch {
    return error(503, 'READINESS_EVALUATION_FAILED', '콘텐츠 준비도를 평가하지 못했어요. 잠시 후 다시 시도해 주세요.')
  }
}
