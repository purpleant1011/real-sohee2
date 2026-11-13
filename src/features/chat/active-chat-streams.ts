const activeStreams = new Map<string, AbortController>()

export function registerActiveChatStream(messageId: string, controller: AbortController) {
  activeStreams.set(messageId, controller)
}

export function unregisterActiveChatStream(messageId: string, controller: AbortController) {
  if (activeStreams.get(messageId) === controller) activeStreams.delete(messageId)
}

export function abortActiveChatStream(messageId: string): boolean {
  const controller = activeStreams.get(messageId)
  if (!controller) return false
  controller.abort()
  activeStreams.delete(messageId)
  return true
}
