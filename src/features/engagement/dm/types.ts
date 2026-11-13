export type InstagramDmStatus =
  | 'NEEDS_REPLY'
  | 'NEEDS_CHECK'
  | 'SENT'
  | 'DISMISSED'
  | 'EXPIRED'

export interface InstagramDmDirectionOption {
  id: string
  label: string
  draftText: string
}

export interface InstagramDmThread {
  id: string
  workspace_id: string
  channel_connection_id: string
  channel: 'instagram'
  provider_thread_id: string
  customer_id: string
  customer_handle: string
  customer_name: string | null
  last_message_at: string
  expires_at: string
  status: InstagramDmStatus
  last_message_text: string
  created_at: string
  updated_at: string
}

export interface InstagramDmMessage {
  id: string
  workspace_id: string
  thread_id: string
  provider_message_id: string
  sender_type: 'customer' | 'business'
  sender_id: string
  text: string
  sent_at: string
  created_at: string
}

export interface InstagramDmDraft {
  id: string
  workspace_id: string
  thread_id: string
  selected_option_id: string | null
  options: InstagramDmDirectionOption[]
  draft_text: string
  approved_fingerprint: string | null
  approved_by: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

export interface InstagramDmThreadItem extends InstagramDmThread {
  channel_label: string
  account_label?: string | null
  status_label: string
  countdown_text: string
  is_expired: boolean
  remaining_seconds: number
  draft: InstagramDmDraft | null
  messages?: InstagramDmMessage[]
}

export interface InstagramDmThreadsResponse {
  items: InstagramDmThreadItem[]
  nextCursor?: string
  send_enabled: boolean
}

/**
 * 외부(Instagram) 전송 결과와 로컬 저장 결과를 분리한다.
 * providerOutcome은 프로바이더가 실제로 무엇을 확인했는지, localOutcome은 우리 저장소가 무엇을 남겼는지를 뜻한다.
 */
export type DmProviderOutcome =
  | 'NOT_ATTEMPTED'
  | 'DELIVERY_FAILED'
  | 'DELIVERY_UNKNOWN'
  | 'ACCEPTED_BUT_UNVERIFIED'
  | 'READBACK_VERIFIED'

export type DmLocalOutcome =
  | 'NOT_STARTED'
  | 'RECORDED'
  | 'RECONCILIATION_REQUIRED'
  | 'PERSISTENCE_FAILED'

export interface InstagramDmSendResult {
  /** true는 이번 호출에서 전송이 독립 readback으로 확인된 경우에만 사용한다. */
  sent: boolean
  status: InstagramDmStatus
  providerMessageId?: string
  reason?: string
  providerOutcome?: DmProviderOutcome
  localOutcome?: DmLocalOutcome
  actionRequestId?: string
  attemptId?: string
}

export interface InstagramDmAudit {
  id: string
  workspace_id: string
  thread_id: string | null
  actor: 'owner' | 'manager' | 'system'
  actor_user_id: string | null
  action: 'manual_send' | 'dismiss' | 'select_option' | 'edit_draft' | 'generate_draft'
  provider_message_id: string | null
  readback_verified: boolean
  /** 개인정보 보호: 문안 원문 및 고객 식별자 저장 금지 (draftFingerprint, draftLength 등 메타데이터만 허용) */
  details: Record<string, unknown>
  created_at: string
}
