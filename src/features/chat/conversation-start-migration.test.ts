import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/20260814083246_v075_atomic_conversation_start.sql',
), 'utf8')

describe('V0.7.5 atomic conversation start migration', () => {
  it('uses one invoker transaction boundary with explicit authenticated execution', () => {
    expect(migration).toContain('function public.start_conversation_with_first_message(')
    expect(migration).toContain('security invoker')
    expect(migration).not.toContain('security definer')
    expect(migration).toContain('on conflict (workspace_id, creation_request_key) do nothing')
    expect(migration).toContain('on conflict (workspace_id, client_message_id) do nothing')
    expect(migration).toContain('from public, anon;')
    expect(migration).toContain('to authenticated;')
  })

  it('rejects request-key reuse with a different first message', () => {
    expect(migration).toContain('v_existing_first.client_message_id <> p_client_message_id')
    expect(migration).toContain("raise exception 'conversation_start_request_conflict'")
  })
})
