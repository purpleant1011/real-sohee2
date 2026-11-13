type OrderedMessage = Readonly<{ id: string; createdAt: string; role: 'user' | 'sohee' | 'system_event' }>
const roleOrder = { user: 0, sohee: 1, system_event: 2 } as const

/** Enqueued question/answer pairs can share a database transaction timestamp. */
export function compareConversationMessages(left: OrderedMessage, right: OrderedMessage): number {
  return left.createdAt.localeCompare(right.createdAt)
    || roleOrder[left.role] - roleOrder[right.role]
    || left.id.localeCompare(right.id)
}
