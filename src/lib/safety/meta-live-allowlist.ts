/**
 * Meta Live Workspace Allowlist
 *
 * Implements fail-closed workspace staged rollout for real Meta (Instagram / Threads)
 * external writes (publishing, comment replies, direct messages).
 *
 * Client-safe pure module: no node: or server-only imports.
 * Reads process.env at call time.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface MetaLiveAllowlistParsed {
  isAll: boolean
  allowedUuids: Set<string>
  count: number
}

export function parseMetaLiveAllowlist(raw: string | null | undefined): MetaLiveAllowlistParsed {
  if (!raw) {
    return { isAll: false, allowedUuids: new Set(), count: 0 }
  }

  const trimmed = raw.trim()
  if (trimmed === '*') {
    return { isAll: true, allowedUuids: new Set(), count: 0 }
  }

  // Tokens separated by commas and/or whitespace
  const tokens = trimmed.split(/[\s,]+/).filter(Boolean)
  const allowedUuids = new Set<string>()

  for (const token of tokens) {
    if (UUID_REGEX.test(token)) {
      allowedUuids.add(token.toLowerCase())
    }
  }

  return {
    isAll: false,
    allowedUuids,
    count: allowedUuids.size,
  }
}

/**
 * Checks whether a given workspace is permitted to perform real Meta external actions.
 *
 * Fails closed:
 * - workspaceId must be a valid non-empty UUID string.
 * - If env is unset, empty, or contains no valid UUIDs (and is not '*'), returns false.
 * - If env is trimmed '*', returns true for any valid workspace UUID.
 * - Otherwise, matches exact UUID (case-insensitive) in the parsed allowlist.
 */
export function isMetaLiveAllowed(workspaceId: string | null | undefined): boolean {
  if (!workspaceId || typeof workspaceId !== 'string') {
    return false
  }

  const trimmedId = workspaceId.trim()
  if (!trimmedId) {
    return false
  }

  const raw = process.env.META_LIVE_WORKSPACE_ALLOWLIST
  const parsed = parseMetaLiveAllowlist(raw)

  if (parsed.isAll) {
    return true
  }

  if (!UUID_REGEX.test(trimmedId)) {
    return false
  }

  return parsed.allowedUuids.has(trimmedId.toLowerCase())
}

/**
 * Summarizes the current allowlist status for internal inspection without leaking IDs.
 */
export function getMetaLiveAllowlistStatus(): {
  live_allowlist_configured: boolean
  live_allowlist_all: boolean
  live_allowlist_count: number
} {
  const raw = process.env.META_LIVE_WORKSPACE_ALLOWLIST
  const parsed = parseMetaLiveAllowlist(raw)

  return {
    live_allowlist_configured: parsed.isAll || parsed.count > 0,
    live_allowlist_all: parsed.isAll,
    live_allowlist_count: parsed.count,
  }
}
