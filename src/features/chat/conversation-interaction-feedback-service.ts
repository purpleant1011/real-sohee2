import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { computeApprovalFingerprint } from '@/features/engagement/draft'
import { computeDmApprovalFingerprint } from '@/features/engagement/dm/options-generator'
import {
  parseInteractionDraftSnapshot,
  type InteractionDraftCardData,
} from '@/features/engagement/interaction-draft-contract'

export type FeedbackChannel = 'instagram' | 'threads'
export type FeedbackTopic = 'reservation' | 'pricing' | 'all'

export interface FeedbackFilter {
  channel?: FeedbackChannel
  topic?: FeedbackTopic
}

export interface FeedbackRequestInput {
  workspaceId: string
  filter?: FeedbackFilter
  now?: string
}

export interface FeedbackInboxItem {
  id: string
  targetKind: 'comment' | 'dm'
  channel: FeedbackChannel
  text: string
  customerLabel?: string
  authorLabel?: string
  createdAt?: string
  sourceRef?: string
  draftId?: string
  existingDraftText?: string
}

export interface FeedbackGatewayInboxData {
  items?: readonly FeedbackInboxItem[]
  reviews?: readonly {
    id: string
    channel: FeedbackChannel
    authorName?: string
    commentText: string
    createdAt?: string
    sourceFingerprint?: string
    status?: string
  }[]
  dmThreads?: readonly {
    id: string
    channel?: FeedbackChannel
    customerLabel?: string
    lastMessageText?: string
    latestCustomerMessageId?: string | null
    lastMessageAt?: string
    status?: string
    draft?: { id: string; text: string } | null
  }[]
}

export interface FeedbackGateway {
  loadInbox(params: {
    workspaceId: string
    channel?: FeedbackChannel
    topic?: FeedbackTopic
    now?: string
  }): Promise<readonly FeedbackInboxItem[] | FeedbackGatewayInboxData>
  generateDraftText?(item: FeedbackInboxItem, topic: FeedbackTopic): Promise<string> | string
  businessName?: string
  reservationUrl?: string
}

export interface InteractionFeedbackResult {
  feedbackSummary: string
  totalCount: number
  filteredCount: number
  drafts: InteractionDraftCardData[]
}

const uuidSchema = z.string().uuid()
const hex64Regex = /^[a-f0-9]{64}$/u

const RESERVATION_PATTERN =
  /(예약|일정|방문|자리|룸|테이블|몇시|시간|날짜|주말|영업|가도 되나요|예약되나요|예약 가능|reservation|booking)/i
const PRICING_PATTERN = /(가격|얼마|비용|단가|요금|금액|할인|메뉴|price|cost)/i

export function isFeedbackTopicMatch(text: string, topic?: FeedbackTopic): boolean {
  if (!topic || topic === 'all') return true
  if (topic === 'reservation') return RESERVATION_PATTERN.test(text)
  if (topic === 'pricing') return PRICING_PATTERN.test(text)
  return true
}

function ensureUuid(value: string | undefined): string {
  if (value && uuidSchema.safeParse(value).success) return value
  return randomUUID()
}

function isInboxArray(
  val: readonly FeedbackInboxItem[] | FeedbackGatewayInboxData
): val is readonly FeedbackInboxItem[] {
  return Array.isArray(val)
}

function normalizeInboxItems(
  raw: readonly FeedbackInboxItem[] | FeedbackGatewayInboxData
): FeedbackInboxItem[] {
  if (isInboxArray(raw)) {
    return [...raw]
  }

  const data = raw
  const items: FeedbackInboxItem[] = []

  if (data.items && Array.isArray(data.items)) {
    items.push(...data.items)
  }

  if (data.reviews && Array.isArray(data.reviews)) {
    for (const review of data.reviews) {
      items.push({
        id: review.id,
        targetKind: 'comment',
        channel: review.channel,
        text: review.commentText,
        customerLabel: review.authorName,
        sourceRef: review.sourceFingerprint,
        createdAt: review.createdAt,
      })
    }
  }

  if (data.dmThreads && Array.isArray(data.dmThreads)) {
    for (const dm of data.dmThreads) {
      items.push({
        id: dm.id,
        targetKind: 'dm',
        channel: 'instagram',
        text: dm.lastMessageText || '',
        customerLabel: dm.customerLabel,
        sourceRef: dm.latestCustomerMessageId ?? undefined,
        draftId: dm.draft?.id,
        existingDraftText: dm.draft?.text,
        createdAt: dm.lastMessageAt,
      })
    }
  }

  return items
}

function generateDefaultDraftText(params: {
  item: FeedbackInboxItem
  topic: FeedbackTopic
  businessName?: string
}): string {
  const label = params.item.customerLabel || params.item.authorLabel || '고객'
  const prefix = `안녕하세요 @${label}님!`

  if (params.topic === 'reservation') {
    return `${prefix} 예약 문의 남겨주셔서 감사드립니다. 원하시는 일정과 인원을 프로필 링크(예약하기) 또는 메시지로 남겨주시면 확인 후 빠르게 예약 안내 도와드리겠습니다. 편안한 방문 되시길 바랍니다! 😊`
  }

  if (params.topic === 'pricing') {
    return `${prefix} 가격 및 메뉴 문의 남겨주셔서 감사드립니다. 자세한 메뉴별 가격과 구성은 프로필 링크의 메뉴판에서 확인 가능하시며, 추가로 궁금하신 점은 편하게 말씀해 주세요. 친절히 안내해 드리겠습니다! ✨`
  }

  return `${prefix} 소중한 문의 남겨주셔서 감사드립니다. 남겨주신 내용 확인하였으며, 편안하게 이용하실 수 있도록 정성을 다해 안내해 드리겠습니다. 궁금하신 점은 언제든 말씀해 주세요! 🌸`
}

/**
 * Orchestrates incoming Instagram/Threads comments and DMs, classifies intents,
 * filters relevant inquiries (e.g. reservations, pricing), and prepares draft cards (InteractionDraftCardData).
 *
 * NOTE: Draft replies are generated in DRAFT state and require explicit owner review approval via UI cards.
 * Natural language chat execution alone will never transmit messages externally without confirmation.
 */
export async function processInteractionFeedbackRequest(
  input: FeedbackRequestInput,
  gateway: FeedbackGateway
): Promise<InteractionFeedbackResult> {
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const channelFilter = input.filter?.channel
  const topicFilter = input.filter?.topic || 'all'
  const preparedAt = input.now ? new Date(input.now).toISOString() : new Date().toISOString()

  // 1. Load inbox items via gateway
  const rawInbox = await gateway.loadInbox({
    workspaceId,
    channel: channelFilter,
    topic: topicFilter,
    now: input.now,
  })

  const allItems = normalizeInboxItems(rawInbox)

  // Filter by channel if requested
  const channelFilteredItems = channelFilter
    ? allItems.filter(item => {
        if (channelFilter === 'threads') {
          return item.channel === 'threads' && item.targetKind === 'comment'
        }
        return item.channel === channelFilter
      })
    : allItems

  const totalCount = channelFilteredItems.length

  // 2. Filter by topic
  const topicFilteredItems = channelFilteredItems.filter(item =>
    isFeedbackTopicMatch(item.text, topicFilter)
  )
  const filteredCount = topicFilteredItems.length

  if (totalCount === 0 || filteredCount === 0) {
    const topicLabel =
      topicFilter === 'reservation' ? '예약 문의' : topicFilter === 'pricing' ? '가격 문의' : '문의'
    return {
      feedbackSummary:
        totalCount === 0
          ? '수신된 고객 문의가 없습니다.'
          : `총 ${totalCount}건의 문의 중 ${topicLabel}에 해당하는 문의가 없습니다.`,
      totalCount,
      filteredCount: 0,
      drafts: [],
    }
  }

  // 3 & 4. Generate draft text and prepare InteractionDraftCardData snapshots
  const drafts: InteractionDraftCardData[] = []

  for (const item of topicFilteredItems) {
    const targetId = ensureUuid(item.id)
    const draftId = ensureUuid(item.draftId)
    const cardId = draftId

    let draftText: string
    let reused = false

    if (gateway.generateDraftText) {
      draftText = await gateway.generateDraftText(item, topicFilter)
    } else if (item.existingDraftText) {
      draftText = item.existingDraftText
      reused = true
    } else {
      draftText = generateDefaultDraftText({
        item,
        topic: topicFilter,
        businessName: gateway.businessName,
      })
    }

    const customerLabel = (item.customerLabel || item.authorLabel || '문의 고객').slice(0, 300)

    let fingerprint: string
    let sourceRef: string

    if (item.targetKind === 'comment') {
      fingerprint = computeApprovalFingerprint(workspaceId, targetId, draftText)
      sourceRef =
        item.sourceRef && hex64Regex.test(item.sourceRef)
          ? item.sourceRef
          : computeApprovalFingerprint(workspaceId, targetId, item.text)

      const draftCard: InteractionDraftCardData = {
        id: cardId,
        kind: 'interaction_draft',
        workspaceId,
        targetId,
        draftId,
        targetKind: 'comment',
        channel: item.channel,
        draftText,
        fingerprint,
        sourceRef,
        customerLabel,
        preparedAt,
        reused,
        requiresUserApproval: true,
      }

      // Schema verification ensures compatibility with canonical contract
      parseInteractionDraftSnapshot(draftCard, workspaceId)
      drafts.push(draftCard)
    } else {
      fingerprint = computeDmApprovalFingerprint(workspaceId, targetId, draftText)
      sourceRef = ensureUuid(item.sourceRef)

      const draftCard: InteractionDraftCardData = {
        id: cardId,
        kind: 'interaction_draft',
        workspaceId,
        targetId,
        draftId,
        targetKind: 'dm',
        channel: 'instagram',
        draftText,
        fingerprint,
        sourceRef,
        customerLabel,
        preparedAt,
        reused,
        requiresUserApproval: true,
      }

      // Schema verification ensures compatibility with canonical contract
      parseInteractionDraftSnapshot(draftCard, workspaceId)
      drafts.push(draftCard)
    }
  }

  // 5. Construct feedback summary with strict draft-only & human-approval notice
  const topicLabel =
    topicFilter === 'reservation' ? '예약 문의' : topicFilter === 'pricing' ? '가격 문의' : '고객 문의'

  const channelLabel =
    channelFilter === 'instagram'
      ? '인스타그램'
      : channelFilter === 'threads'
        ? '스레드'
        : 'SNS'

  const feedbackSummary =
    `오늘 수신된 ${channelLabel} ${topicLabel} 총 ${totalCount}건 중 ${filteredCount}건을 선별하여 맞춤형 답변 초안(DRAFT)을 준비했습니다.\n\n` +
    `⚠️ [발송 전 필수 확인]:\n` +
    `준비된 답변은 현재 초안 상태이며 고객에게 즉시 전송되지 않습니다. ` +
    `아래 대화 검토 카드의 [최신 원문과 답안 확인]을 통해 내용을 검토하신 후 [이 문안으로 발송] 버튼을 눌러야 최종 전달됩니다.`

  return {
    feedbackSummary,
    totalCount,
    filteredCount,
    drafts,
  }
}
