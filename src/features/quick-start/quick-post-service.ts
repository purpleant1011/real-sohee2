import { randomUUID } from 'node:crypto'
import { filterPublishReadyChannels } from '@/features/capabilities/publish-context'
import {
  loadApprovedFactSnapshot,
  assertFactSnapshotCurrent,
  assessFactSnapshotCurrent,
  type ApprovedFactSnapshot,
  type FactSnapshotAssessment,
} from '@/features/knowledge/approved-fact-resolver'
import {
  calculateApprovalFingerprint,
  type ConnectedChannelInfo,
  type ExactApprovalCopies,
  type ExactApprovalPayload,
} from '@/features/missions/conversational-first-post'
import {
  type MissionContract,
  validateMissionContract,
} from '@/lib/mission-os/mission-contract'
import { generateAndStoreQuickImage } from './quick-image'
import { composeQuickPostCopy } from './quick-copy'
import { continueWithTextIfImageFails } from '@/features/first-value/image-fallback'
import {
  QuickPostCreditFailure, quickPostOperationKey,
  reserveQuickPostCredits, settleQuickPostCredits, releaseQuickPostCredits,
  type QuickPostReservation,
} from './quick-post-credits'
import {
  fenceMissionSnapshot,
  nextMissionSnapshotVersion,
} from '@/features/publishing/publish-consumption'
import { getMembershipTier, TRIAL_FIRST_POST_LIMIT } from '@/features/membership/membership-tier'
import { resolveWritingStyle } from '@/features/text-harness/resolve-writing-style'

type AdminClient = any

/** Consumer gate only; persisted asset ownership and rights are still revalidated. */
export const sourceAssetContract = 'v093-original-1'

/** Defense-in-depth quota alongside credit reservation (ANI-1513). */
export const QUICK_POST_DAILY_LIMIT = 10
export const QUICK_POST_MAX_REVISIONS = 5
export const QUICK_POST_MAX_TOTAL_REVISIONS = 30

export class QuickPostError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 422, public readonly details?: Record<string, unknown>) {
    super(message)
    this.name = 'QuickPostError'
  }
}

interface WorkspaceContext {
  businessName: string
  industry: string
  location: string
  summary: string
  offerings: string[]
  brandVoice: string
  boundVersions: ExactApprovalPayload['boundVersions']
  channels: ConnectedChannelInfo[]
  factSnapshot: ApprovedFactSnapshot
  learnedChannelFacts?: string[]
  learningDependencies?: Array<{ workspaceId: string; sourceId: string; revision: number }>
  learningEpoch?: number
}

export function isUsableBusinessName(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return Boolean(trimmed) && trimmed !== '신규 매장' && trimmed !== '매장명 설정 대기' && !trimmed.endsWith('의 워크스페이스')
}

async function loadContext(admin: AdminClient, workspaceId: string): Promise<WorkspaceContext> {
  const [profile, knowledge, text, image, policy, channels, factSnapshot] = await Promise.all([
    admin.from('business_profiles').select('business_name, industry, location, summary').eq('workspace_id', workspaceId).maybeSingle(),
    admin.from('workspace_knowledge_harnesses').select('version_no, offerings').eq('workspace_id', workspaceId).eq('is_active', true).limit(1).maybeSingle(),
    admin.from('harness_rules').select('version, structured_rule').eq('workspace_id', workspaceId).eq('rule_type', 'text_generation').eq('status', 'active').order('version', { ascending: false }).limit(1).maybeSingle(),
    admin.from('harness_rules').select('version').eq('workspace_id', workspaceId).eq('rule_type', 'image_generation').eq('status', 'active').order('version', { ascending: false }).limit(1).maybeSingle(),
    admin.from('harness_rules').select('version').eq('workspace_id', workspaceId).eq('rule_type', 'approval_policy').eq('status', 'active').order('version', { ascending: false }).limit(1).maybeSingle(),
    admin.from('channel_connections').select('channel, status, account_label').eq('workspace_id', workspaceId).in('channel', ['instagram', 'threads']),
    loadApprovedFactSnapshot(admin, workspaceId).catch((err) => {
      console.error('[quick-post] fact snapshot load failed in loadContext:', err)
      throw new QuickPostError('가게 정보를 불러오지 못했어요.', 'FACT_READ_FAILED', 503)
    }),
  ])

  let businessName = isUsableBusinessName(profile.data?.business_name) ? profile.data.business_name.trim() : ''
  if (!businessName) {
    // Fall back only to formal signup application company name; never treat unverified workspace placeholder as verified
    try {
      const signupRes = await admin
        .from('signup_applications')
        .select('company_name')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (isUsableBusinessName(signupRes?.data?.company_name)) {
        businessName = signupRes.data.company_name.trim()
      }
    } catch {
      // Ignore signup_applications read failures gracefully without crashing context load
    }
  }

  if (!businessName) {
    throw new QuickPostError('매장 기본 정보를 먼저 입력해 주세요.', 'PROFILE_MISSING')
  }
  if (!knowledge.data || !text.data || !image.data || !policy.data) {
    throw new QuickPostError('소희가 일할 기준이 아직 준비되지 않았어요. 시작하기를 먼저 완료해 주세요.', 'QUICK_START_REQUIRED')
  }

  if (channels.error || !Array.isArray(channels.data)) throw new QuickPostError('채널 연결 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.', 'CHANNEL_QUERY_FAILED', 503)
  const connected: ConnectedChannelInfo[] = (await filterPublishReadyChannels(admin, workspaceId, channels.data))
    .filter((c: any) => ['connected', 'verified'].includes(c.status) && c.account_label)
    .map((c: any) => {
      const handle = String(c.account_label)
      const clean = handle.replace(/^@/, '')
      return {
        provider: c.channel,
        handle,
        profileUrl:
          c.channel === 'instagram'
            ? `https://www.instagram.com/${clean}`
            : `https://www.threads.com/@${clean}`,
      }
    })
  const structured = (text.data.structured_rule ?? {}) as Record<string, any>
  const offerings = Array.isArray(knowledge.data.offerings)
    ? knowledge.data.offerings.map((o: any) => o?.value ?? o?.key).filter(Boolean)
    : []

  // Channel Learning Grounding (ANI-2203)
  let learnedChannelFacts: string[] = []
  let learningDependencies: Array<{ workspaceId: string; sourceId: string; revision: number }> = []
  let learningEpoch: number | undefined

  if (process.env.SOHEE_CHANNEL_LEARNING_ENABLED === '1' && typeof (admin as any)?.rpc === 'function') {
    try {
      const { data: rpcData, error: rpcError } = await (admin as any).rpc('get_approved_learning_context', {
        p_workspace_id: workspaceId,
        p_purpose: 'content',
        p_max_facts: 50,
        p_query: '',
      })
      if (!rpcError && rpcData) {
        const items = Array.isArray(rpcData.items) ? rpcData.items : Array.isArray(rpcData) ? rpcData : []
        learningEpoch = Number(rpcData.epoch ?? items[0]?.epoch ?? 1)
        const seenDeps = new Set<string>()

        for (const item of items) {
          if (item?.content && typeof item.content === 'string') {
            learnedChannelFacts.push(item.content.trim())
          }
          if (Array.isArray(item?.dependencies)) {
            for (const dep of item.dependencies) {
              const sId = dep.sourceId || dep.source_id || dep.id
              if (sId) {
                const depWs = dep.workspaceId || dep.workspace_id || workspaceId
                const depRev = Number(dep.revision || dep.source_revision || 1)
                const key = `${depWs}:${sId}:${depRev}`
                if (!seenDeps.has(key)) {
                  seenDeps.add(key)
                  learningDependencies.push({ workspaceId: depWs, sourceId: String(sId), revision: depRev })
                }
              }
            }
          }
        }
      }
    } catch {
      // safe fallback on RPC error
    }
  }

  return {
    businessName,
    industry: profile.data?.industry ?? '',
    location: profile.data?.location ?? '',
    summary: profile.data?.summary ?? '',
    offerings,
    brandVoice: resolveWritingStyle(text.data.structured_rule, '따뜻하고 정갈한 어조'),
    boundVersions: {
      knowledgeVersion: knowledge.data.version_no,
      textHarnessVersion: text.data.version,
      imageHarnessVersion: image.data.version,
      operatingPolicyVersion: policy.data.version,
    },
    channels: connected,
    factSnapshot,
    learnedChannelFacts,
    learningDependencies,
    learningEpoch,
  }
}

export type QuickPostFactReview = FactSnapshotAssessment & {
  readonly notice: string | null
}

export interface QuickPostSummary {
  missionId: string
  status: string
  executionState?: string
  outcomeState?: string
  topic: string
  createdAt: string
  copies: ExactApprovalCopies
  imageIds: string[]
  imageUrl: string | null
  channels: ConnectedChannelInfo[]
  approvalFingerprint: string
  businessName: string
  revision: number
  creditsCharged?: number
  imageNotice?: string | null
  receipts: Record<string, { stage: string; permalink?: string; errorMessage?: string }>
  factReview?: QuickPostFactReview
  supportsApprovalActions?: boolean
}

export function summarize(workspaceId: string, row: any, currentFactSnapshot?: ApprovedFactSnapshot): QuickPostSummary | null {
  const md = row.metadata ?? {}
  const payload = md.payload as ExactApprovalPayload | undefined
  if (!payload?.copies) return null
  const imageIds = payload.imageIds ?? []
  const receipts: QuickPostSummary['receipts'] = {}
  for (const [channel, r] of Object.entries<any>(md.executionResult?.receipts ?? {})) {
    receipts[channel] = { stage: r.stage, permalink: r.permalink, errorMessage: r.errorMessage }
  }
  let factReview: QuickPostFactReview | undefined
  if (row.status === 'AWAITING_APPROVAL' && currentFactSnapshot) {
    const assessment = assessFactSnapshotCurrent(md.factSnapshot, currentFactSnapshot)
    factReview = {
      ...assessment,
      notice: assessment.state === 'CURRENT' ? null : '가게 정보를 다시 확인해야 해요. 글도 함께 다시 만들어 주세요.',
    }
  }
  return {
    missionId: row.id,
    status: row.status,
    executionState: md.execution_state,
    outcomeState: md.outcome_state,
    topic: md.quick?.topic ?? md.draft?.topic ?? '',
    createdAt: row.created_at,
    copies: payload.copies,
    imageIds,
    imageUrl: imageIds[0] ? `/api/workspaces/${workspaceId}/media/${imageIds[0]}` : null,
    channels: payload.channels ?? [],
    approvalFingerprint: calculateApprovalFingerprint(payload),
    businessName: md.quick?.businessName ?? '',
    revision: md.quick?.revision ?? 1,
    ...(typeof md.quick?.creditsCharged === 'number' ? { creditsCharged: md.quick.creditsCharged } : {}),
    imageNotice: typeof md.quick?.imageNotice === 'string' ? md.quick.imageNotice : null,
    receipts,
    ...(factReview ? { factReview } : {}),
    supportsApprovalActions: md.lane === 'QUICK_POST',
  }
}

export async function listQuickPosts(admin: AdminClient, workspaceId: string): Promise<QuickPostSummary[]> {
  const { data, error } = await admin
    .from('marketing_missions')
    .select('id, status, metadata, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(40)
  if (error) {
    console.error('[quick-post] list failed:', error)
    throw new QuickPostError('콘텐츠 목록을 불러오지 못했어요.', 'LIST_FAILED', 500)
  }
  if (!Array.isArray(data)) throw new QuickPostError('콘텐츠 목록을 불러오지 못했어요.', 'LIST_FAILED', 500)
  const rows = data
  const hasAwaiting = rows.some((row: any) => row.status === 'AWAITING_APPROVAL')
  let currentFactSnapshot: ApprovedFactSnapshot | undefined
  if (hasAwaiting) {
    try {
      currentFactSnapshot = await loadApprovedFactSnapshot(admin, workspaceId)
    } catch (err) {
      console.error('[quick-post] fact snapshot load failed during list:', err)
      throw new QuickPostError('가게 정보를 불러오지 못했어요.', 'FACT_READ_FAILED', 503)
    }
  }
  return rows.map((row: any) => summarize(workspaceId, row, currentFactSnapshot)).filter(Boolean) as QuickPostSummary[]
}

async function reserveForQuickPost(admin: AdminClient, workspaceId: string, missionId: string, revision: number, scope: ReviseScope, userId?: string) {
  try {
    return await reserveQuickPostCredits({ admin, workspaceId, missionId, revision, scope, userId })
  } catch (error) {
    if (error instanceof QuickPostCreditFailure) throw new QuickPostError(error.message, error.code, error.status)
    throw error
  }
}

async function settleWithRetry(admin: AdminClient, workspaceId: string, reservation: QuickPostReservation) {
  try {
    await settleQuickPostCredits(admin, workspaceId, reservation)
  } catch (error) {
    if (error instanceof QuickPostCreditFailure) throw new QuickPostError(error.message, error.code, error.status)
    throw error
  }
}

async function releaseAfterFailure(admin: AdminClient, workspaceId: string, reservation: QuickPostReservation) {
  try {
    return await releaseQuickPostCredits(admin, workspaceId, reservation)
  } catch (error) {
    // Fail closed: never conceal a failed refund with the original provider/persistence error.
    if (error instanceof QuickPostCreditFailure) throw new QuickPostError(error.message, error.code, error.status)
    throw error
  }
}

async function assertDailyQuota(admin: AdminClient, workspaceId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await admin
    .from('marketing_missions')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('metadata->>lane', 'QUICK_POST')
    .gte('created_at', since)
  if (error || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw new QuickPostError('사용량을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.', 'QUOTA_CHECK_FAILED', 503)
  }
  if (count >= QUICK_POST_DAILY_LIMIT) {
    throw new QuickPostError(`하루에 만들 수 있는 게시물은 ${QUICK_POST_DAILY_LIMIT}개예요. 내일 다시 만들어 주세요.`, 'DAILY_LIMIT_REACHED', 429)
  }
}

async function assertTrialQuota(admin: AdminClient, workspaceId: string) {
  const tier = await getMembershipTier(admin, workspaceId)
  if (tier !== 'FORMAL') {
    let query: any = admin
      .from('marketing_missions')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('metadata->>lane', 'QUICK_POST')
    if (typeof query?.not === 'function') {
      query = query.not('status', 'in', '("FAILED","CANCELLED")')
    }
    const { count, error } = await query
    if (error || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      throw new QuickPostError('사용량을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.', 'QUOTA_CHECK_FAILED', 503)
    }
    if (count >= TRIAL_FIRST_POST_LIMIT) {
      throw new QuickPostError(
        '첫 포스팅 2건을 모두 사용했어요. 사업자 인증이 승인되면 계속 쓸 수 있어요.',
        'TRIAL_FIRST_POST_LIMIT_REACHED',
        403,
      )
    }
  }
}

export async function createQuickDraft(params: {
  admin: AdminClient
  workspaceId: string
  userId: string
  topic: string
  /** Stable caller-generated request ID. Reuse it when retrying the same create request. */
  missionId?: string
  /** If true, skip image generation even if no source photos are provided (100 credits). */
  textOnly?: boolean
  /** Only the first-value preview can keep the paid text draft when image generation fails. */
  allowTextOnlyOnImageError?: boolean
  /** Persisted USER_UPLOAD media IDs, never client URLs or claimed rights. */
  sourceAssetIds?: readonly string[]
}): Promise<QuickPostSummary> {
  const { admin, workspaceId, userId, topic } = params
  const missionId = params.missionId ?? randomUUID()
  const sourceAssetIds = [...(params.sourceAssetIds ?? [])]
  if (sourceAssetIds.length > 1 || sourceAssetIds.some(id => !id?.trim())) {
    throw new QuickPostError('대표 사진을 한 장 선택해 주세요.', 'SOURCE_MEDIA_NOT_READY')
  }
  const isTextOnly = Boolean(params.textOnly) || sourceAssetIds.length > 0
  const scope = isTextOnly ? 'text' : 'both'
  const operationKey = quickPostOperationKey(missionId, 1, scope)
  const existing = await admin.from('marketing_missions').select('id, status, metadata, created_at')
    .eq('workspace_id', workspaceId).eq('id', missionId).maybeSingle()
  if (existing.error) throw new QuickPostError('게시물 상태를 확인하지 못했어요.', 'DB_READ_ERROR', 500)
  if (existing.data) {
    if (existing.data.metadata?.quick?.creditOperationKey !== operationKey || existing.data.metadata.quick.topic !== topic.trim() || existing.data.metadata.quick.createdBy !== userId || JSON.stringify(existing.data.metadata?.sourceAssetIds ?? []) !== JSON.stringify(sourceAssetIds)) {
      throw new QuickPostError('다른 요청에 사용한 게시물 ID예요.', 'IDEMPOTENCY_CONFLICT', 409)
    }
    const summary = summarize(workspaceId, existing.data)
    if (!summary) throw new QuickPostError('이전 게시물의 상태를 확인하지 못했어요.', 'IDEMPOTENCY_CONFLICT', 409)
    const prior = await reserveForQuickPost(admin, workspaceId, missionId, 1, scope, userId)
    if (prior.state === 'reserved') await settleWithRetry(admin, workspaceId, prior)
    if (prior.state === 'released') throw new QuickPostError('크레딧 상태를 확인하지 못했어요.', 'CREDIT_SETTLE_FAILED', 503)
    return summary
  }
  let sourceRights: ExactApprovalPayload['rights'] | undefined
  if (sourceAssetIds.length) {
    const { data: asset, error } = await admin.from('media_assets')
      .select('id,workspace_id,provenance_kind,lifecycle_status,rights_status,publish_eligibility,generation_metadata')
      .eq('workspace_id', workspaceId).eq('id', sourceAssetIds[0]).maybeSingle()
    const evidence = asset?.generation_metadata?.uploadRights
    if (error || asset?.id !== sourceAssetIds[0] || asset?.workspace_id !== workspaceId ||
      asset?.provenance_kind !== 'USER_UPLOAD' || asset?.lifecycle_status !== 'READY' ||
      asset?.rights_status !== 'confirmed' || asset?.publish_eligibility !== true ||
      asset?.generation_metadata?.rightsWithdrawnAt || evidence?.commercialUse !== true ||
      !['owned', 'licensed'].includes(evidence?.copyright) ||
      !(evidence?.identifiablePeople === 'none' ||
        (evidence?.identifiablePeople === 'consented' && typeof evidence?.consentReference === 'string' && evidence.consentReference.trim()))) {
      // ExactApprovalPayload cannot express pending rights. Never label private/unconfirmed media OWNED.
      throw new QuickPostError('사진의 저장 상태와 사용 권리를 먼저 확인해 주세요.', 'SOURCE_MEDIA_NOT_READY')
    }
    sourceRights = { rightsStatus: evidence.copyright === 'owned' ? 'OWNED' : 'LICENSED',
      consentStatus: evidence.identifiablePeople === 'none' ? 'NOT_APPLICABLE' : 'CONFIRMED' }
  }
  const ctx = await loadContext(admin, workspaceId)
  await assertDailyQuota(admin, workspaceId)
  await assertTrialQuota(admin, workspaceId)
  const reservation = await reserveForQuickPost(admin, workspaceId, missionId, 1, scope, userId)
  if (reservation.isReplay) {
    // The first invocation is still running (or its write failed): do not launch providers twice.
    throw new QuickPostError('같은 게시물 요청이 이미 처리됐어요. 새로 만들려면 다시 요청해 주세요.', 'REQUEST_IN_PROGRESS', 409)
  }
  let persisted = false
  try {
    const confirmedFacts = [
      ...ctx.factSnapshot.facts.map(fact => fact.content),
      ...(ctx.learnedChannelFacts ?? []),
    ]
    const copyTask = composeQuickPostCopy({
      businessName: ctx.businessName, industry: ctx.industry, location: ctx.location, summary: ctx.summary,
      offerings: ctx.offerings, brandVoice: ctx.brandVoice, topic,
      confirmedFacts,
    })
    const imageTask: Promise<{ assetId: string } | null> = Boolean(params.textOnly)
      ? Promise.resolve(null)
      : sourceAssetIds.length
        ? Promise.resolve({ assetId: sourceAssetIds[0] })
        : generateAndStoreQuickImage({
            admin, workspaceId, userId, context: { ...ctx, topic: topic.trim() || '매장 소개 및 첫 인사' },
          })
    const { copies, image, imageNotice } = (params.allowTextOnlyOnImageError && !params.textOnly && !sourceAssetIds.length)
      ? await continueWithTextIfImageFails(copyTask, imageTask as Promise<{ assetId: string }>)
      : await Promise.all([copyTask, imageTask]).then(([text, picture]) => ({ copies: text, image: picture, imageNotice: null }))

    const payload: ExactApprovalPayload = {
      workspaceId, missionId, channels: ctx.channels, copies, imageIds: image ? [image.assetId] : [],
      boundVersions: ctx.boundVersions,
      rights: sourceRights ?? { rightsStatus: 'OWNED', consentStatus: 'NOT_APPLICABLE' },
    }
    const approvalFingerprint = calculateApprovalFingerprint(payload)
    const now = new Date().toISOString()
    const factVersionRefs = ctx.factSnapshot.facts.map(fact => String(fact.id))
    const rawContract: MissionContract = {
      contract_version: 1,
      goal: topic.trim() || '매장 소개 및 첫 인사',
      success_criterion: {
        metric: 'FIRST_POST_PUBLISHED',
        target_value: 1,
        baseline_value: 0,
        unit: 'post',
      },
      observation_window: {
        start_at: now,
        end_at: new Date(Date.now() + 7 * 86400000).toISOString(),
        evaluation_interval_hours: 24,
      },
      service_scope: Array.from(
        new Set([
          ...(scope === 'text' ? ['social_copy_draft'] : ['social_copy_draft', 'image_generation']),
          ...ctx.channels.map((c) => c.provider.toLowerCase()).filter(Boolean),
        ])
      ),
      allowed_actions: ['draft_create', 'approval_request', 'publish_with_explicit_approval'],
      forbidden_actions: ['publish_without_owner_approval', 'auto_debit_without_reservation'],
      budget_caps: {
        max_cost_minor_units: reservation.requestedCredits,
        currency: 'CREDIT',
      },
      attention_policy: {
        max_escalations: 3,
        notify_on_breach: true,
      },
      fact_version_refs: factVersionRefs,
      policy_version: `harness_policy_${ctx.boundVersions.operatingPolicyVersion}`,
      approval_fingerprint: null, // Unapproved contract: strictly null
      owner_actor: {
        actor_type: 'user',
        actor_id: userId,
      },
      effective_at: now,
      expires_at: new Date(Date.now() + 14 * 86400000).toISOString(),
    }
    const contract = validateMissionContract(rawContract)

    // Channel Learning Post-Draft Gate (ANI-2203)
    if (ctx.learningDependencies && ctx.learningDependencies.length > 0) {
      const { createSupabaseConsumerGate, validateLearningResult } = await import('@/features/channel-learning/consumer-gate')
      const gate = createSupabaseConsumerGate(admin, 'content')
      const isValid = await validateLearningResult(
        {
          workspaceId,
          epoch: ctx.learningEpoch ?? 1,
          dependencies: ctx.learningDependencies,
          purpose: 'content',
        },
        gate
      )
      if (!isValid) {
        await releaseAfterFailure(admin, workspaceId, reservation).catch(() => undefined)
        throw new QuickPostError('가게 공식 채널 정보가 변경되어 초안을 저장하지 못했어요.', 'LEARNING_SOURCE_REVOKED', 409)
      }
    }

    const { data, error } = await admin.from('marketing_missions').insert({
      id: missionId,
      workspace_id: workspaceId,
      trace_id: `trace_${Date.now()}`,
      status: 'AWAITING_APPROVAL',
      goal: topic.trim() || '매장 소개 및 첫 인사',
      metadata: {
        lane: 'QUICK_POST',
        sourceAssetIds,
        factSnapshot: ctx.factSnapshot,
        learningDependencies: ctx.learningDependencies,
        learningEpoch: ctx.learningEpoch,
        quick: {
          topic: topic.trim(),
          businessName: ctx.businessName,
          createdBy: userId,
          revision: 1,
          modelRevisions: 0,
          imageNotice,
          creditsCharged: reservation.requestedCredits,
          creditOperationKey: operationKey,
          textOnly: Boolean(params.textOnly),
        },
        draftFingerprint: approvalFingerprint,
        payload,
        boundVersions: payload.boundVersions,
        rights: payload.rights,
        channels: payload.channels,
        copies: payload.copies,
        selectedImageIds: payload.imageIds,
        contract,
        execution_state: 'NEEDS_DECISION',
        outcome_state: 'PENDING',
        approval_fingerprint: null,
        fact_version_refs: factVersionRefs,
        cost_credits: reservation.requestedCredits,
        createdAt: now,
      },
      created_at: now,
      updated_at: now,
    }).select('id, status, metadata, created_at').single()
    if (error || !data) {
      console.error('[quick-post] draft persistence failed:', error)
      const isFenced = (error as any)?.message?.includes('QUICK_POST_RESERVATION_RELEASED') || (error as any)?.code === 'P0001'
      if (isFenced) {
        throw new QuickPostError('만료되었거나 해제된 예약에 대한 초안 저장이 차단되었어요.', 'RESERVATION_FENCED', 409)
      }
      throw new QuickPostError('초안을 저장하지 못했어요.', 'PERSISTENCE_ERROR', 500)
    }
    // Once persisted, never release: a failed settlement is retried with the same reservation key.
    persisted = true
    await settleWithRetry(admin, workspaceId, reservation)
    return summarize(workspaceId, data)!
  } catch (err) {
    if (!persisted) {
      const releaseResult = await releaseAfterFailure(admin, workspaceId, reservation)
      if (releaseResult?.state === 'reserved' && releaseResult?.missionExists === true) {
        // Persistence commit succeeded in DB despite client socket loss: release RPC refused refund.
        // Retry settlement for the committed mission.
        await settleWithRetry(admin, workspaceId, reservation).catch(settleErr => {
          console.error('[quick-post] settlement retry after response loss failed:', settleErr)
        })
      }
    }
    throw err
  }
}

export type ReviseScope = 'text' | 'image' | 'both'

export async function reviseQuickDraft(params: {
  admin: AdminClient
  workspaceId: string
  userId: string
  missionId: string
  feedback: string
  scope: ReviseScope
  /** Owner hand-edited copy; skips model generation for text. */
  manualCopies?: ExactApprovalCopies
  requestId?: string
  /** Client's base revision. Mismatch (or a lost CAS race) is a 409 REVISION_CONFLICT carrying the server's latest item. */
  expectedRevision?: number
}): Promise<QuickPostSummary> {
  const { admin, workspaceId, userId, missionId, feedback, scope, manualCopies, requestId, expectedRevision } = params
  const { data: mission, error: readErr } = await admin
    .from('marketing_missions')
    .select('id, status, metadata, created_at, updated_at')
    .eq('id', missionId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (readErr) {
    console.error('[quick-post] mission read failed:', readErr)
    throw new QuickPostError('게시물 상태를 확인하지 못했어요.', 'DB_READ_ERROR', 500)
  }
  if (!mission) throw new QuickPostError('수정할 게시물을 찾을 수 없어요.', 'MISSION_NOT_FOUND', 404)
  if (mission.status !== 'AWAITING_APPROVAL') {
    throw new QuickPostError('승인 대기 중인 게시물만 수정할 수 있어요.', 'INVALID_MISSION_STATE', 409)
  }
  if (
    mission.metadata?.execution_state === 'PAUSED' ||
    mission.metadata?.execution_state === 'STOPPED' ||
    mission.metadata?.execution_state === 'CLOSED'
  ) {
    throw new QuickPostError('일시정지되거나 이미 완료된 게시물은 수정할 수 없어요.', 'INVALID_EXECUTION_STATE', 409)
  }

  const md = mission.metadata ?? {}
  const revisionConflict = (row: { id: string; status: string; metadata: any; created_at: string }) =>
    new QuickPostError('다른 기기에서 먼저 수정했어요. 최신 내용을 확인해 주세요.', 'REVISION_CONFLICT', 409, { latest: summarize(workspaceId, row) })
  if (expectedRevision !== undefined && expectedRevision !== (md.quick?.revision ?? 1)) throw revisionConflict(mission)
  if (!manualCopies && requestId && md.quick?.creditRequestId === requestId && (md.quick?.creditOperationKey !== quickPostOperationKey(missionId, md.quick?.revision ?? 1, scope) || md.quick?.creditFeedback !== feedback || md.quick?.creditRequestedBy !== userId)) {
    throw new QuickPostError('다른 수정 요청에 사용한 요청 ID예요.', 'IDEMPOTENCY_CONFLICT', 409)
  }
  if (!manualCopies && requestId && md.quick?.creditRequestId === requestId && md.quick?.creditOperationKey === quickPostOperationKey(missionId, md.quick?.revision ?? 1, scope)) {
    const previous = await reserveForQuickPost(admin, workspaceId, missionId, md.quick.revision, scope, userId)
    if (previous.state === 'reserved') await settleWithRetry(admin, workspaceId, previous)
    if (previous.state === 'released') throw new QuickPostError('크레딧 상태를 확인하지 못했어요.', 'CREDIT_SETTLE_FAILED', 503)
    return summarize(workspaceId, mission)!
  }
  if ((md.quick?.revision ?? 1) - 1 >= QUICK_POST_MAX_TOTAL_REVISIONS) {
    throw new QuickPostError(`수정 요청은 게시물당 총 ${QUICK_POST_MAX_TOTAL_REVISIONS}번까지 가능해요.`, 'TOTAL_REVISION_LIMIT_REACHED', 429)
  }
  if (!manualCopies && (md.quick?.modelRevisions ?? (md.quick?.revision ?? 1) - 1) >= QUICK_POST_MAX_REVISIONS) {
    throw new QuickPostError(`수정 요청은 게시물당 ${QUICK_POST_MAX_REVISIONS}번까지 가능해요. 직접 고치거나 새로 만들어 주세요.`, 'REVISION_LIMIT_REACHED', 429)
  }
  const prev = md.payload as ExactApprovalPayload
  const ctx = await loadContext(admin, workspaceId)
  if (scope === 'image' || manualCopies) {
    try {
      if (!md.factSnapshot) throw new Error('FACT_SNAPSHOT_STALE')
      assertFactSnapshotCurrent(md.factSnapshot, ctx.factSnapshot)
    } catch {
      throw new QuickPostError('가게 정보를 다시 확인해야 해요. 글도 함께 다시 만들어 주세요.', 'FACT_SNAPSHOT_STALE', 409)
    }
  }
  const topic: string = md.quick?.topic ?? ''
  const revision = (md.quick?.revision ?? 1) + 1
  const operationKey = manualCopies ? null : quickPostOperationKey(missionId, revision, scope)
  const reservation = manualCopies ? null : await reserveForQuickPost(admin, workspaceId, missionId, revision, scope, userId)
  if (reservation?.state === 'settled') {
    const current = await admin.from('marketing_missions').select('id, status, metadata, created_at')
      .eq('id', missionId).eq('workspace_id', workspaceId).maybeSingle()
    if (current.error || current.data?.metadata?.quick?.creditOperationKey !== operationKey) {
      throw new QuickPostError('이전 수정 요청을 확인하지 못했어요.', 'IDEMPOTENCY_CONFLICT', 409)
    }
    return summarize(workspaceId, current.data)!
  }
  if (reservation?.state === 'released') {
    throw new QuickPostError('이전에 실패한 수정 요청이에요. 다시 수정해 주세요.', 'IDEMPOTENCY_CONFLICT', 409)
  }
  if (reservation?.isReplay) {
    throw new QuickPostError('같은 수정 요청이 이미 처리됐어요. 새로 수정해 주세요.', 'REQUEST_IN_PROGRESS', 409)
  }
  let persisted = false
  try {
    let copies = prev.copies
    let imageIds = prev.imageIds
    const tasks: Promise<void>[] = []

    if (manualCopies) {
      copies = manualCopies
    } else if (scope === 'text' || scope === 'both') {
      tasks.push(
        composeQuickPostCopy({
          businessName: ctx.businessName,
          industry: ctx.industry,
          location: ctx.location,
          summary: ctx.summary,
          offerings: ctx.offerings,
          confirmedFacts: [
            ...ctx.factSnapshot.facts.map(fact => fact.content),
            ...(ctx.learnedChannelFacts ?? []),
          ],
          brandVoice: ctx.brandVoice,
          topic,
          feedback,
          previous: prev.copies,
        }).then((c) => { copies = c }),
      )
    }
    if (!manualCopies && (scope === 'image' || scope === 'both')) {
      tasks.push(
        generateAndStoreQuickImage({
          admin, workspaceId, userId,
          context: { ...ctx, topic: topic || '매장 소개 및 첫 인사', feedback },
        }).then((img) => { imageIds = [img.assetId] }),
      )
    }
    await Promise.all(tasks)

    const payload: ExactApprovalPayload = {
      ...prev, copies, imageIds, boundVersions: ctx.boundVersions, channels: ctx.channels,
    }
    const now = new Date().toISOString()

    // Channel Learning Post-Draft Gate (ANI-2203, ANI-2205)
    if (ctx.learningDependencies && ctx.learningDependencies.length > 0) {
      const { createSupabaseConsumerGate, validateLearningResult } = await import('@/features/channel-learning/consumer-gate')
      const gate = createSupabaseConsumerGate(admin, 'content')
      const isValid = await validateLearningResult(
        {
          workspaceId,
          epoch: ctx.learningEpoch ?? 1,
          dependencies: ctx.learningDependencies,
          purpose: 'content',
        },
        gate
      )
      if (!isValid) {
        if (reservation) {
          await releaseAfterFailure(admin, workspaceId, reservation).catch(() => undefined)
        }
        throw new QuickPostError('가게 공식 채널 정보가 변경되어 초안을 저장하지 못했어요.', 'LEARNING_SOURCE_REVOKED', 409)
      }
    }

    const nextSnapshotVersion = nextMissionSnapshotVersion(md)
    const nextControlEpoch = (typeof md.control_epoch === 'number' ? md.control_epoch : 0) + 1
    let updateQuery = admin.from('marketing_missions').update({
      metadata: {
        ...md,
        cost_credits: reservation?.requestedCredits ?? (typeof md.cost_credits === 'number' ? md.cost_credits : 0),
        factSnapshot: ctx.factSnapshot,
        learningDependencies: ctx.learningDependencies,
        learningEpoch: ctx.learningEpoch,
        quick: { ...md.quick, revision, modelRevisions: (md.quick?.modelRevisions ?? (md.quick?.revision ?? 1) - 1) + (manualCopies ? 0 : 1), lastFeedback: manualCopies ? '(직접 수정)' : feedback,
          creditsCharged: reservation?.requestedCredits ?? 0, creditOperationKey: operationKey, creditRequestId: requestId ?? null,
          creditFeedback: manualCopies ? null : feedback, creditRequestedBy: userId },
        draftFingerprint: calculateApprovalFingerprint(payload),
        payload,
        boundVersions: payload.boundVersions,
        channels: payload.channels,
        copies: payload.copies,
        selectedImageIds: payload.imageIds,
        approvedFingerprint: null,
        approvedMission: null,
        approvedByUserId: null,
        approvedAt: null,
        snapshot_version: nextSnapshotVersion,
        control_epoch: nextControlEpoch,
        ...(md.contract
          ? {
              contract: {
                ...md.contract,
                approval_fingerprint: null,
              },
              execution_state: 'NEEDS_DECISION',
              approval_fingerprint: null,
            }
          : {}),
      },
      updated_at: now,
    })
      .eq('id', missionId)
      .eq('workspace_id', workspaceId)
      .eq('status', 'AWAITING_APPROVAL')
      .eq('metadata->quick->>revision', String(md.quick?.revision ?? 1))

    updateQuery = fenceMissionSnapshot(updateQuery, mission)

    const { data, error } = await updateQuery
      .select('id, status, metadata, created_at')
      .single()
    if (!data && (!error || error.code === 'PGRST116')) {
      // CAS lost: status/revision/snapshot moved under us. Report the latest instead of a fake 500.
      const latest = await admin.from('marketing_missions').select('id, status, metadata, created_at')
        .eq('id', missionId).eq('workspace_id', workspaceId).maybeSingle()
      if (latest.data) {
        if (
          latest.data.metadata?.execution_state === 'PAUSED' ||
          latest.data.metadata?.execution_state === 'STOPPED' ||
          latest.data.metadata?.execution_state === 'CLOSED'
        ) {
          throw new QuickPostError('일시정지되거나 이미 완료된 게시물은 수정할 수 없어요.', 'INVALID_EXECUTION_STATE', 409)
        }
        throw revisionConflict(latest.data)
      }
    }
    if (error || !data) {
      console.error('[quick-post] revision persistence failed:', error)
      throw new QuickPostError('수정본을 저장하지 못했어요.', 'PERSISTENCE_ERROR', 500)
    }
    persisted = true
    if (reservation) await settleWithRetry(admin, workspaceId, reservation)
    return summarize(workspaceId, data)!
  } catch (err) {
    if (reservation && !persisted) await releaseAfterFailure(admin, workspaceId, reservation)
    throw err
  }
}
