export function isKnowledgeFactCurrent(fact: { validFrom?: string | null; validUntil?: string | null }, observedAt: string): boolean {
  const now = Date.parse(observedAt)
  if (!Number.isFinite(now)) return false
  const from = fact.validFrom == null ? null : Date.parse(fact.validFrom)
  const until = fact.validUntil == null ? null : Date.parse(fact.validUntil)
  if ((from !== null && !Number.isFinite(from)) || (until !== null && !Number.isFinite(until))) return false
  return (from === null || from <= now) && (until === null || until > now)
}
