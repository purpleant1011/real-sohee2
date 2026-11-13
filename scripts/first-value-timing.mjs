#!/usr/bin/env node
// Read only a minimal JSON array of funnel_events from stdin; never log identities or raw rows.
// Example: psql -X -A -t -c "select json_agg(row_to_json(e)) from (select workspace_id,user_id,event,occurred_at from funnel_events where workspace_id in ('<five-workspace-ids>') and event in ('signup_completed','preview_viewed','vault.saved','publish_verified') order by occurred_at) e" | node scripts/first-value-timing.mjs
import { readFileSync } from 'node:fs'

export function measureFirstValue(rows) {
  if (!Array.isArray(rows)) throw new Error('이벤트 목록을 확인해 주세요.')
  const groups = new Map()
  for (const row of rows) {
    if (typeof row?.workspace_id !== 'string' || typeof row?.user_id !== 'string' || !Number.isFinite(Date.parse(row?.occurred_at))) continue
    const key = JSON.stringify([row.workspace_id, row.user_id])
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  const completed = []
  for (const group of groups.values()) {
    const at = (event, earliest) => group.filter(r => r.event === event).map(r => Date.parse(r.occurred_at)).filter(t => t >= earliest).sort((a, b) => a - b)[0]
    const signup = at('signup_completed', 0)
    if (signup === undefined) continue
    const preview = at('preview_viewed', signup)
    const vault = at('vault.saved', preview ?? Infinity)
    const publish = at('publish_verified', preview ?? Infinity)
    const end = Math.min(vault ?? Infinity, publish ?? Infinity)
    if (preview !== undefined && Number.isFinite(end)) completed.push({ signupToPreviewMs: preview - signup, signupToFirstValueMs: end - signup })
  }
  const sorted = completed.map(c => c.signupToFirstValueMs).sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return { completed: sorted.length, missing: Math.max(0, groups.size - sorted.length), medianMs: sorted.length ? sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 : null, worstMs: sorted.at(-1) ?? null, underTenMinutes: sorted.filter(t => t <= 600_000).length }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const input = JSON.parse(readFileSync(0, 'utf8'))
  const result = measureFirstValue(input)
  console.log(JSON.stringify(result))
  if (result.completed !== 5) process.exitCode = 1
}
