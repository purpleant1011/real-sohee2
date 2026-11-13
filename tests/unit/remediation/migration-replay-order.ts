/**
 * Replay order of migrations = byte-wise filename order.
 *
 * That is exactly what `readdirSync(...).sort()` yields in
 * `scripts/verify-fresh-db-replay.mjs` (which produced the archived V0.91 replay
 * reports) and in `scripts/test-vault-db.mjs`.
 *
 * `supabase/migrations-manifest.json` stores entries in whatever order the last
 * rebuild produced. A rebuild that used `localeCompare` (or a numeric version
 * sort) puts `20260902_v089_…` ahead of `20260902000000_…`, which is not the
 * order the archived replay used. Archived replay reports are an immutable
 * *prefix snapshot* of the replay order, so a prefix comparison must be made
 * against the replay order, never against the manifest's storage order.
 */
export function inReplayOrder<T extends { filename: string }>(migrations: readonly T[]): T[] {
  return [...migrations].sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0))
}
