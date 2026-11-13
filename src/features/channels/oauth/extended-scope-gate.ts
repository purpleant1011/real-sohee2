export interface ExtendedMetaScopeGateInput {
  workspaceId?: string | null
  role?: string | null
  env?: Record<string, string | undefined>
  extended?: boolean | string | null
  extendedRequested?: boolean | string | null
}

/**
 * Pure function determining whether extended Meta OAuth scopes (comments, DM, insights, replies)
 * are allowed for this connect request.
 *
 * Requirements:
 * 1. If env META_EXTENDED_SCOPES_FOR_ALL=1 is set, ALL connects request extended scopes by default.
 * 2. Otherwise, extended scopes are requested ONLY when:
 *    - connect request explicitly carries extended=1 (or true)
 *    - caller role is 'owner' or 'manager'
 *    - workspaceId is present in env META_EXTENDED_SCOPE_WORKSPACE_IDS (comma-separated UUIDs)
 * 3. Default (no env) = unchanged behavior for every user (returns false).
 */
export function isExtendedMetaScopeAllowed(input: ExtendedMetaScopeGateInput): boolean {
  const env = input.env ?? process.env
  const forAll =
    env.META_EXTENDED_SCOPES_FOR_ALL === '1' ||
    env.NEXT_PUBLIC_META_EXTENDED_SCOPES_FOR_ALL === '1'
  if (forAll) {
    return true
  }

  const rawExtended = input.extended ?? input.extendedRequested
  const isExtendedRequested =
    rawExtended === true || rawExtended === '1' || rawExtended === 'true'
  if (!isExtendedRequested) {
    return false
  }

  const role = input.role?.trim().toLowerCase()
  if (role !== 'owner' && role !== 'manager') {
    return false
  }

  const workspaceId = input.workspaceId?.trim()
  if (!workspaceId) {
    return false
  }

  const rawAllowlist =
    env.META_EXTENDED_SCOPE_WORKSPACE_IDS ||
    env.NEXT_PUBLIC_META_EXTENDED_SCOPE_WORKSPACE_IDS ||
    ''
  const allowedIds = new Set(
    rawAllowlist
      .split(',')
      .map((id) => id.trim().toLowerCase())
      .filter(Boolean),
  )

  return allowedIds.has(workspaceId.toLowerCase())
}

/**
 * Helper to check whether a workspace/role is eligible to request extended scopes.
 */
export function canRequestExtendedMetaScope(
  input: Omit<ExtendedMetaScopeGateInput, 'extended' | 'extendedRequested'>,
): boolean {
  return isExtendedMetaScopeAllowed({ ...input, extended: true })
}
