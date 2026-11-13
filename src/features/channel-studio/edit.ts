import { z } from 'zod'
import { evaluateChannelSpec } from '@/features/vault/channel-spec/evaluate'
import type { ChannelVariantPayload, MediaItem } from '@/features/vault/channel-spec/types'
import type { ChannelDraftRepository, ClaimChecker, KnowledgeContextLoader } from './ports'
import { ChannelDraftError, type ChannelDraftEditRequest, type ChannelDraftResult, type StudioChannel, type VariantStatus } from './types'

const editsSchema = z.strictObject({
  title: z.string().max(200).optional(),
  text: z.string().max(20_000).optional(),
  caption: z.string().max(20_000).optional(),
  hashtags: z.array(z.string().max(50)).max(30).optional(),
}).refine(value => Object.keys(value).length > 0)
const requestSchema = z.strictObject({
  workspaceId: z.string().uuid(), userId: z.string().uuid(), requestKey: z.string().uuid(),
  channel: z.enum(['instagram', 'threads', 'naver_blog', 'daangn_business']), edits: editsSchema,
})
const allowed: Record<StudioChannel, ReadonlyArray<keyof ChannelDraftEditRequest['edits']>> = {
  instagram: ['caption', 'hashtags'], threads: ['text'], naver_blog: ['title', 'text'], daangn_business: ['text'],
}
const clean = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\p{Cf}]/gu, '').trim()

export interface EditChannelDraftDependencies {
  repo: ChannelDraftRepository
  loadContext: KnowledgeContextLoader
  checkClaims: ClaimChecker
}

/** Owner edits only local draft fields. No provider or social platform call occurs here. */
export async function editChannelDraftVariant(req: ChannelDraftEditRequest, deps: EditChannelDraftDependencies): Promise<ChannelDraftResult> {
  const parsed = requestSchema.safeParse(req)
  if (!parsed.success) throw new ChannelDraftError('수정할 글과 입력 내용을 확인해 주세요.', 'VALIDATION_FAILED', 400)
  const { workspaceId, requestKey, channel, userId, edits } = parsed.data
  if (!allowed[channel].some(key => edits[key] !== undefined)) {
    throw new ChannelDraftError('이 채널에서 수정할 수 있는 내용을 입력해 주세요.', 'VALIDATION_FAILED', 400)
  }
  let snapshot: Awaited<ReturnType<ChannelDraftRepository['findEditSnapshot']>>
  try { snapshot = await deps.repo.findEditSnapshot(workspaceId, requestKey) }
  catch { throw new ChannelDraftError('글을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', 'PERSISTENCE_FAILED', 503) }
  if (!snapshot) throw new ChannelDraftError('수정할 글을 찾지 못했어요.', 'DRAFT_NOT_FOUND', 404)
  if (!snapshot.draft.variants.length) throw new ChannelDraftError('글을 준비하고 있어요. 잠시 후 다시 시도해 주세요.', 'EDIT_CONFLICT', 409)
  const previous = snapshot.draft.variants.find(variant => variant.channel === channel)
  if (!previous) throw new ChannelDraftError('수정할 채널 글을 찾지 못했어요.', 'DRAFT_NOT_FOUND', 404)

  const payload = { ...previous.payload }
  for (const key of allowed[channel]) {
    const value = edits[key]
    if (typeof value === 'string') payload[key] = clean(value)
    else if (key === 'hashtags' && Array.isArray(value)) payload.hashtags = value.map(clean)
  }
  if (channel === 'naver_blog' && typeof edits.text === 'string') {
    payload.blocks = [{ type: 'paragraph', text: payload.text }]
  }
  const body = channel === 'instagram' ? payload.caption : payload.text
  // The generator may supply only blocks for older Naver drafts.
  if (channel === 'naver_blog' && typeof body !== 'string' && Array.isArray(payload.blocks)) {
    payload.text = payload.blocks.map(block => block && typeof block === 'object' && 'text' in block && typeof block.text === 'string' ? block.text : '').join('\n\n')
  }
  const media = Array.isArray(payload.media) ? payload.media.filter((item): item is MediaItem => !!item && typeof item === 'object' && (item.type === 'image' || item.type === 'video')) : []
  const spec = evaluateChannelSpec(channel, { ...payload, media } as ChannelVariantPayload)
  let context: Awaited<ReturnType<KnowledgeContextLoader>>
  try { context = await deps.loadContext(workspaceId) }
  catch { throw new ChannelDraftError('가게 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', 'KNOWLEDGE_UNAVAILABLE', 503) }
  if (!context || context.knowledgeVersion !== snapshot.knowledgeVersion) {
    throw new ChannelDraftError('가게 정보가 바뀌었어요. 새 글을 만든 뒤 다시 확인해 주세요.', 'EDIT_CONFLICT', 409)
  }
  const claims = deps.checkClaims(channel, payload, context)
  const failed = spec.checks.filter(check => check.status === 'FAIL')
  const uncertain = spec.checks.filter(check => check.status === 'UNKNOWN')
  const caption = channel === 'instagram' ? payload.caption : payload.text
  const title = channel === 'naver_blog' ? payload.title : snapshot.draft.topic
  // Vault storage has a stricter immutable 2,200-character caption limit than blog/Daangn guidance.
  const materialisable = typeof caption === 'string' && !!caption.trim() && caption.length <= 2200
    && typeof title === 'string' && !!title.trim() && title.length <= 200
    && (!Array.isArray(payload.hashtags) || payload.hashtags.length <= 30)
  const materialIssue = '보관하려면 제목과 본문을 확인하고 본문을 2,200자 이내로 줄여 주세요.'
  const status: VariantStatus = failed.length || !materialisable ? 'NEEDS_FIX' : claims.status === 'UNKNOWN' || uncertain.length ? 'NEEDS_CHECK' : 'READY'
  const issues = [...failed.map(check => check.userMessage), ...(!materialisable ? [materialIssue] : []), ...claims.issues, ...uncertain.map(check => check.userMessage)]
  const statusLabel = status === 'READY' ? '보관할 수 있어요' : status === 'NEEDS_FIX' ? '수정이 필요해요' : '사실 확인이 필요해요'
  const savable = status === 'READY'
  const next = {
    ...previous, payload, status, statusLabel, issues,
    contentId: savable ? previous.contentId : null, versionId: null,
    vaultSavable: savable,
    blockedReason: savable ? null : issues[0] || '내용을 확인한 뒤 다시 보관해 주세요.',
  }
  try {
    const updated = await deps.repo.updateVariant(workspaceId, requestKey, channel, previous, next, userId)
    if (!updated) throw new ChannelDraftError('다른 수정이 먼저 저장됐어요. 새로고침 후 다시 시도해 주세요.', 'EDIT_CONFLICT', 409)
    return updated
  } catch (error) {
    if (error instanceof ChannelDraftError) throw error
    throw new ChannelDraftError('수정 내용을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.', 'PERSISTENCE_FAILED', 503)
  }
}
