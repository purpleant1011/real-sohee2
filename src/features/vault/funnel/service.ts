import { validateVaultFunnelPayload } from './schema'
import type { VaultFunnelEventInput } from './types'

type AdminClient = {
  from: (table: string) => {
    upsert: (
      row: Record<string, unknown>,
      options: { onConflict: string; ignoreDuplicates: boolean },
    ) => Promise<{ error: { message?: string } | null }>
  }
}

export function generateVaultFunnelDedupeKey(input: VaultFunnelEventInput): string {
  if (input.dedupeKey?.trim()) {
    return input.dedupeKey.trim()
  }

  const p = input.properties ?? {}
  const targetId = p.vaultItemId ?? p.contentId ?? 'none'
  const subKey = p.idempotencyKey ?? p.fingerprint ?? p.versionId ?? 'default'

  // Deterministic, structured key:
  // <event>:<channel>:<targetId>:<subKey>
  return `${input.event}:${input.channel}:${targetId}:${subKey}`
}

export async function recordVaultFunnelEvent(
  input: VaultFunnelEventInput,
  deps: { admin: AdminClient },
): Promise<{ success: boolean; dedupeKey: string }> {
  // Enforce privacy-safe invariant: throws immediately if title/body/personal info included
  const validatedProps = validateVaultFunnelPayload({
    channel: input.channel,
    ...input.properties,
  })

  const dedupeKey = generateVaultFunnelDedupeKey(input)

  try {
    const { error } = await deps.admin.from('funnel_events').upsert(
      {
        workspace_id: input.workspaceId,
        user_id: input.userId,
        event: input.event,
        properties: validatedProps,
        dedupe_key: dedupeKey,
      },
      {
        onConflict: 'workspace_id,event,dedupe_key',
        ignoreDuplicates: true,
      },
    )

    if (error) {
      console.warn(`[vault-funnel] write failed for ${input.event}:`, error.message)
      return { success: false, dedupeKey }
    }

    return { success: true, dedupeKey }
  } catch (err) {
    console.warn(`[vault-funnel] exception recording ${input.event}:`, err)
    return { success: false, dedupeKey }
  }
}
