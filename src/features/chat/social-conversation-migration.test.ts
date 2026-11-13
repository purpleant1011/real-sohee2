import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/20260814085510_v075_social_conversation_artifacts.sql',
), 'utf8')

describe('V0.7.5 social conversation workflow migration', () => {
  it('persists both supported SNS artifact types into their exact channel', () => {
    expect(migration).toContain("check (type in ('instagram_post', 'threads_post'))")
    expect(migration).toContain("when 'instagram_post' then 'instagram'")
    expect(migration).toContain("when 'threads_post' then 'threads'")
    expect(migration).toContain("'channel', content_channel")
  })

  it('creates a new immutable version only from the exact locked base version', () => {
    expect(migration).toContain('function public.create_scoped_content_revision(')
    expect(migration).toContain('security invoker')
    expect(migration).toContain('for update;')
    expect(migration).toContain('current_version_id <> p_expected_base_version_id')
    expect(migration).toContain('current_fingerprint <> p_expected_base_fingerprint')
    expect(migration).toContain('private.create_content_version_internal(')
  })

  it('keeps the scoped revision RPC behind authenticated execution', () => {
    expect(migration).toContain('from public, anon, authenticated;')
    expect(migration).toContain('to authenticated;')
  })
})
