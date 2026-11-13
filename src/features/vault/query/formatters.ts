import type {
  VaultApprovalState,
  VaultChannel,
  VaultHoldReason,
  VaultItem,
} from '../types'
import type { VaultItemAdminDto, VaultItemUserDto } from './types'

export const VAULT_STATUS_LABELS: Record<VaultApprovalState, string> = {
  APPROVED: '발행 준비 완료 · 외부 게시 전',
  NEEDS_REAPPROVAL: '재확인 필요',
  INVALIDATED: '승인이 풀렸어요',
}

export const VAULT_HOLD_REASON_LABELS: Record<Exclude<VaultHoldReason, null>, string> = {
  META_REVIEW_PENDING: 'Meta 앱 심사 대기',
  CHANNEL_NOT_CONNECTED: '채널 연결 필요',
  USER_HELD: '사용자 보류',
  RELEASE_REQUESTED: '게시 대기 중',
  REAPPROVAL_REQUIRED: '재승인 필요',
}

export const VAULT_PUBLISH_OUTCOME_LABELS = {
  published: '게시 완료',
  needs_check: '게시 여부 확인 필요',
  failed: '게시하지 못했어요',
} as const

export const VAULT_CHANNEL_LABELS: Record<VaultChannel, string> = {
  instagram: '인스타그램',
  threads: '스레드',
  naver_blog: '네이버 블로그',
  daangn_business: '당근 비즈니스',
}

export function formatStatusLabel(state: VaultApprovalState): string {
  return VAULT_STATUS_LABELS[state] ?? '미확인 상태'
}

export function formatHoldReasonLabel(reason: VaultHoldReason, releaseGate?: VaultItem['releaseGate']): string | null {
  if (!reason) return null
  if (reason === 'META_REVIEW_PENDING' && releaseGate !== undefined && releaseGate !== 'HELD_PROVIDER_PENDING') return '발행 상태를 다시 확인해 주세요'
  return VAULT_HOLD_REASON_LABELS[reason] ?? '상태를 확인해 주세요'
}

export function formatChannelLabel(channel: VaultChannel): string {
  return VAULT_CHANNEL_LABELS[channel] ?? '채널 확인 필요'
}

/** Creates an opaque public reference without leaking raw identifiers. */
function createOpaqueItemRef(id: string): string {
  try {
    const hex = id.replace(/-/g, '')
    return Buffer.from(hex, 'hex').toString('base64url')
  } catch {
    return Buffer.from(id).toString('base64url')
  }
}

export function toUserVaultItemDto(item: VaultItem): VaultItemUserDto {
  return {
    item_ref: createOpaqueItemRef(item.id),
    channel: item.channel,
    channel_label: formatChannelLabel(item.channel),
    status_label: item.releaseGate === null && !item.deletedAt ? VAULT_PUBLISH_OUTCOME_LABELS.published : formatStatusLabel(item.approvalState),
    hold_reason_label: formatHoldReasonLabel(item.holdReason, item.releaseGate),
    target_date: item.targetDate,
    held_at: item.heldAt,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  }
}

export function toAdminVaultItemDto(item: VaultItem): VaultItemAdminDto {
  return {
    ...item,
    channelLabel: formatChannelLabel(item.channel),
    statusLabel: item.releaseGate === null && !item.deletedAt ? VAULT_PUBLISH_OUTCOME_LABELS.published : formatStatusLabel(item.approvalState),
    holdReasonLabel: formatHoldReasonLabel(item.holdReason, item.releaseGate),
  }
}
