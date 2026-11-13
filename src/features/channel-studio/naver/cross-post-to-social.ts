import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { createContentItemWithClient } from '@/features/content/actions/create-item'
import { createVersionWithClient } from '@/features/content/actions/create-version'
import { normalizeHashtags } from './generate-naver-post'
import { DEFAULT_AI_DISCLOSURE } from '@/features/publishing/meta-content-text'

export type CrossPostToSocialInput = Readonly<{
  workspaceId: string
  userId: string
  naverContentId: string
  naverVersionId: string
  channels?: readonly ('instagram' | 'threads')[]
  userClient: SupabaseClient<Database>
  deps?: {
    createItem?: typeof createContentItemWithClient
    createVersion?: typeof createVersionWithClient
  }
}>

export type CrossPostResult = Readonly<{
  instagram?: { contentId: string; versionId: string }
  threads?: { contentId: string; versionId: string }
}>

export function buildInstagramCaption(
  title: string,
  introduction: string,
  sections: Array<{ heading: string; body: string }>,
  cta?: string,
): string {
  const lines: string[] = []
  lines.push(`✨ ${title.trim()}`)
  lines.push('')
  if (introduction) {
    lines.push(introduction.trim())
    lines.push('')
  }
  for (const sec of sections.slice(0, 3)) {
    if (sec.heading) {
      lines.push(`📍 ${sec.heading.trim()}`)
    }
    if (sec.body) {
      const sentences = sec.body.split(/(?<=[.!?])\s+/).filter(Boolean)
      const summary = sentences.slice(0, 2).join(' ')
      lines.push(summary.trim())
    }
    lines.push('')
  }
  lines.push(cta ? `💬 ${cta.trim()}` : '💬 예약 및 문의는 프로필 링크를 확인해 주세요!')
  return lines.join('\n').trim().slice(0, 2_200)
}

export function buildThreadsCaption(
  title: string,
  sections: Array<{ heading: string; body: string }>,
): string {
  const lines: string[] = []
  lines.push(`${title.trim()}에 대해 손님들이 많이 물어보시는데요,`)
  lines.push('')
  if (sections[0]?.body) {
    const sentences = sections[0].body.split(/(?<=[.!?])\s+/).filter(Boolean)
    lines.push(sentences.slice(0, 3).join(' ').trim())
    lines.push('')
  }
  lines.push('궁금한 점 있으시면 언제든 편하게 댓글 남겨주세요! 😊')
  const full = lines.join('\n').trim()
  return full.slice(0, 480)
}

export async function crossPostToSocial(
  input: CrossPostToSocialInput,
): Promise<CrossPostResult> {
  const { workspaceId, userId, naverVersionId, userClient } = input
  const createItem = input.deps?.createItem ?? createContentItemWithClient
  const createVersion = input.deps?.createVersion ?? createVersionWithClient
  const channels = input.channels ?? ['instagram', 'threads']

  // 1. Load Naver version and its structured payload
  const { data: naverVersion, error: loadError } = await userClient
    .from('content_versions')
    .select('id, content_id, structured_payload, content_items!content_versions_workspace_content_fkey!inner(title)')
    .eq('workspace_id', workspaceId)
    .eq('id', naverVersionId)
    .single()

  if (loadError || !naverVersion) {
    throw new Error('네이버 블로그 게시물 정보를 찾을 수 없습니다.')
  }

  const payload = naverVersion.structured_payload as Record<string, any> | null
  const title = String(payload?.title || (naverVersion.content_items as any)?.title || '매장 소식').trim()
  const introduction = String(payload?.introduction || '').trim()
  const sections = Array.isArray(payload?.sections) ? payload.sections : []
  const rawKeywords = Array.isArray(payload?.keywords) ? payload.keywords : []
  const hashtags = normalizeHashtags(rawKeywords)
  const placements = Array.isArray(payload?.imagePlacements) ? payload.imagePlacements : []
  const mediaIds: string[] = placements
    .map((p: any) => p.mediaId)
    .filter((id: any): id is string => typeof id === 'string' && id.length > 0)

  const result: {
    instagram?: { contentId: string; versionId: string }
    threads?: { contentId: string; versionId: string }
  } = {}

  // 2. Generate Instagram Post
  if (channels.includes('instagram')) {
    const igCaption = buildInstagramCaption(title, introduction, sections, payload?.cta)
    const igItemRes = await createItem(userClient, {
      workspaceId,
      title: `[인스타] ${title}`,
      channel: 'instagram',
    })

    if (igItemRes.data) {
      const igContentId = igItemRes.data.contentId
      const igSlides = mediaIds.slice(0, 5).map((mediaId, idx) => ({
        mediaId,
        placement: (idx === 0 ? 'cover' : 'inline') as 'cover' | 'inline',
        altText: `인스타그램 슬라이드 ${idx + 1}`,
      }))

      const igStructuredPayload = {
        channel: 'instagram' as const,
        caption: igCaption,
        hashtags,
        slides: igSlides,
        cta: payload?.cta || '프로필 링크에서 예약하기',
      }

      const igVerRes = await createVersion(userClient, {
        workspaceId,
        contentId: igContentId,
        caption: igCaption,
        hashtags,
        disclosure: DEFAULT_AI_DISCLOSURE,
        mediaIds: mediaIds.slice(0, 5),
        knowledgeIds: [],
        harnessRuleIds: [],
        revisionReason: `cross_post:naver:${naverVersionId}`,
        rightsConfirmed: true,
        generationEvidenceConfirmed: true,
        structuredPayload: igStructuredPayload,
      })

      if (igVerRes.data) {
        result.instagram = {
          contentId: igContentId,
          versionId: igVerRes.data.versionId,
        }
      }
    }
  }

  // 3. Generate Threads Post
  if (channels.includes('threads')) {
    const threadsCaption = buildThreadsCaption(title, sections)
    const threadsHashtags = hashtags.slice(0, 3)
    const threadsItemRes = await createItem(userClient, {
      workspaceId,
      title: `[스레드] ${title}`,
      channel: 'threads',
    })

    if (threadsItemRes.data) {
      const threadsContentId = threadsItemRes.data.contentId
      const singleMediaId = mediaIds[0] || null

      const threadsStructuredPayload = {
        channel: 'threads' as const,
        caption: threadsCaption,
        hashtags: threadsHashtags,
        mediaId: singleMediaId,
      }

      const threadsVerRes = await createVersion(userClient, {
        workspaceId,
        contentId: threadsContentId,
        caption: threadsCaption,
        hashtags: threadsHashtags,
        disclosure: DEFAULT_AI_DISCLOSURE,
        mediaIds: singleMediaId ? [singleMediaId] : [],
        knowledgeIds: [],
        harnessRuleIds: [],
        revisionReason: `cross_post:naver:${naverVersionId}`,
        rightsConfirmed: true,
        generationEvidenceConfirmed: true,
        structuredPayload: threadsStructuredPayload,
      })

      if (threadsVerRes.data) {
        result.threads = {
          contentId: threadsContentId,
          versionId: threadsVerRes.data.versionId,
        }
      }
    }
  }

  return result
}
