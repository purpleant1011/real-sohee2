import type { QuickPostSummary } from '@/features/quick-start/quick-post-service'
import type { QuickPostApprovalTarget } from '@/features/quick-start/quick-post-vault-contract'
import type { ReadinessView } from '@/features/readiness'
import {
  CONNECTION_IDENTITY_MISSING,
  CONNECTION_IDENTITY_MISSING_MESSAGE,
} from '@/features/channels/constants'

export interface ChannelTargetView {
  channel: 'instagram' | 'threads'
  name: string
  handle: string | null
  contentId: string | null
  versionId: string | null
  publishAllowed: boolean
  publishReason: string | null
  publishReasonCode?: string | null
  reconnectRequired?: boolean
  reconnectUrl?: string
  vaultAllowed: boolean
  specLabel?: string
}

export interface DelegationScopeView {
  goal: string
  serviceScope: string[]
  allowedActions: string[]
  forbiddenActions: string[]
  costCredits?: number
  approvalRequired: boolean
  observationWindowDays?: number
  targetChannels: string[]
}

export interface FirstValueView {
  summary: string
  action: 'VAULT' | 'PUBLISH'
  actionLabel: '승인하고 보관' | '승인하고 발행'
  targetChannelsText?: string
  message: string
  progressPercent: number
  contentId: string | null
  versionId: string | null
  targetChannels: Array<'instagram' | 'threads'>
  channelViews?: ChannelTargetView[]
  excludedChannels: Array<{
    channel: 'instagram' | 'threads'
    name: string
    reason: string
    reasonCode?: string
    reconnectRequired?: boolean
    reconnectUrl?: string
  }>
  liveRolloutBlocked?: boolean
  liveRolloutNotice?: string
  delegationScope?: DelegationScopeView
}

export const LIVE_ROLLOUT_BLOCKED_MESSAGE =
  '실제 게시는 곧 열릴 예정이에요. 지금은 글을 보관함에 안전하게 담아 둘게요.'

const CHANNEL_NAMES: Record<'instagram' | 'threads', string> = {
  instagram: '인스타그램',
  threads: '스레드',
}

/** Server approval policy decides the CTA; the client never infers publishability from a handle. */
export function buildFirstValueView(
  item: Pick<QuickPostSummary, 'businessName'>,
  readiness: Pick<ReadinessView, 'progressPercent'>,
  options: {
    target?: Pick<QuickPostApprovalTarget, 'contentId' | 'versionId' | 'actions'>
    targets?: Array<Pick<QuickPostApprovalTarget, 'channel' | 'contentId' | 'versionId' | 'actions' | 'handle' | 'specLabel' | 'reasonCode'>>
    connectedChannels?: Array<{ provider: string; handle?: string }>
    industry?: string | null
    location?: string | null
    summary?: string | null
    liveRolloutBlocked?: boolean
    delegationScope?: DelegationScopeView
  }
): FirstValueView {
  const summary = [item.businessName, options.industry, options.location, options.summary]
    .filter((v): v is string => typeof v === 'string' && Boolean(v.trim()))
    .join(' · ')

  const isRolloutBlocked = Boolean(options.liveRolloutBlocked)
  const delegationScope = options.delegationScope

  // Single-target backward-compatibility mode
  if (options.target && !options.targets) {
    const rawPublish = options.target.actions.PUBLISH.allowed
    const publish = !isRolloutBlocked && rawPublish
    const vault = options.target.actions.VAULT.allowed
    return {
      summary,
      action: publish ? 'PUBLISH' : 'VAULT',
      actionLabel: publish ? '승인하고 발행' : '승인하고 보관',
      message: '승인 전에는 아무것도 게시되지 않아요',
      progressPercent: readiness.progressPercent,
      contentId: vault || rawPublish ? options.target.contentId : null,
      versionId: vault || rawPublish ? options.target.versionId : null,
      targetChannels: publish ? ['threads'] : [],
      excludedChannels: isRolloutBlocked
        ? [
            {
              channel: 'threads',
              name: '스레드',
              reason: LIVE_ROLLOUT_BLOCKED_MESSAGE,
              reasonCode: 'WORKSPACE_NOT_IN_LIVE_ROLLOUT',
            },
          ]
        : [],
      liveRolloutBlocked: isRolloutBlocked ? true : undefined,
      liveRolloutNotice: isRolloutBlocked ? LIVE_ROLLOUT_BLOCKED_MESSAGE : undefined,
      delegationScope,
    }
  }

  // Multi-target evaluation
  const targets = options.targets || []
  const connectedProviders = (options.connectedChannels || []).map((c) => c.provider)

  const targetChannels: Array<'instagram' | 'threads'> = []
  const excludedChannels: Array<{
    channel: 'instagram' | 'threads'
    name: string
    reason: string
    reasonCode?: string
    reconnectRequired?: boolean
    reconnectUrl?: string
  }> = []
  const channelViews: ChannelTargetView[] = []

  for (const t of targets) {
    const ch = t.channel as 'instagram' | 'threads'
    const name = CHANNEL_NAMES[ch] || ch
    const rawPublishAllowed = t.actions.PUBLISH.allowed
    const publishAllowed = !isRolloutBlocked && rawPublishAllowed
    const vaultAllowed = t.actions.VAULT.allowed
    const rawPublishReason = t.actions.PUBLISH.message || null
    const targetReasonCode = (t as any).reasonCode ?? null
    const isIdentityMissing =
      targetReasonCode === CONNECTION_IDENTITY_MISSING ||
      rawPublishReason === CONNECTION_IDENTITY_MISSING_MESSAGE
    const reconnectUrl = `/api/channels/${ch}/connect?returnPath=/start/preview`

    const publishReason = isRolloutBlocked ? LIVE_ROLLOUT_BLOCKED_MESSAGE : rawPublishReason

    const channelView: ChannelTargetView = {
      channel: ch,
      name,
      handle: t.handle,
      contentId: vaultAllowed || rawPublishAllowed ? t.contentId : null,
      versionId: vaultAllowed || rawPublishAllowed ? t.versionId : null,
      publishAllowed,
      publishReason,
      vaultAllowed,
      specLabel: t.specLabel,
    }
    if (isRolloutBlocked) {
      channelView.publishReasonCode = 'WORKSPACE_NOT_IN_LIVE_ROLLOUT'
      if (isIdentityMissing) {
        channelView.reconnectRequired = true
        channelView.reconnectUrl = reconnectUrl
      }
    } else if (isIdentityMissing) {
      channelView.publishReasonCode = CONNECTION_IDENTITY_MISSING
      channelView.reconnectRequired = true
      channelView.reconnectUrl = reconnectUrl
    } else if (targetReasonCode) {
      channelView.publishReasonCode = targetReasonCode
    }
    channelViews.push(channelView)

    const isConnected = connectedProviders.includes(ch) || rawPublishAllowed || isIdentityMissing
    if (publishAllowed) {
      targetChannels.push(ch)
    } else if (isConnected) {
      const excludedItem: FirstValueView['excludedChannels'][number] = {
        channel: ch,
        name,
        reason: publishReason || '게시 조건을 확인하지 못했어요',
      }
      if (isRolloutBlocked) {
        excludedItem.reasonCode = 'WORKSPACE_NOT_IN_LIVE_ROLLOUT'
        if (isIdentityMissing) {
          excludedItem.reconnectRequired = true
          excludedItem.reconnectUrl = reconnectUrl
        }
      } else if (isIdentityMissing) {
        excludedItem.reasonCode = CONNECTION_IDENTITY_MISSING
        excludedItem.reconnectRequired = true
        excludedItem.reconnectUrl = reconnectUrl
      } else if (targetReasonCode) {
        excludedItem.reasonCode = targetReasonCode
      }
      excludedChannels.push(excludedItem)
    }
  }

  const canPublishAny = targetChannels.length > 0
  const primaryTarget = targets.find((t) => t.actions.PUBLISH.allowed) || targets[0]
  const primaryVault = primaryTarget?.actions.VAULT.allowed
  const primaryPublish = primaryTarget?.actions.PUBLISH.allowed

  let targetChannelsText = ''
  if (targetChannels.includes('instagram') && targetChannels.includes('threads')) {
    targetChannelsText = '인스타그램 · 스레드에 올려요'
  } else if (targetChannels.includes('instagram')) {
    targetChannelsText = '인스타그램에 올려요'
  } else if (targetChannels.includes('threads')) {
    targetChannelsText = '스레드에 올려요'
  }

  return {
    summary,
    action: canPublishAny ? 'PUBLISH' : 'VAULT',
    actionLabel: canPublishAny ? '승인하고 발행' : '승인하고 보관',
    targetChannelsText: targetChannelsText || undefined,
    message: '승인 전에는 아무것도 게시되지 않아요',
    progressPercent: readiness.progressPercent,
    contentId: primaryVault || primaryPublish ? primaryTarget?.contentId ?? null : null,
    versionId: primaryVault || primaryPublish ? primaryTarget?.versionId ?? null : null,
    targetChannels,
    channelViews,
    excludedChannels,
    liveRolloutBlocked: isRolloutBlocked ? true : undefined,
    liveRolloutNotice: isRolloutBlocked ? LIVE_ROLLOUT_BLOCKED_MESSAGE : undefined,
    delegationScope,
  }
}
