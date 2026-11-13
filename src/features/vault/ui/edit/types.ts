import type {
  VaultApprovalState,
  VaultChannel,
  VaultReleaseGate,
} from '@/features/vault/types'

export const CHANNEL_DISPLAY_NAMES: Record<VaultChannel, string> = {
  instagram: '인스타그램',
  threads: '스레드',
  naver_blog: '네이버 블로그',
  daangn_business: '당근 비즈니스',
}

export interface OtherChannelState {
  channel: VaultChannel
  channelLabel: string
  approvalState: VaultApprovalState
}

export interface VaultEditResult {
  updated_at: string
  item_ref: string
  status_label: string
  message: string
}

export interface VaultEditChangesPayload {
  title?: string
  text?: string
  hashtags?: string[]
  settings?: {
    category: string | null
    visibility: string
    coupon: string | null
  }
  targetDate?: string | null
}

export interface ReapproveButtonProps {
  workspaceId: string
  itemRef: string
  version: string
  onSuccess?: (result: VaultEditResult) => void
  onError?: (errorMessage: string, status?: number) => void
  fetchFn?: typeof fetch
  disabled?: boolean
  className?: string
  size?: 'default' | 'sm' | 'lg'
  showInlineError?: boolean
}

export interface HoldToggleProps {
  workspaceId: string
  itemRef: string
  version: string
  releaseGate: VaultReleaseGate
  onSuccess?: (result: VaultEditResult) => void
  onError?: (errorMessage: string, status?: number) => void
  fetchFn?: typeof fetch
  disabled?: boolean
  className?: string
  showInlineError?: boolean
}

export interface DeleteRestoreControlProps {
  workspaceId: string
  itemRef: string
  version: string
  isDeleted: boolean
  onSuccess?: (result: VaultEditResult) => void
  onError?: (errorMessage: string, status?: number) => void
  fetchFn?: typeof fetch
  disabled?: boolean
  className?: string
  showInlineError?: boolean
}

export interface VaultItemEditorProps {
  workspaceId: string
  itemRef: string
  version: string
  channel: VaultChannel
  channelLabel?: string
  initialTitle?: string
  initialText?: string
  initialHashtags?: string[]
  initialTargetDate?: string | null
  initialApprovalState?: VaultApprovalState
  initialReleaseGate?: VaultReleaseGate
  initialDeletedAt?: string | null
  otherChannels?: OtherChannelState[]
  onSuccess?: (result: VaultEditResult) => void
  onError?: (errorMessage: string, status?: number) => void
  fetchFn?: typeof fetch
  className?: string
}
