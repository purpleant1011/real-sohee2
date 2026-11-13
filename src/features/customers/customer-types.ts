/**
 * Sohee V0.85 Customer Reaction & Booking Data Types
 * Aligned with Doc 03: Customer Journey & Inbox Workspace
 */

export type ChannelSource = 'instagram' | 'threads' | 'naver_blog' | 'naver_place' | 'daangn'

export type ConversationStage = 'unread' | 'consulting' | 'booking_pending' | 'booked' | 'resolved'

export type PriorityLevel = 'urgent' | 'high' | 'normal' | 'low'

export type ResponseToneVariant = 'fast_short' | 'warm_friendly' | 'booking_focused'

export type CustomerInteraction = {
  id: string
  channel: ChannelSource
  customerName: string
  customerHandle?: string
  avatarUrl?: string
  lastMessage: string
  lastMessageAt: string
  waitingMinutes: number
  priority: PriorityLevel
  stage: ConversationStage
  interestedService?: string
  bookingIntentScore: number // 0 ~ 100
  suggestedDrafts: Record<ResponseToneVariant, {
    text: string
    intentLabel: string
    action?: 'send' | 'send_and_book'
  }>
  history: Array<{
    sender: 'customer' | 'owner' | 'sohee'
    text: string
    timestamp: string
  }>
  customerUuid?: string | null
}
