'use server'

import { Buffer } from 'node:buffer'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { MetaProviderError } from '@/lib/providers/meta-api'
import { authorizeManager } from '@/features/image-style/server/manager-auth'
import { storePrivateImage } from '@/features/image-style/server/store-private-image'
import { usedInLastDay, recordUsage } from '@/features/image-style/server/daily-quota'
import { analyzeReferenceImages, validateReferenceFiles, type ReferenceAnalysis } from '@/features/image-style/reference-style-analysis'
import { computeCaptionStats } from '../caption-stats'
import { fetchInstagramCorpus, fetchThreadsOwnCorpus } from '../corpus-fetchers'
import { downloadProfileImage, pickRepresentativeImageUrls } from '../image-download'
import { parseProfileLink } from '../parse-profile-link'
import { loadConnectedIdentity } from '../server/identity'
import { analyzeTextStyle, writeSamplePost } from '../text-style-analysis'
import type { CaptionStats, ProfileCorpus, TextStyleDraft } from '../types'
import { sanitizeSecretLeakage } from '../sanitize-secret'

const requestId = 'profile-import'
const DAILY_LIMIT = 6
const uuid = z.string().uuid()

function failure<T>(message: string): ActionResult<T> {
  return { error: { message: sanitizeSecretLeakage(message), requestId } }
}

function friendly(error: unknown): string {
  const code = error instanceof Error ? error.message : ''
  if (code === 'NOT_OWN_ACCOUNT') return '현재 연결된 사장님의 계정 링크만 가져올 수 있어요'
  if (code === 'INSTAGRAM_NOT_CONNECTED') return '인스타그램 계정을 먼저 연결해 주세요. 현재 연결한 내 계정 분석을 지원해요.'
  if (code === 'THREADS_NOT_CONNECTED') return '스레드 계정을 먼저 연결해 주세요.'
  if (error instanceof MetaProviderError) {
    if (error.message.includes('TOKEN_EXPIRED') || error.code === 'TOKEN_EXPIRED') return '채널 연결이 만료됐어요. 채널을 다시 연결해 주세요.'
    if (error.code === 'RATE_LIMITED') return '인스타그램 요청이 많아요. 잠시 후 다시 시도해 주세요.'
    if (error.code === 'PROVIDER_REJECTED' && error.message) return sanitizeSecretLeakage(error.message)
  }
  return '계정을 가져오지 못했어요. 링크를 확인하고 잠시 후 다시 시도해 주세요.'
}

async function collectCorpus(workspaceId: string, url: string): Promise<ProfileCorpus> {
  const link = parseProfileLink(url)
  if (!link) throw new Error('INVALID_LINK')
  const identity = await loadConnectedIdentity(workspaceId, link.platform)
  const isOwnAccount = identity.ownHandle !== null && link.handle.toLowerCase() === identity.ownHandle.toLowerCase()
  if (!isOwnAccount) {
    throw new Error('NOT_OWN_ACCOUNT')
  }
  return link.platform === 'instagram'
    ? fetchInstagramCorpus({ accountId: identity.accountId, accessToken: identity.accessToken, ownHandle: identity.ownHandle, targetHandle: link.handle })
    : fetchThreadsOwnCorpus({ accessToken: identity.accessToken, ownHandle: identity.ownHandle, targetHandle: link.handle })
}

const inputSchema = z.object({ workspaceId: uuid, url: z.string().trim().min(1).max(300) }).strict()

export type ProfileTextStyleResult = Readonly<{
  handle: string
  platform: 'instagram' | 'threads'
  postCount: number
  stats: CaptionStats
  draft: TextStyleDraft
  sample: string
}>

export async function fetchProfileTextStyleAction(input: unknown): Promise<ActionResult<ProfileTextStyleResult>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return failure('계정 링크를 확인해 주세요.')
  if (!parseProfileLink(parsed.data.url)) return failure('인스타그램·스레드 계정 링크(또는 @아이디)만 넣을 수 있어요. 게시물 링크는 계정 링크로 바꿔 주세요.')
  try {
    const auth = await authorizeManager(parsed.data.workspaceId)
    if ('message' in auth) return failure(auth.message)
    if (await usedInLastDay(parsed.data.workspaceId, 'profile_import_text') >= DAILY_LIMIT) {
      return failure('오늘 계정 분석을 모두 썼어요. 내일 다시 시도해 주세요.')
    }
    const corpus = await collectCorpus(parsed.data.workspaceId, parsed.data.url)
    if (!corpus.isOwnAccount) {
      return failure('현재 연결된 사장님의 계정 링크만 가져올 수 있어요')
    }
    const captions = corpus.posts.map((post) => post.caption).filter((caption) => caption.trim().length > 0)
    if (captions.length === 0) return failure('분석할 글이 없어요. 게시물에 글이 있는 공개 계정인지 확인해 주세요.')
    const stats = computeCaptionStats(captions)
    const draft = await analyzeTextStyle({ handle: corpus.handle, biography: corpus.biography, captions, stats })
    const { data: profile } = await createAdminSupabaseClient()
      .from('business_profiles').select('business_name').eq('workspace_id', parsed.data.workspaceId).maybeSingle()
    const sample = await writeSamplePost({
      styleGuide: draft.styleGuide,
      voiceSummary: draft.voiceSummary,
      businessName: typeof profile?.business_name === 'string' ? profile.business_name : null,
      topic: '이번 주에 소개하고 싶은 대표 서비스 한 가지',
    }).catch(() => '')
    await recordUsage(parsed.data.workspaceId, auth.userId, 'profile_import_text', 'profile_import')
    return { data: { handle: corpus.handle, platform: corpus.platform, postCount: captions.length, stats, draft, sample } }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('TEXT_STYLE_')) {
      return failure('글 분석 결과를 만들지 못했어요. 잠시 후 다시 시도해 주세요.')
    }
    return failure(friendly(error))
  }
}

export type ProfileImagesResult = Readonly<{
  form: ReferenceAnalysis
  references: ReadonlyArray<{ id: string; url: string; note: string }>
  pickedCount: number
}>

export async function importProfileImagesAction(input: unknown): Promise<ActionResult<ProfileImagesResult>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return failure('계정 링크를 확인해 주세요.')
  if (!parseProfileLink(parsed.data.url)) return failure('인스타그램·스레드 계정 링크(또는 @아이디)만 넣을 수 있어요.')
  try {
    const auth = await authorizeManager(parsed.data.workspaceId)
    if ('message' in auth) return failure(auth.message)
    if (await usedInLastDay(parsed.data.workspaceId, 'profile_import_images') >= DAILY_LIMIT) {
      return failure('오늘 사진 분석을 모두 썼어요. 내일 다시 시도해 주세요.')
    }
    const corpus = await collectCorpus(parsed.data.workspaceId, parsed.data.url)
    if (!corpus.isOwnAccount) {
      return failure('현재 연결된 사장님의 계정 링크만 가져올 수 있어요')
    }
    const urls = pickRepresentativeImageUrls(corpus.posts, 8)
    if (urls.length === 0) return failure('분석할 사진이 없어요. 사진이 있는 공개 계정인지 확인해 주세요.')
    const downloaded = (await Promise.all(urls.map((url) => downloadProfileImage(url)))).filter((file): file is File => file !== null)
    const valid = validateReferenceFiles(downloaded)
    if (downloaded.length === 0 || !valid.ok) return failure('사진을 내려받지 못했어요. 잠시 후 다시 시도해 주세요.')
    const images = await Promise.all(downloaded.map(async (file) => ({
      mimeType: file.type,
      base64: Buffer.from(await file.arrayBuffer()).toString('base64'),
    })))
    const form = await analyzeReferenceImages(images)
    const references: Array<{ id: string; url: string; note: string }> = []
    for (const [index, file] of downloaded.entries()) {
      const assetId = await storePrivateImage(parsed.data.workspaceId, auth, file)
      if (assetId) references.push({ id: assetId, url: `/api/workspaces/${parsed.data.workspaceId}/media/${assetId}`, note: form.notes[index] ?? '' })
    }
    await recordUsage(parsed.data.workspaceId, auth.userId, 'profile_import_images', 'profile_import')
    return { data: { form, references, pickedCount: downloaded.length } }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('REFERENCE_ANALYSIS_')) {
      return failure('사진의 느낌을 읽지 못했어요. 잠시 후 다시 시도해 주세요.')
    }
    return failure(friendly(error))
  }
}

const applySchema = z.object({
  workspaceId: uuid,
  voiceSummary: z.string().trim().max(200),
  styleGuide: z.string().trim().max(1_200),
  keywords: z.array(z.string().max(100)).max(60),
  prohibitedTerms: z.array(z.string().max(100)).max(60),
}).strict()

function cleanList(values: readonly string[], max: number): string[] {
  return [...new Set(values.map((value) => value.trim().slice(0, 100)).filter((value) => value.length > 0))].slice(0, max)
}

export async function applyProfileTextStyleAction(input: unknown): Promise<ActionResult<{ applied: true }>> {
  const parsed = applySchema.safeParse(input)
  if (!parsed.success) return failure('입력 길이를 확인해 주세요. 요약 200자, 지시문 1,200자까지 저장할 수 있어요.')
  const voiceSummary = parsed.data.voiceSummary
  const styleGuide = parsed.data.styleGuide
  if (!voiceSummary || !styleGuide) return failure('글 쓰는 방식 요약과 지시문을 모두 적어 주세요.')
  const keywords = cleanList(parsed.data.keywords, 30)
  const prohibited = cleanList(parsed.data.prohibitedTerms, 30)

  try {
    const auth = await authorizeManager(parsed.data.workspaceId)
    if ('message' in auth) return failure(auth.message)
    const admin = createAdminSupabaseClient()
    const voice = `${voiceSummary}\n\n[글 구조·말투 지시]\n${styleGuide}`.slice(0, 1_900)
    const values = { voice, keywords, prohibited_terms: prohibited }
    const updated = await admin.from('brand_profiles').update(values).eq('workspace_id', parsed.data.workspaceId).select('workspace_id').maybeSingle()
    if (updated.error) return failure('저장하지 못했어요. 잠시 후 다시 시도해 주세요.')
    if (!updated.data) {
      const inserted = await admin.from('brand_profiles').insert({ workspace_id: parsed.data.workspaceId, ...values })
      if (inserted.error) return failure('저장하지 못했어요. 잠시 후 다시 시도해 주세요.')
    }
    const rule = await admin.rpc('activate_harness_rule_version', {
      p_workspace_id: parsed.data.workspaceId,
      p_rule_key: 'text-harness-v1',
      p_rule_type: 'text_generation',
      p_title: '링크에서 만든 글 쓰는 방식',
      p_description: voiceSummary,
      p_structured_rule: {
        brandVoice: voiceSummary,
        toneAndManner: styleGuide,
        targetAudience: '',
        keyPhrases: keywords,
        prohibitedWords: prohibited,
        positiveExamples: [],
        negativeExamples: [],
        source: 'PROFILE_IMPORT',
      } as never,
      p_applies_to_channels: ['instagram', 'threads', 'naver_blog'],
      p_created_by_user_id: auth.userId,
      p_approved_by_user_id: auth.userId,
      p_source_knowledge_fact_ids: [],
    }).single()
    if (rule.error) return failure('글 쓰는 기준은 저장했지만 하네스 등록에 실패했어요. 잠시 후 다시 적용해 주세요.')
    revalidatePath('/app/settings/brand')
    revalidatePath('/app/settings/image-style')
    return { data: { applied: true } }
  } catch {
    return failure('저장하지 못했어요. 잠시 후 다시 시도해 주세요.')
  }
}
