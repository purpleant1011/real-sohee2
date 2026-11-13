import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { observeBlogSearch } from '@/features/naver-publish/official-search-observation'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ workspaceId: string; contentId: string }> }
const noStore = { 'Cache-Control': 'private, no-store' }
const ids = z.object({ workspaceId: z.string().uuid(), contentId: z.union([z.string().uuid(), z.literal('latest')]) })
const payloadSchema = z.object({ channel: z.literal('naver_blog'), keywords: z.array(z.string().trim().min(1).max(100)).max(30).optional() })
const error = (status: number, code: string, message: string) => NextResponse.json({ error: message, errorCode: code }, { status, headers: noStore })
const noPublication = () => error(404, 'NAVER_PUBLISHED_VERSION_NOT_FOUND', '이 원고의 현재 버전에서 게시된 글 주소를 확인하지 못했어요.')
class LookupUnavailable extends Error {}

export async function GET(request: Request, { params }: Context) {
  try {
    const scope = ids.safeParse(await params)
    if (!scope.success) return error(400, 'VALIDATION_FAILED', '조회할 원고를 확인해 주세요.')
    const { workspaceId, contentId } = scope.data
    const auth = await authorizeQuickRequest(workspaceId)
    if (isResponse(auth)) return auth
    if (auth.workspaceId !== workspaceId) return error(403, 'WORKSPACE_FORBIDDEN', '이 매장에 접근할 수 없어요.')
    const db = auth.supabase

    const readVersion = async (versionId: string) => {
      const result = await db.from('content_versions').select('id, workspace_id, content_id, structured_payload')
        .eq('workspace_id', workspaceId).eq('id', versionId).maybeSingle()
      if (result.error) throw new LookupUnavailable()
      return result.data
    }
    const readAction = async (versionId?: string) => {
      let query = db.from('external_action_requests').select('id, content_version_id, created_at')
        .eq('workspace_id', workspaceId).eq('channel', 'naver_blog').eq('status', 'succeeded')
      if (versionId) query = query.eq('content_version_id', versionId)
      const result = await query.order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (result.error) throw new LookupUnavailable()
      return result.data
    }

    // The home card's explicit latest alias still resolves to a real article/version.
    const latestAction = contentId === 'latest' ? await readAction() : null
    const publishedVersion = latestAction?.content_version_id ? await readVersion(latestAction.content_version_id) : null
    if (contentId === 'latest' && !publishedVersion) return noPublication()
    const targetId = publishedVersion?.content_id ?? contentId
    const content = await db.from('content_items').select('id, workspace_id, channel, current_version_id')
      .eq('workspace_id', workspaceId).eq('id', targetId).eq('channel', 'naver_blog').maybeSingle()
    if (content.error) throw new LookupUnavailable()
    if (!content.data || content.data.workspace_id !== workspaceId || !content.data.current_version_id) return noPublication()

    const version = publishedVersion ?? await readVersion(content.data.current_version_id)
    if (!version || version.workspace_id !== workspaceId || version.content_id !== content.data.id
      || version.id !== content.data.current_version_id) return noPublication()
    const requestUrl = new URL(request.url)
    const urlOverride = (requestUrl.searchParams.get('url') ?? requestUrl.searchParams.get('postUrl'))?.trim() || null
    // 사장님이 직접 게시 후 알려 준 주소(owner-reported)를 우선한다. 과거 자동 게시 영수증은 보조 출처로만 읽는다.
    let ownerPostUrl = urlOverride
    let publishedAt: string | undefined
    if (!ownerPostUrl) {
      const action = latestAction ?? await readAction(version.id)
      if (!action || action.content_version_id !== version.id) return noPublication()
      const receipt = await db.from('external_action_receipts').select('action_request_id, result_url, created_at')
        .eq('workspace_id', workspaceId).eq('action_request_id', action.id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (receipt.error) throw new LookupUnavailable()
      if (!receipt.data?.result_url || receipt.data.action_request_id !== action.id) return noPublication()
      ownerPostUrl = receipt.data.result_url.trim()
      publishedAt = receipt.data.created_at || (action as { created_at?: string })?.created_at
    }

    const payload = payloadSchema.safeParse(version.structured_payload)
    const defaultKeyword = (payload.success && payload.data.keywords && payload.data.keywords.length > 0)
      ? payload.data.keywords[0]
      : ''
    const queryOverride = requestUrl.searchParams.get('query')
    const query = (queryOverride !== null ? queryOverride : defaultKeyword).trim()

    const sortParam = requestUrl.searchParams.get('sort')
    const sort = sortParam === 'date' ? 'date' : 'sim'
    const displayParam = requestUrl.searchParams.get('display')
    const display = displayParam ? parseInt(displayParam, 10) : undefined
    const startParam = requestUrl.searchParams.get('start')
    const start = startParam ? parseInt(startParam, 10) : undefined

    const observation = await observeBlogSearch({
      ownerPostUrl,
      query,
      sort,
      display,
      start,
      publishedAt,
    })

    return NextResponse.json(observation, { headers: noStore })
  } catch {
    return error(503, 'NAVER_RANK_UNAVAILABLE', '검색 관측 자료를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.')
  }
}
