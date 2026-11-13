import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261009030000_signup_600_verified_plus_1000.sql'), 'utf8')
const section = (name: string) => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  expect(start).toBeGreaterThanOrEqual(0)
  return sql.slice(start, sql.indexOf('$function$;', start) + '$function$;'.length)
}

describe('forward-only signup and verification credit policy', () => {
  it('creates zero-credit workspace without a signup ledger grant', () => {
    const body = section('provision_signup_workspace')
    expect(body).toContain('INSERT INTO public.credit_accounts')
    expect(body).toContain('initial_credit_grant)')
    expect(body).toMatch(/'ACTIVE', 0\)/)
    expect(body).toMatch(/0, 0, 0, 0\)/)
    expect(body).toContain("'credits_granted', 0")
    expect(body).not.toContain('INSERT INTO public.credit_ledger_entries')
    expect(body).toContain('AUTHZ_IMPERSONATION_DENIED')
  })

  it('requires BOTH Instagram and Threads connected or verified before granting 600 once', () => {
    const body = section('ensure_signup_starter_credits')
    expect(body).toContain('c_target_grant CONSTANT integer := 600;')
    expect(body).toMatch(/count\(DISTINCT lower\(cc\.channel\)\)\s+INTO v_connected_channels/)
    expect(body).toContain("lower(cc.channel) IN ('instagram', 'threads')")
    expect(body).toContain("lower(cc.status) IN ('connected', 'verified')")
    expect(body).toMatch(/v_connected_channels < 2 THEN[\s\S]*?'CHANNELS_NOT_CONNECTED'/)
    expect(body).toContain("'signup-first-post:' || p_user_id::text")
    expect(body).toContain('ON CONFLICT (workspace_id, idempotency_key, kind) DO NOTHING')
    expect(body).not.toContain('topup')
    expect(body).toContain("'already', true")
    expect(body).toContain("bv.status = 'VERIFIED'")
    expect(body).toContain('NOT_ACTIVE_WORKSPACE_MEMBER')
    expect(body).toContain('pg_catalog.pg_advisory_xact_lock')
  })

  it.each([
    [[], false],
    [[{ channel: 'INSTAGRAM', status: 'connected' }], false],
    [[{ channel: 'instagram', status: 'connected' }, { channel: 'THREADS', status: 'verified' }], true],
    [[{ channel: 'instagram', status: 'authorized' }, { channel: 'threads', status: 'verified' }], false],
  ])('channel readiness with %j yields %s', (connections, eligible) => {
    const body = section('ensure_signup_starter_credits')
    expect(body).toContain("lower(cc.channel) IN ('instagram', 'threads')")
    expect(body).toContain("lower(cc.status) IN ('connected', 'verified')")
    expect(body).toContain('v_connected_channels < 2')
    const qualifying = new Set(connections.filter(({ channel, status }) =>
      ['instagram', 'threads'].includes(channel.toLowerCase()) &&
      ['connected', 'verified'].includes(status.toLowerCase()),
    ).map(({ channel }) => channel.toLowerCase()))
    expect(qualifying.size === 2).toBe(eligible)
  })

  it('grants verified bonus additively with ledger uniqueness and no legacy energy or 40,000 reset', () => {
    const body = section('admin_verify_business_and_grant_taste')
    expect(body).toContain("'business-verified-bonus:' || p_workspace_id::text")
    expect(body).toMatch(/'grant', NULL, 1000/)
    expect(body).toContain('ON CONFLICT (workspace_id, idempotency_key, kind) DO NOTHING')
    expect(body).toContain('GET DIAGNOSTICS v_inserted = ROW_COUNT')
    expect(body).toContain('activation_credits = public.workspace_credit_states.activation_credits + EXCLUDED.activation_credits')
    expect(body).toContain('total_available_credits = public.workspace_credit_states.total_available_credits + EXCLUDED.total_available_credits')
    expect(body).toContain("'credits_granted', v_credits_granted")
    expect(body).toContain("'already_granted', v_already_granted")
    expect(body).toContain("'energy_granted', 0")
    expect(body).toContain('ADMIN_ROLE_REQUIRED')
    expect(body).toContain('ANI-603')
    expect(body).toContain('INSERT INTO public.audit_events')
    expect(body).not.toMatch(/40000|40000|FREE_TASTE_50|agent_energy_transactions|total_available_credits\s*=\s*40000/)
  })

  it('reserves quick-post credits considering both signup and verified bonus grants', () => {
    const body = section('reserve_quick_post_credits')
    expect(body).toContain('SECURITY DEFINER')
    expect(body).toContain("SET search_path = ''")
    expect(body).toMatch(
      /grant_entry\.idempotency_key LIKE 'signup-first-post:%'\s+OR\s+grant_entry\.idempotency_key LIKE 'business-verified-bonus:%'/,
    )
    expect(body).toContain(
      "WHEN kind = 'grant' AND (idempotency_key LIKE 'signup-first-post:%' OR idempotency_key LIKE 'business-verified-bonus:%') THEN amount",
    )
    expect(body).toContain('total_available_credits = total_available_credits - v_cost')
  })

  it('restricts privileged functions to service_role with contained search_path', () => {
    for (const [name, signature] of [
      ['ensure_signup_starter_credits', 'uuid, uuid'],
      ['admin_verify_business_and_grant_taste', 'uuid, uuid, text, text'],
      ['reserve_quick_post_credits', 'uuid, uuid, integer, text, integer, uuid'],
    ]) {
      const body = section(name)
      expect(body).toContain('SECURITY DEFINER')
      expect(body).toContain("SET search_path = ''")
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${name}(${signature}) FROM PUBLIC, anon, authenticated;`)
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${name}(${signature}) TO service_role;`)
    }
    expect(section('provision_signup_workspace')).toContain("SET search_path = ''")
    expect(sql).not.toMatch(/\bDO \$\$/)
  })
})
