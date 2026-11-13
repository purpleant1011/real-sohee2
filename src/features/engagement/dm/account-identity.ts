import type { MetaInstagramProfileIds } from '@/lib/providers/meta-api'

export interface ResolveBusinessIdDeps {
  getProfileIds: (input: { accessToken: string }) => Promise<MetaInstagramProfileIds>
  /** Persist the corrected id. Must resolve `{ ok: false }` (not throw) on a unique-constraint conflict. */
  updateExternalAccountId: (input: { workspaceId: string; connectionId: string; externalAccountId: string }) => Promise<{ ok: boolean }>
}

export type ResolveBusinessIdResult =
  | { status: 'ok'; businessIgId: string; repaired: boolean }
  | { status: 'unavailable'; reason: 'profile_lookup_failed' | 'no_professional_id' }

/**
 * The webhook `entry.id` and the messaging API `to.id` are the Instagram professional account id
 * (`user_id`). Connections created before this fix stored the app-scoped `id` (or nothing), so ask Meta
 * and heal the stored value. Never throws: callers skip the connection when unavailable.
 */
export async function resolveInstagramBusinessId(
  input: { workspaceId: string; connectionId: string; storedExternalAccountId: string | null; accessToken: string },
  deps: ResolveBusinessIdDeps,
): Promise<ResolveBusinessIdResult> {
  let ids: MetaInstagramProfileIds
  try {
    ids = await deps.getProfileIds({ accessToken: input.accessToken })
  } catch {
    return { status: 'unavailable', reason: 'profile_lookup_failed' }
  }
  if (!ids.professionalId) return { status: 'unavailable', reason: 'no_professional_id' }
  if (input.storedExternalAccountId === ids.professionalId) {
    return { status: 'ok', businessIgId: ids.professionalId, repaired: false }
  }
  let repaired = false
  try {
    repaired = (await deps.updateExternalAccountId({
      workspaceId: input.workspaceId,
      connectionId: input.connectionId,
      externalAccountId: ids.professionalId,
    })).ok
  } catch {
    repaired = false
  }
  // Even when the write is refused (e.g. the id is already bound to another connection),
  // the API-reported id is the right one for matching this account's messages.
  return { status: 'ok', businessIgId: ids.professionalId, repaired }
}
