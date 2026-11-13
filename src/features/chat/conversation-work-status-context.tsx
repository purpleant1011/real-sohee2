'use client'

import { createContext, useContext } from 'react'
import type { ConversationWorkStatus } from './conversation-work-status'

export const ConversationWorkStatusContext = createContext<ConversationWorkStatus | null>(null)

export function useConversationWorkStatus() {
  return useContext(ConversationWorkStatusContext)
}
