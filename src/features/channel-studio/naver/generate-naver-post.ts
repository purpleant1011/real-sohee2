import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { uploadValidatedPrivateFile } from '@/lib/supabase/validated-upload'
import { createValidatedUploadRepository } from '@/lib/supabase/validated-upload-repository'
import { DEFAULT_AI_DISCLOSURE } from '@/features/publishing/meta-content-text'
import { loadNaverGenerationContext } from '@/features/chat/naver-generation-context.server'
import {
  createProductionNaverBlogDraftProvider,
  type NaverBlogDraft,
  type NaverPostMode,
  naverPostModeSchema,
} from '@/features/chat/naver-blog-draft-provider'
import {
  POST_REACTION_IDS,
  POST_IMAGE_STYLE_IDS,
  type PostReactionId,
  type PostImageStyleId,
  getPostFormat,
} from './post-modules'
import { createNaverBlogImagePrompts } from '@/features/chat/naver-blog-image-brief'
import { createProductionConversationImageArtifact } from '@/features/chat/conversation-image-generation.server'
import type { ConversationImageGenerationInput } from '@/features/chat/conversation-image-generation'
import type { ConversationImageCount } from '@/features/chat/conversation-image-intent'
import { materializeNaverEditorBlocks } from '@/features/content/naver-editor-blocks'
import {
  createContentItemWithClient,
  type CreatedItem,
} from '@/features/content/actions/create-item'
import {
  createVersionWithClient,
  type CreatedVersionWithFingerprint,
} from '@/features/content/actions/create-version'
import { createStudioCredits, type StudioCredits } from '@/features/channel-studio/studio-credits'
import type { QuickPostReservation } from '@/features/quick-start/quick-post-credits'
import type { NaverCategory, NaverVisibility } from '@/features/naver-publish/types'
import { getSyncedNaverCategories } from '@/features/naver-publish/synced-categories.server'
import type { InstagramGenerationContext } from '@/features/auth/workspace-context'
import type { ActionResult } from '@/lib/errors/result'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { selfHealBlogDraft } from '@/features/channel-studio/claim-sanitizer'
import type { ClaimChecker } from '@/features/channel-studio/ports'
import { loadApprovedFactSnapshot, type ApprovedFactSnapshot } from '@/features/knowledge/approved-fact-resolver'
import { checkApprovedNaverDraft } from './approved-draft-qa'
import type { GroundedBusinessContext, GroundedFact } from '@/features/channel-studio/types'
import { blogStrategyBriefSchema, ensureFocusKeyword, findExcludedClaimViolations, type BlogStrategyBrief } from '@/features/content/blog-strategy-brief'

/**
 * Derives a deterministic RFC 4122 v4 UUID from an arbitrary input string.
 * Used to derive stable reservation mission IDs: `${requestKey}:text` and `${requestKey}:image:${i}`.
 */
export function deterministicUuid(input: string): string {
  const hex = createHash('sha256').update(input, 'utf8').digest('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    '4' + hex.slice(13, 16),
    ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0') + hex.slice(18, 20),
    hex.slice(20, 32),
  ].join('-')
}

/**
 * Normalizes keywords to valid hashtags, stripping leading '#' and whitespace.
 * Discards empty or purely punctuation tokens before media/version persistence.
 */
export function normalizeHashtags(keywords: readonly string[]): string[] {
  return keywords
    .map((k) => k.replace(/^#+/u, '').replace(/[\s#]+/gu, '').trim())
    .filter((k) => k.length > 0)
    .map((k) => `#${k}`)
}

/**
 * 네이버 스마트블록 및 로컬 검색 상위노출 알고리즘에 최적화된 10개 연관 태그 생성
 */
export function enrichLocalSeoKeywords(
  baseKeywords: readonly string[],
  context: { businessName?: string; industry?: string; location?: string },
): string[] {
  const result: string[] = []
  const seen = new Set<string>()

  const add = (tag: string | null | undefined) => {
    if (!tag) return
    const cleaned = tag.replace(/^#+/gu, '').replace(/[\s#]+/gu, '').trim()
    if (cleaned && !seen.has(cleaned) && cleaned.length >= 2) {
      seen.add(cleaned)
      result.push(cleaned)
    }
  }

  // 1. 기존 AI 생성 키워드 추가
  for (const kw of baseKeywords) {
    add(kw)
  }

  // 2. 지역명 및 업종 정제
  const rawLoc = (context.location || '').split(/\s+/)[0]?.trim() || ''
  const loc = rawLoc.replace(/(시|도|구|군|동|읍|면)$/u, '') || rawLoc
  const ind = (context.industry || '').trim()
  const name = (context.businessName || '').trim()

  const candidates = [
    loc && ind ? `${loc}${ind}` : null,
    loc && name ? `${loc}${name}` : null,
    name || null,
    ind || null,
    loc || null,
  ]

  for (const c of candidates) {
    if (result.length >= 10) break
    add(c)
  }

  return result.slice(0, 10)
}

/** 모델에게 다시 쓸 때 알려 줄 문제 목록(최대 5개, 각 120자). 원고 본문은 포함하지 않는다. */
function describeClaimIssues(issues: readonly string[] | undefined): string {
  const list = (issues ?? []).map((issue) => String(issue).trim().slice(0, 120)).filter(Boolean).slice(0, 5)
  return list.length > 0 ? ` 지적된 문제: ${list.join('; ')}.` : ''
}

function logClaimIssues(stage: string, issues: readonly string[] | undefined): void {
  console.error('[naver-posts] claim check flagged', { stage, issues: (issues ?? []).slice(0, 5).map((issue) => String(issue).slice(0, 120)) })
}


/** 초안 실패의 원인을 운영 로그에 남긴다(비밀값·원고 본문 제외, 오류 이름/상태/앞부분 메시지만). */
function logDraftFailure(cause: unknown): void {
  const error = cause as { name?: string; status?: number; code?: string; message?: string } | null
  console.error('[naver-posts] draft generation failed', {
    name: error?.name ?? typeof cause,
    status: error?.status,
    code: error?.code,
    message: String(error?.message ?? '').replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 240),
  })
}

export class NaverPostGenerationError extends Error {
  constructor(
    readonly code:
      | 'INVALID_INPUT'
      | 'CATEGORY_INVALID'
      | 'AUTH_REQUIRED'
      | 'CREDIT_INSUFFICIENT'
      | 'IN_PROGRESS'
      | 'CLAIMS_NEED_REVIEW'
      | 'CREDIT_FAILED'
      | 'CONTEXT_UNAVAILABLE'
      | 'DRAFT_FAILED'
      | 'IMAGES_INCOMPLETE'
      | 'NO_PLACE_PHOTOS'
      | 'SAVE_FAILED',
    message: string,
    readonly status = 500,
  ) {
    super(message)
    this.name = 'NaverPostGenerationError'
  }
}

export type JobClaimResult =
  | { kind: 'acquired'; jobId: string }
  | { kind: 'running'; jobId: string }
  | { kind: 'succeeded'; jobId: string; contentId: string; versionId: string }

export interface NaverPostJobStore {
  claim(workspaceId: string, requestKey: string, userId: string): Promise<JobClaimResult>
  complete(
    workspaceId: string,
    requestKey: string,
    contentId: string,
    versionId: string,
    creditReconcileNeeded?: boolean,
  ): Promise<void>
  fail(workspaceId: string, requestKey: string, creditReconcileNeeded?: boolean): Promise<void>
}

export function createSupabaseNaverPostJobStore(admin: SupabaseClient<Database>): NaverPostJobStore {
  return {
    async claim(workspaceId, requestKey, userId) {
      const { data, error } = await (admin.rpc as any)('claim_naver_post_job', {
        p_workspace_id: workspaceId,
        p_request_key: requestKey,
        p_user_id: userId,
      })
      if (!error && data) {
        return data as JobClaimResult
      }

      // Fallback: direct table operations if RPC not found in runtime
      const { data: row, error: selectErr } = await (admin as any)
        .from('naver_post_jobs')
        .select('id, status, content_id, version_id')
        .eq('workspace_id', workspaceId)
        .eq('request_key', requestKey)
        .maybeSingle()

      if (!selectErr && row) {
        if (row.status === 'running') return { kind: 'running', jobId: row.id }
        if (row.status === 'succeeded' && row.content_id && row.version_id) {
          return { kind: 'succeeded', jobId: row.id, contentId: row.content_id, versionId: row.version_id }
        }
        if (row.status === 'failed' && !row.content_id && !row.version_id) {
          await (admin as any)
            .from('naver_post_jobs')
            .update({ status: 'running', user_id: userId, updated_at: new Date().toISOString() })
            .eq('id', row.id)
          return { kind: 'acquired', jobId: row.id }
        }
      }

      const { data: inserted, error: insertErr } = await (admin as any)
        .from('naver_post_jobs')
        .insert({
          workspace_id: workspaceId,
          request_key: requestKey,
          user_id: userId,
          status: 'running',
        })
        .select('id')
        .single()

      if (insertErr || !inserted) {
        return { kind: 'running', jobId: 'unknown' }
      }
      return { kind: 'acquired', jobId: inserted.id }
    },
    async complete(workspaceId, requestKey, contentId, versionId, creditReconcileNeeded = false) {
      const { error } = await (admin.rpc as any)('complete_naver_post_job', {
        p_workspace_id: workspaceId,
        p_request_key: requestKey,
        p_content_id: contentId,
        p_version_id: versionId,
        p_credit_reconcile_needed: creditReconcileNeeded,
      })
      if (error) {
        await (admin as any)
          .from('naver_post_jobs')
          .update({
            status: 'succeeded',
            content_id: contentId,
            version_id: versionId,
            credit_reconcile_needed: creditReconcileNeeded,
            updated_at: new Date().toISOString(),
          })
          .eq('workspace_id', workspaceId)
          .eq('request_key', requestKey)
      }
    },
    async fail(workspaceId, requestKey, creditReconcileNeeded = false) {
      const { error } = await (admin.rpc as any)('fail_naver_post_job', {
        p_workspace_id: workspaceId,
        p_request_key: requestKey,
        p_credit_reconcile_needed: creditReconcileNeeded,
      })
      if (error) {
        await (admin as any)
          .from('naver_post_jobs')
          .update({
            status: 'failed',
            credit_reconcile_needed: creditReconcileNeeded,
            updated_at: new Date().toISOString(),
          })
          .eq('workspace_id', workspaceId)
          .eq('request_key', requestKey)
      }
    },
  }
}

export type GenerateNaverBlogPostInput = Readonly<{
  workspaceId: string
  userId: string
  topic: string
  imageCount?: number // 형식별 범위 (getPostFormat 참조)
  photoSource?: 'place' | 'ai' // default 'place' (place: 0 SC free photo reuse, ai: 150 SC per image)
  requestKey: string
  categoryId?: string | null
  visibility?: NaverVisibility // default 'public'
  scheduledAt?: string | null
  blogStrategyBrief?: BlogStrategyBrief
  postMode?: NaverPostMode
  reaction?: PostReactionId
  imageStyle?: PostImageStyleId
  signal?: AbortSignal
  deps?: GenerateNaverBlogPostDependencies
}>

export type GeneratedNaverBlogPostResult = Readonly<{
  contentId: string
  versionId: string
  versionNumber: number
  fingerprint: string
  title: string
  imageCount: number
}>

export interface NaverStageFact {
  stage: 'draft_writing' | 'image_generation'
  status: 'started' | 'verified' | 'failed' | 'partial'
  sourceId: 'business_facts'
  sampleSize?: number
  coverage?: { covered: number; total: number }
  dedupeKey: string
}

export interface GenerateNaverBlogPostDependencies {
  findExisting?(workspaceId: string, requestKey: string): Promise<GeneratedNaverBlogPostResult | null>
  loadContext?(workspaceId: string): Promise<InstagramGenerationContext>
  loadGroundedContext?(workspaceId: string): Promise<GroundedBusinessContext>
  loadApprovedFacts?(workspaceId: string): Promise<ApprovedFactSnapshot>
  loadPlacePhotos?(workspaceId: string): Promise<readonly string[]>
  checkClaims?: ClaimChecker
  generateDraft?(input: {
    prompt: string
    context: InstagramGenerationContext
    imageCount: ConversationImageCount
    approvedFacts?: readonly Readonly<{ category: string; content: string }>[]
    blogStrategyBrief?: BlogStrategyBrief
    postMode?: NaverPostMode
    reaction?: PostReactionId
    imageStyle?: PostImageStyleId
    signal?: AbortSignal
  }): Promise<NaverBlogDraft>
  /** Best-effort server-side record of a real stage outcome. Never alters generation. */
  recordStage?(fact: NaverStageFact): Promise<void>
  generateImage?(input: ConversationImageGenerationInput): Promise<{ id: string; title: string }>
  storePlacePhoto?(input: {
    workspaceId: string
    userId: string
    imageUrl: string
    title: string
    altText?: string
  }): Promise<{ id: string; title: string }>
  createItem?(client: any, input: unknown): Promise<ActionResult<CreatedItem>>
  createVersion?(client: any, input: unknown): Promise<ActionResult<CreatedVersionWithFingerprint>>
  credits?: StudioCredits
  jobStore?: NaverPostJobStore
  getSyncedCategories?: (workspaceId: string, client?: any) => Promise<NaverCategory[]>
  admin?: SupabaseClient<Database>
  userClient?: SupabaseClient<Database>
  now?: () => number
}

async function defaultLoadPlacePhotos(
  admin: SupabaseClient<Database> | null | undefined,
  workspaceId: string,
): Promise<readonly string[]> {
  if (!admin || typeof (admin as any).from !== 'function') return []
  try {
    const { data: placeSource } = await (admin as any)
      .from('knowledge_sources')
      .select('refresh_policy')
      .eq('workspace_id', workspaceId)
      .eq('channel_type', 'naver_place')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const images = placeSource?.refresh_policy?.placeSummary?.images
    return Array.isArray(images) ? (images as string[]) : []
  } catch {
    return []
  }
}

async function defaultStorePlacePhoto(
  admin: SupabaseClient<Database> | null | undefined,
  input: {
    workspaceId: string
    userId: string
    imageUrl: string
    title: string
    altText?: string
  },
): Promise<{ id: string; title: string }> {
  if (!admin || typeof (admin as any).from !== 'function') {
    throw new Error('Supabase client unavailable for place photo store')
  }

  const assetId = randomUUID()
  const res = await fetch(input.imageUrl)
  if (!res.ok) {
    throw new Error(`Failed to fetch place image from ${input.imageUrl}: ${res.statusText}`)
  }
  const contentType = res.headers.get('content-type') || 'image/jpeg'
  const arrayBuf = await res.arrayBuffer()
  const file = new File([arrayBuf], `place-photo-${assetId.slice(0, 8)}.jpg`, { type: contentType })

  let role: 'owner' | 'manager' = 'owner'
  try {
    const { data: member } = await (admin as any)
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', input.workspaceId)
      .eq('user_id', input.userId)
      .maybeSingle()
    if (member?.role === 'manager') role = 'manager'
  } catch {
    // fallback role
  }

  const uploaded = await uploadValidatedPrivateFile(
    {
      workspaceId: input.workspaceId,
      userId: input.userId,
      resourceId: assetId,
      bucket: 'content-media',
      role,
      file,
    },
    createValidatedUploadRepository(admin),
  )

  if (!uploaded.ok) {
    throw new Error('PLACE_PHOTO_STORE_FAILED')
  }

  await (admin as any)
    .from('media_assets')
    .update({ rights_status: 'confirmed' })
    .eq('workspace_id', input.workspaceId)
    .eq('id', assetId)

  return { id: assetId, title: input.title }
}

const inputSchema = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().min(1),
  topic: z.string().trim().min(1).max(300),
  imageCount: z.number().int().optional(),
  photoSource: z.enum(['place', 'ai']).default('ai'),
  requestKey: z.string().uuid(),
  categoryId: z.string().trim().min(1).nullable().optional(),
  // F5: All 4 visibility options ('public' | 'neighbor' | 'mutual_neighbor' | 'private') are supported by the service and schema,
  // backed by the 4-way trigger migration (20261009090500_naver_four_visibility.sql).
  visibility: z.enum(['public', 'neighbor', 'mutual_neighbor', 'private']).default('public'),
  scheduledAt: z.string().trim().nullable().optional(),
  blogStrategyBrief: blogStrategyBriefSchema.optional(),
  postMode: naverPostModeSchema.optional(),
  reaction: z.enum(POST_REACTION_IDS).optional(),
  imageStyle: z.enum(POST_IMAGE_STYLE_IDS).optional(),
}).transform((data) => {
  const format = getPostFormat(data.postMode ?? 'information')
  const imageCount = data.imageCount ?? format?.imageDefault ?? 4
  return { ...data, imageCount }
}).superRefine((data, ctx) => {
  const format = getPostFormat(data.postMode ?? 'information')
  const min = format ? format.imageMin : 1
  const max = format ? format.imageMax : 20
  if (data.imageCount < min || data.imageCount > max) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${format?.label ?? '해당'} 글 형식에서는 이미지를 ${min}장부터 ${max}장까지 넣을 수 있습니다.`,
      path: ['imageCount'],
    })
  }
})

async function defaultFindExisting(
  client: SupabaseClient<Database>,
  workspaceId: string,
  requestKey: string,
): Promise<GeneratedNaverBlogPostResult | null> {
  const { data, error } = await client
    .from('content_versions')
    .select('id, content_id, version_number, fingerprint, revision_reason, structured_payload, content_items!content_versions_workspace_content_fkey!inner(title, channel)')
    .eq('workspace_id', workspaceId)
    .eq('content_items.channel', 'naver_blog')
    .eq('revision_reason', `naver_post:${requestKey}`)
    .maybeSingle()

  if (error || !data) return null

  const payload = data.structured_payload as Record<string, unknown> | null
  const placements = Array.isArray(payload?.imagePlacements) ? payload.imagePlacements : []

  return {
    contentId: data.content_id,
    versionId: data.id,
    versionNumber: data.version_number,
    fingerprint: data.fingerprint,
    title: ((data.content_items as any)?.title as string) || (payload?.title as string) || '',
    imageCount: placements.length,
  }
}

/**
 * Reservation Reconciliation & Leak Scenario Documentation (F4):
 *
 * 1. Process termination / network partition during generation:
 *    - Scenario: Server process is killed (OOM, deployment) right after reserveQuickPostCredits completes,
 *      before generateImage or rollbackUnsettled can execute.
 *    - State: Row remains in quick_post_credit_reservations with state = 'reserved' and deducted balance.
 *    - Reconciliation: naver_post_jobs retains status = 'running'. A scheduled FinOps background worker sweeps
 *      jobs that have been 'running' without updates for > 15 minutes. If no corresponding content_version exists,
 *      the worker calls release_quick_post_credits for the derived deterministic keys.
 *
 * 2. Release RPC failure during error rollback:
 *    - Scenario: Generation failed or was aborted by client; service caught the failure and called release,
 *      but release_quick_post_credits returned a transient error (e.g. 503).
 *    - State: Reservation remains 'reserved'; job is marked status = 'failed' with credit_reconcile_needed = true.
 *    - Reconciliation: FinOps background worker queries `naver_post_jobs WHERE credit_reconcile_needed = true`
 *      and executes release_quick_post_credits idempotently.
 *
 * 3. Text credit settlement failure after version save:
 *    - Scenario: content_items and content_versions were successfully inserted, but settle_quick_post_credits timed out.
 *    - State: Version is saved and returned to user. Job status = 'succeeded' with credit_reconcile_needed = true.
 *      Credits must NEVER be refunded for a version that was saved.
 *    - Reconciliation: Worker detects `naver_post_jobs` status = 'succeeded' and credit_reconcile_needed = true,
 *      and re-runs settle_quick_post_credits idempotently.
 */

export async function generateNaverBlogPost(
  input: GenerateNaverBlogPostInput,
): Promise<GeneratedNaverBlogPostResult> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) {
    throw new NaverPostGenerationError('INVALID_INPUT', '입력 내용을 확인해 주세요.', 400)
  }

  const { workspaceId, userId, topic, imageCount, photoSource, requestKey, categoryId, visibility, scheduledAt, blogStrategyBrief, postMode, reaction, imageStyle } =
    parsed.data

  if (blogStrategyBrief && blogStrategyBrief.workspaceId !== workspaceId) {
    throw new NaverPostGenerationError('INVALID_INPUT', '전략 브리프의 작업공간이 일치하지 않습니다.', 400)
  }
  const signal = input.signal
  const deps = input.deps ?? {}
  const now = deps.now ?? Date.now
  const startTime = now()
  let openStage: NaverStageFact['stage'] | null = null
  let storedImages = 0
  const recordStage = async (fact: Omit<NaverStageFact, 'sourceId'>): Promise<void> => {
    try { await deps.recordStage?.({ ...fact, sourceId: 'business_facts' }) } catch { /* progress records never break generation */ }
  }

  // F8: The userClient MUST be provided. Never fall back to adminClient for user-scoped operations.
  // Check auth client BEFORE any paid work or credit reservation.
  const userClient = deps.userClient
  if (!userClient) {
    throw new NaverPostGenerationError('AUTH_REQUIRED', '로그인 세션을 확인하지 못했습니다.', 401)
  }

  // Check category validity against synced categories BEFORE any paid work or claiming
  if (categoryId) {
    const getCategories = deps.getSyncedCategories ?? getSyncedNaverCategories
    const synced = await getCategories(workspaceId, userClient)
    if (synced.length > 0 && !synced.some((c) => c.id === categoryId)) {
      throw new NaverPostGenerationError(
        'CATEGORY_INVALID',
        '선택한 카테고리를 찾을 수 없어요. 카테고리 목록을 새로 불러와 주세요.',
        400,
      )
    }
  }

  const adminClient = deps.admin ?? createAdminSupabaseClient()

  // F3: Different requestKeys for the same topic are separate jobs; only identical (workspaceId, requestKey) pairs are deduplicated.
  const jobStore = deps.jobStore ?? createSupabaseNaverPostJobStore(adminClient)

  // 1. Concurrency & Idempotency claim (F3)
  const claim = await jobStore.claim(workspaceId, requestKey, userId)
  if (claim.kind === 'running') {
    throw new NaverPostGenerationError('IN_PROGRESS', '이미 글을 만들고 있어요. 잠시만 기다려 주세요.', 409)
  }
  if (claim.kind === 'succeeded') {
    const findExisting = deps.findExisting
      ? deps.findExisting
      : (ws: string, key: string) => defaultFindExisting(adminClient, ws, key)
    const existing = await findExisting(workspaceId, requestKey)
    if (existing) return existing
    return {
      contentId: claim.contentId,
      versionId: claim.versionId,
      versionNumber: 1,
      fingerprint: '',
      title: '',
      imageCount: 0,
    }
  }

  // 2. Credits reservation (F1):
  // Reserve one text reservation (100 SC) plus ONE reservation per image (150 SC each)
  // using distinct deterministic keys derived from requestKey.
  const credits = deps.credits ?? createStudioCredits(adminClient as never)
  let textReservation: QuickPostReservation | null = null
  const imageReservations: QuickPostReservation[] = []
  const settledImageReservations: QuickPostReservation[] = []
  let creditReconcileNeeded = false

  const rollbackUnsettled = async () => {
    const toRelease: QuickPostReservation[] = []
    if (textReservation && textReservation.state === 'reserved') {
      toRelease.push(textReservation)
    }
    for (const imgRes of imageReservations) {
      if (imgRes.state === 'reserved' && !settledImageReservations.includes(imgRes)) {
        toRelease.push(imgRes)
      }
    }
    await Promise.all(
      toRelease.map(async (res) => {
        try {
          await credits.release(workspaceId, res)
        } catch (err) {
          console.warn('[naver-post-credits] credit release failed pending reconciliation', {
            workspaceId,
            requestKey,
            reservationId: res.reservationId,
            err,
          })
          creditReconcileNeeded = true
        }
      }),
    )
  }

  try {
    // Reserve text hold (100 SC)
    try {
      textReservation = await credits.reserve(
        workspaceId,
        deterministicUuid(`${requestKey}:text`),
        'text',
      )
    } catch (cause) {
      if (cause instanceof NaverPostGenerationError) throw cause
      throw new NaverPostGenerationError(
        'CREDIT_INSUFFICIENT',
        (cause as Error)?.message || '크레딧이 부족해서 글을 만들 수 없어요. 크레딧을 충전한 뒤 다시 시도해 주세요.',
        402,
      )
    }

    // Reserve one hold per image (150 SC each) ONLY if photoSource === 'ai'
    if (photoSource === 'ai') {
      for (let i = 0; i < imageCount; i++) {
        try {
          const imgRes = await credits.reserve(
            workspaceId,
            deterministicUuid(`${requestKey}:image:${i}`),
            'image',
          )
          imageReservations.push(imgRes)
        } catch (cause) {
          await rollbackUnsettled()
          if (cause instanceof NaverPostGenerationError) throw cause
          throw new NaverPostGenerationError(
            'CREDIT_INSUFFICIENT',
            (cause as Error)?.message || '크레딧이 부족해서 글을 만들 수 없어요. 크레딧을 충전한 뒤 다시 시도해 주세요.',
            402,
          )
        }
      }
    }

    // 3. Load generation context
    const loadContext = deps.loadContext ?? ((ws: string) => loadNaverGenerationContext(ws, adminClient))
    const context = await loadContext(workspaceId).catch(() => {
      throw new NaverPostGenerationError('CONTEXT_UNAVAILABLE', '작업공간 정보를 불러오지 못했습니다.', 500)
    })

    // Grounded context for claims checking (F7)
    let groundedContext: GroundedBusinessContext
    let placeSummary: any = null
    if (deps.loadGroundedContext) {
      groundedContext = await deps.loadGroundedContext(workspaceId)
    } else {
      const placeFacts: GroundedFact[] = []
      if (adminClient && typeof (adminClient as any).from === 'function') {
        try {
          const { data: placeSource } = await (adminClient as any)
            .from('knowledge_sources')
            .select('refresh_policy')
            .eq('workspace_id', workspaceId)
            .eq('channel_type', 'naver_place')
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          placeSummary = placeSource?.refresh_policy?.placeSummary ?? null
          const summary = placeSummary
          if (summary) {
            if (summary.visitorReviewScore) {
              placeFacts.push({ kind: 'profile', label: '평점', value: `${summary.visitorReviewScore}점` })
              placeFacts.push({ kind: 'profile', label: '네이버 플레이스 평점', value: `${summary.visitorReviewScore}점` })
            }
            if (summary.visitorReviewCount) {
              placeFacts.push({ kind: 'profile', label: '방문자리뷰', value: `${summary.visitorReviewCount}개` })
              placeFacts.push({ kind: 'profile', label: '리뷰', value: `${summary.visitorReviewCount}개` })
            }
            if (summary.businessHours) {
              placeFacts.push({ kind: 'policy', label: '영업시간', value: String(summary.businessHours) })
              placeFacts.push({ kind: 'policy', label: '운영시간', value: String(summary.businessHours) })
            }
            if (summary.roadAddress) {
              placeFacts.push({ kind: 'profile', label: '도로명주소', value: String(summary.roadAddress) })
              placeFacts.push({ kind: 'profile', label: '주소', value: String(summary.roadAddress) })
            }
            if (summary.jibunAddress) {
              placeFacts.push({ kind: 'profile', label: '지번주소', value: String(summary.jibunAddress) })
            }
          }
        } catch {
          // Safe fallback if knowledge_sources is unavailable
        }
      }

      groundedContext = {
        businessName: context.businessName ?? '',
        industry: context.industry ?? '',
        location: context.location ?? '',
        facts: [
          ...(context.businessName ? [{ kind: 'profile' as const, label: '상호', value: context.businessName }] : []),
          ...(context.industry ? [{ kind: 'profile' as const, label: '업종', value: context.industry }] : []),
          ...(context.location ? [{ kind: 'profile' as const, label: '지역', value: context.location }] : []),
          ...(context.businessSummary ? [{ kind: 'profile' as const, label: '소개', value: context.businessSummary }] : []),
          ...placeFacts,
        ],
        tone: { presetKey: null, brandVoice: context.brandVoice ?? '' },
        knowledgeVersion: 1,
        warnings: [],
      }
    }

    const approvedFacts = await (deps.loadApprovedFacts
      ? deps.loadApprovedFacts(workspaceId)
      : loadApprovedFactSnapshot(adminClient as unknown as Parameters<typeof loadApprovedFactSnapshot>[0], workspaceId)).catch(() => {
      throw new NaverPostGenerationError('CONTEXT_UNAVAILABLE', '승인된 매장 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', 503)
    })

    if (approvedFacts.workspaceId !== workspaceId || approvedFacts.facts.some((fact) => fact.workspace_id !== workspaceId)) {
      throw new NaverPostGenerationError('CONTEXT_UNAVAILABLE', '승인된 매장 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', 503)
    }
    const writingFacts = approvedFacts.facts.map(({ category, content }) => ({ category, content }))

    // 4. Generate draft
    const generateDraft =
      deps.generateDraft ??
      (async ({ prompt, context: ctx, imageCount: count, approvedFacts: facts, blogStrategyBrief: strategy, postMode: mode, reaction: rx, imageStyle: style, signal: sig }) => {
        const provider = createProductionNaverBlogDraftProvider()
        return provider.generate({
          prompt,
          context: ctx,
          imageCount: count,
          approvedFacts: facts,
          blogStrategyBrief: strategy,
          postMode: mode,
          reaction: rx,
          imageStyle: style,
          signal: sig,
        })
      })

    openStage = 'draft_writing'
    await recordStage({ stage: 'draft_writing', status: 'started', dedupeKey: 'draft:started' })
    let draft = await generateDraft({
      prompt: topic,
      context,
      imageCount: imageCount as ConversationImageCount,
      approvedFacts: writingFacts,
      ...(blogStrategyBrief ? { blogStrategyBrief } : {}),
      ...(postMode ? { postMode } : {}),
      ...(reaction ? { reaction } : {}),
      ...(imageStyle ? { imageStyle } : {}),
      signal,
    }).catch((cause: unknown) => {
      logDraftFailure(cause)
      throw new NaverPostGenerationError('DRAFT_FAILED', '초안 글을 작성하지 못했습니다. 잠시 후 다시 시도해 주세요.', 500)
    })

    // 4.5 Post-generation claim check (F7): apply claim guard BEFORE image generation
    const checkClaims: ClaimChecker = deps.checkClaims ?? ((_channel, payload) => {
      const qa = checkApprovedNaverDraft(workspaceId, { ...payload, scheduledAt: undefined, factBasis: undefined }, approvedFacts)
      return { status: qa.status === 'OK' ? 'OK' : 'UNKNOWN', issues: qa.issues.map(issue => issue.reason) }
    })
    const runClaimCheck = (d: NaverBlogDraft) => {
      const payloadToCheck = {
        title: d.title,
        introduction: d.introduction,
        sections: d.sections.map((s) => ({ heading: s.heading, body: s.body })),
        cta: d.cta,
        editorBlueprint: d.editorBlueprint,
      }
      return checkClaims('naver_blog', payloadToCheck, groundedContext)
    }

    let claimResult = runClaimCheck(draft)
    if (claimResult.status !== 'OK') {
      // Retry draft ONCE if flagged — 무엇이 문제였는지 알려 주어야 같은 실수를 반복하지 않는다.
      logClaimIssues('first_draft', claimResult.issues)
      draft = await generateDraft({
        prompt: `${topic}\n\n[주의: 이전 초안에 확인되지 않은 사실/가격/할인/효능 표현이 포함되어 있습니다. 사실에 기반하여 다시 작성해 주세요.${describeClaimIssues(claimResult.issues)}]`,
        context,
        imageCount: imageCount as ConversationImageCount,
        approvedFacts: writingFacts,
        ...(blogStrategyBrief ? { blogStrategyBrief } : {}),
        ...(postMode ? { postMode } : {}),
        ...(reaction ? { reaction } : {}),
        ...(imageStyle ? { imageStyle } : {}),
        signal,
      }).catch((cause: unknown) => {
        logDraftFailure(cause)
        throw new NaverPostGenerationError('DRAFT_FAILED', '초안 글을 작성하지 못했습니다. 잠시 후 다시 시도해 주세요.', 500)
      })
      claimResult = runClaimCheck(draft)
      if (claimResult.status !== 'OK') {
        draft = selfHealBlogDraft(draft)
        claimResult = runClaimCheck(draft)
        if (claimResult.status !== 'OK') {
          logClaimIssues('retry_draft', claimResult.issues)
          const elapsed = now() - startTime
          if (!signal?.aborted && elapsed < 150_000) {
            draft = await generateDraft({
              prompt: `${topic}\n\n[엄격 모드: 숫자·가격·할인·영업시간·효능/효과/치료/보장·최고/1위·기간/횟수 표현을 일체 쓰지 말고, 사진 설명은 눈에 보이는 장면·분위기·공간 느낌만 쓰며, 확인된 사실 자료에 없는 서비스 과정/절차를 지어내지 말 것.${describeClaimIssues(claimResult.issues)}]`,
              context,
              imageCount: imageCount as ConversationImageCount,
              approvedFacts: writingFacts,
              ...(blogStrategyBrief ? { blogStrategyBrief } : {}),
              ...(postMode ? { postMode } : {}),
              ...(reaction ? { reaction } : {}),
              ...(imageStyle ? { imageStyle } : {}),
              signal,
            }).catch((cause: unknown) => {
              logDraftFailure(cause)
              throw new NaverPostGenerationError('DRAFT_FAILED', '초안 글을 작성하지 못했습니다. 잠시 후 다시 시도해 주세요.', 500)
            })
            claimResult = runClaimCheck(draft)
            if (claimResult.status !== 'OK') {
              draft = selfHealBlogDraft(draft)
              claimResult = runClaimCheck(draft)
              if (claimResult.status !== 'OK') {
                logClaimIssues('strict_draft', claimResult.issues)
                throw new NaverPostGenerationError(
                  'CLAIMS_NEED_REVIEW',
                  '확인되지 않은 내용이 남아 있어요. 가격·영업시간·이벤트처럼 확인이 필요한 내용은 빼고, 주제를 더 구체적으로 적어 다시 만들어 주세요.',
                  422,
                )
              }
            }
          } else {
            throw new NaverPostGenerationError(
              'CLAIMS_NEED_REVIEW',
              '확인되지 않은 내용이 남아 있어요. 가격·영업시간·이벤트처럼 확인이 필요한 내용은 빼고, 주제를 더 구체적으로 적어 다시 만들어 주세요.',
              422,
            )
          }
        }
      }
    }

    const approvedQa = checkApprovedNaverDraft(workspaceId, {
      title: draft.title, introduction: draft.introduction, sections: draft.sections,
      editorBlueprint: draft.editorBlueprint, keywords: draft.keywords, cta: draft.cta, disclosure: draft.disclosure,
    }, approvedFacts)
    if (approvedQa.status !== 'OK') {
      throw new NaverPostGenerationError('CLAIMS_NEED_REVIEW', approvedQa.issues[0].reason, 422)
    }
    openStage = null
    await recordStage({ stage: 'draft_writing', status: 'verified', sampleSize: writingFacts.length, dedupeKey: 'draft:verified' })

    // 5. Generate image prompts (F6: Byreum eyebrow sentence only on Byreum path)
    const isByreum = Boolean(
      context.businessName?.includes('바이름') ||
      context.businessName?.toLowerCase().includes('byreum') ||
      context.industry?.includes('반영구') ||
      context.industry?.includes('눈썹')
    )
    const slidePrompts = createNaverBlogImagePrompts({
      draft,
      count: imageCount as ConversationImageCount,
      userPrompt: topic,
      isByreum,
      imageStyle,
    })

    const slots = (draft.editorBlueprint ?? [])
      .filter((b): b is Extract<typeof b, { kind: 'image_slot' }> => b.kind === 'image_slot')
      .sort((a, b) => a.position - b.position)

    const sections = draft.sections ?? []

    // 6. Generate or reuse images sequentially, aborting between slots on signal (F4) & settling as stored (F1)
    const generatedArtifacts: Array<{ id: string; title: string }> = []
    if (imageCount > 0) {
      openStage = 'image_generation'
      await recordStage({ stage: 'image_generation', status: 'started', dedupeKey: 'image:started' })
    }

    if (photoSource === 'place') {
      const loadPhotos =
        deps.loadPlacePhotos ?? ((wsId: string) => defaultLoadPlacePhotos(adminClient, wsId))
      const placePhotos = await loadPhotos(workspaceId)
      if (!placePhotos || placePhotos.length === 0) {
        throw new NaverPostGenerationError(
          'NO_PLACE_PHOTOS',
          '연동된 네이버 플레이스 매장 사진이 없습니다. AI 사진 생성을 선택해 주세요.',
          400,
        )
      }

      const storePhoto =
        deps.storePlacePhoto ?? ((storeInput) => defaultStorePlacePhoto(adminClient, storeInput))

      for (let index = 0; index < imageCount; index++) {
        if (signal?.aborted) {
          throw new NaverPostGenerationError('IMAGES_INCOMPLETE', '작업이 취소되었습니다.')
        }

        const slot = slots[index]
        const photoUrl = placePhotos[index % placePhotos.length]
        let artifact: { id: string; title: string }
        try {
          artifact = await storePhoto({
            workspaceId,
            userId,
            imageUrl: photoUrl,
            title: `${context.businessName ?? '매장'} 실제 사진 ${index + 1}`,
            altText: slot?.altText,
          })
        } catch {
          throw new NaverPostGenerationError(
            'IMAGES_INCOMPLETE',
            '매장 사진을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
          )
        }
        generatedArtifacts.push(artifact)
        storedImages = generatedArtifacts.length
      }
    } else {
      const generateImage =
        deps.generateImage ??
        (async (imgInput) => {
          const artifact = await createProductionConversationImageArtifact(imgInput)
          return { id: artifact.id, title: artifact.title }
        })

      // AI 이미지 생성 동시성: imageCount > 12이면 4장 동시(기존 3), 그 이하 3.
      // 20장 생성이 maxDuration(300초) 안에 끝나도록 병렬 구조:
      // imageCount 20장 기준 4장씩 5배치 실행 -> 장당 약 15~25초 소요 시 5배치 * 25초 = 약 125초로 300초 타임아웃 내 안전하게 완료.
      const IMAGE_CONCURRENCY = imageCount > 12 ? 4 : 3
      for (let batchStart = 0; batchStart < imageCount; batchStart += IMAGE_CONCURRENCY) {
        if (signal?.aborted) {
          throw new NaverPostGenerationError('IMAGES_INCOMPLETE', '작업이 취소되었습니다.')
        }

        const batchEnd = Math.min(batchStart + IMAGE_CONCURRENCY, imageCount)
        const batchIndices = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i)

        const batchResults = await Promise.allSettled(
          batchIndices.map(async (index) => {
            if (signal?.aborted) {
              throw new NaverPostGenerationError('IMAGES_INCOMPLETE', '작업이 취소되었습니다.')
            }
            const slot = slots[index]
            const narrativeIndex = Math.max(0, index - 1)
            const section = sections[Math.min(narrativeIndex, sections.length - 1)]

            return generateImage({
              workspaceId,
              userId,
              prompt: slidePrompts[index] ?? topic,
              channel: 'naver_blog',
              allowNeutralFallback: true,
              neutralContext: {
                altText: slot?.altText,
                sectionText: section?.body,
                industry: context.industry,
                tone: context.brandVoice,
              },
            })
          }),
        )

        for (let i = 0; i < batchResults.length; i++) {
          const res = batchResults[i]!
          const index = batchIndices[i]!

          if (res.status === 'fulfilled') {
            const artifact = res.value
            generatedArtifacts.push(artifact)
            storedImages = generatedArtifacts.length

            // Settle each image reservation as its image is stored (F1) ONLY if photoSource === 'ai'
            if (imageReservations[index]) {
              try {
                await credits.settle(workspaceId, imageReservations[index])
                settledImageReservations.push(imageReservations[index])
              } catch (err) {
                console.warn('[naver-post-credits] image credit settlement warning:', err)
                creditReconcileNeeded = true
              }
            }
          } else {
            const reason = res.reason
            if (reason instanceof NaverPostGenerationError) {
              throw reason
            }
            throw new NaverPostGenerationError(
              'IMAGES_INCOMPLETE',
              '이미지를 모두 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.',
            )
          }
        }
      }
    }

    if (generatedArtifacts.length !== imageCount) {
      throw new NaverPostGenerationError(
        'IMAGES_INCOMPLETE',
        '이미지를 모두 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      )
    }
    if (imageCount > 0) {
      openStage = null
      await recordStage({ stage: 'image_generation', status: 'verified', coverage: { covered: imageCount, total: imageCount }, dedupeKey: 'image:verified' })
    }

    // 7. Map to placements & materialize editor blocks
    const placements = generatedArtifacts.map((art, idx) => ({
      mediaId: art.id,
      placement: (idx === 0 ? 'cover' : 'inline') as 'cover' | 'inline',
      altText: slots[idx]?.altText || `이미지 ${idx + 1}`,
    }))

    let effectiveBlueprint = draft.editorBlueprint ?? []

    // 집계 평점만으로 고객 발언이나 서비스 약속을 만들어 인용하지 않는다.

    // 7-2. If editorBlueprint does not have a map block but workspace has a grounded place or businessName,
    // inject a map component before CTA or at the end to maximize Naver local SEO.
    const hasMapBlock = effectiveBlueprint.some((b) => b.kind === 'map')
    if (!hasMapBlock && context.businessName) {
      const mapPlaceName = context.businessName.trim()
      const ctaIndex = effectiveBlueprint.findIndex((b) => b.kind === 'cta')
      if (ctaIndex !== -1) {
        effectiveBlueprint = [
          ...effectiveBlueprint.slice(0, ctaIndex),
          { kind: 'map', placeName: mapPlaceName },
          ...effectiveBlueprint.slice(ctaIndex),
        ]
      } else {
        effectiveBlueprint = [
          ...effectiveBlueprint,
          { kind: 'map', placeName: mapPlaceName },
        ]
      }
    }

    // 7-3. [기능 1] 네이버 예약 안내 문구 자동 주입 (지연 유발하는 중복 OG 링크 카드 대신 고속 텍스트 안내)
    if (placeSummary?.placeId) {
      const bookingUrl = `https://m.place.naver.com/place/${placeSummary.placeId}/ticket`
      effectiveBlueprint = [
        ...effectiveBlueprint,
        { kind: 'paragraph' as const, text: `네이버 예약 안내(${bookingUrl})에서 예약 가능 여부와 이용 조건을 확인해 주세요.` },
      ]
    }

    const editorBlocks = materializeNaverEditorBlocks(effectiveBlueprint, placements)

    // 7-4. [기능 2] 네이버 로컬 상위노출 태그 10개 자동 최적화
    // 사장님이 승인한 핵심 키워드는 자동 확장 태그보다 앞에 두되, 태그 상한은 그대로 지킨다.
    const enrichedKeywords = ensureFocusKeyword(enrichLocalSeoKeywords(draft.keywords, {
      businessName: context.businessName || undefined,
      industry: context.industry || undefined,
      location: context.location || undefined,
    }), blogStrategyBrief?.focusKeyword?.keyword, 10)

    const structuredPayload = {
      channel: 'naver_blog' as const,
      title: draft.title,
      introduction: draft.introduction,
      sections: draft.sections.map((s) => ({ heading: s.heading, body: s.body })),
      keywords: enrichedKeywords,
      imagePlacements: placements,
      editorBlocks,
      cta: draft.cta,
      categoryId: categoryId ?? null,
      visibility,
      scheduledAt: scheduledAt ?? undefined,
      factBasis: { workspaceId, snapshotHash: approvedQa.snapshotHash, resolvedAt: approvedQa.resolvedAt, sources: approvedQa.sources, provenance: approvedQa.provenance },
      ...(blogStrategyBrief ? { strategyBrief: blogStrategyBrief } : {}),
      ...(postMode ? { postMode } : {}),
      ...(reaction ? { reaction } : {}),
      ...(imageStyle ? { imageStyle } : {}),
    }

    const finalClaimPayload = {
      channel: structuredPayload.channel,
      title: structuredPayload.title,
      introduction: structuredPayload.introduction,
      sections: structuredPayload.sections,
      keywords: structuredPayload.keywords,
      imagePlacements: structuredPayload.imagePlacements,
      editorBlocks: structuredPayload.editorBlocks,
      cta: structuredPayload.cta,
      categoryId: structuredPayload.categoryId,
      visibility: structuredPayload.visibility,
    }
    const finalClaimResult = checkClaims('naver_blog', finalClaimPayload, groundedContext)
    const finalApprovedQa = checkApprovedNaverDraft(workspaceId, finalClaimPayload, approvedFacts)
    if (finalClaimResult.status !== 'OK' || finalApprovedQa.status !== 'OK' ||
      findExcludedClaimViolations(finalClaimPayload, blogStrategyBrief?.excludedClaims).length) {
      throw new NaverPostGenerationError(
        'CLAIMS_NEED_REVIEW',
        '최종 원고에 확인되지 않은 내용이 남아 있어요. 매장 정보를 확인한 뒤 다시 작성해 주세요.',
        422,
      )
    }

    const currentFacts = await (deps.loadApprovedFacts
      ? deps.loadApprovedFacts(workspaceId)
      : loadApprovedFactSnapshot(adminClient as unknown as Parameters<typeof loadApprovedFactSnapshot>[0], workspaceId))
    if (currentFacts.workspaceId !== approvedFacts.workspaceId || currentFacts.hash !== approvedFacts.hash) {
      throw new Error('FACT_SNAPSHOT_STALE')
    }

    // F9: keywords converted to valid hashtags before save
    const hashtags = normalizeHashtags(enrichedKeywords)

    // 8. Create Content Item with userClient (F8)
    const createItem = deps.createItem ?? createContentItemWithClient
    const itemResult = await createItem(userClient, {
      workspaceId,
      title: draft.title,
      channel: 'naver_blog',
    })
    if (itemResult.error || !itemResult.data) {
      throw new NaverPostGenerationError(
        'SAVE_FAILED',
        itemResult.error?.message || '새 작업을 저장하지 못했습니다.',
      )
    }
    const contentId = itemResult.data.contentId

    // 9. Create Content Version with userClient (F8)
    const createVersion = deps.createVersion ?? createVersionWithClient
    const versionResult = await createVersion(userClient, {
      workspaceId,
      contentId,
      channel: 'naver_blog',
      caption: [draft.introduction, ...draft.sections.flatMap((s) => [s.heading, s.body])].join('\n\n').slice(0, 2200),
      hashtags,
      disclosure: DEFAULT_AI_DISCLOSURE,
      revisionReason: `naver_post:${requestKey}`,
      rightsConfirmed: true,
      generationEvidenceConfirmed: true,
      mediaIds: placements.map((p) => p.mediaId),
      structuredPayload,
      knowledgeIds: [],
      harnessRuleIds: [],
    })
    if (versionResult.error || !versionResult.data) {
      throw new NaverPostGenerationError(
        'SAVE_FAILED',
        versionResult.error?.message || '새 버전을 저장하지 못했습니다.',
      )
    }

    // 10. Mark Job Succeeded (F3, F4)
    // NEVER refund credits for a version that was saved!
    await jobStore.complete(
      workspaceId,
      requestKey,
      contentId,
      versionResult.data.versionId,
      creditReconcileNeeded,
    ).catch((err) => {
      console.warn('[naver-post-jobs] job complete warning:', err)
    })

    // Settle text reservation
    try {
      if (textReservation) {
        await credits.settle(workspaceId, textReservation)
      }
    } catch (err) {
      console.warn('[naver-post-credits] text credit settlement warning:', err)
      creditReconcileNeeded = true
      await jobStore.complete(
        workspaceId,
        requestKey,
        contentId,
        versionResult.data.versionId,
        true,
      ).catch(() => {})
    }

    return {
      contentId,
      versionId: versionResult.data.versionId,
      versionNumber: versionResult.data.versionNumber,
      fingerprint: versionResult.data.fingerprint,
      title: draft.title,
      imageCount,
    }
  } catch (error) {
    if (openStage === 'image_generation') {
      await recordStage(storedImages > 0
        ? { stage: 'image_generation', status: 'partial', coverage: { covered: storedImages, total: imageCount }, dedupeKey: 'image:partial' }
        : { stage: 'image_generation', status: 'failed', dedupeKey: 'image:failed' })
    } else if (openStage === 'draft_writing') {
      await recordStage({ stage: 'draft_writing', status: 'failed', dedupeKey: 'draft:failed' })
    }
    // Release unsettled holds on failure before version save
    await rollbackUnsettled()

    // Mark job failed
    await jobStore.fail(workspaceId, requestKey, creditReconcileNeeded).catch(() => {})

    throw error
  }
}

