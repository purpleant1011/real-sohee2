import { describe, expect, it } from 'vitest'
import { explain, query } from './pg-client'

const workspace = 'a1111111-1111-4111-8111-111111111111'
const actor = 'a2222222-2222-4222-8222-222222222222'

/** Measures server-side executor time, not an in-memory fake or a child-process startup. */
describe('ANI-1531 real PostgreSQL list-query performance', () => {
  it('seeds 1,000 valid vault rows and reports EXPLAIN ANALYZE p95 under 15ms', () => {
    query(`with actor as (insert into auth.users(id) values ('${actor}') returning id) select id from actor`)
    query(`with ws as (insert into workspaces(id,name,created_by) values ('${workspace}', '성능 측정 서비스', '${actor}') returning id) select id from ws`)
    query(`with content as (insert into content_items(workspace_id,channel,title,created_by) values ('${workspace}','threads','성능 측정 콘텐츠','${actor}') returning id) select id from content`)
    const contentId = query<{ id: string }>(`select id from content_items where workspace_id='${workspace}'`)[0].id
    query(`with version as (insert into content_versions(workspace_id,content_id,version_number,caption,fingerprint,created_by) values ('${workspace}','${contentId}',1,'데이터베이스 실측 원고','${'a'.repeat(64)}','${actor}') returning id) select id from version`)
    const versionId = query<{ id: string }>(`select id from content_versions where workspace_id='${workspace}'`)[0].id
    query(`with seeded as (insert into vault_items(workspace_id,content_id,version_id,channel,release_gate,hold_reason,held_at,target_date,policy_version,spec_version,approval_state,approved_fingerprint,fingerprint_schema_version,idempotency_key)
      select '${workspace}'::uuid, '${contentId}'::uuid, '${versionId}'::uuid, 'threads', 'HELD_USER', 'USER_HELD', now(), date '2026-10-01' + (g % 28), 'v1','v1','APPROVED','${'b'.repeat(64)}',3,'performance-' || g
      from generate_series(1,1000) g returning id) select count(*) from seeded`)
    expect(query<{ count: number }>(`select count(*)::int as count from vault_items where workspace_id='${workspace}'`)[0].count).toBe(1000)
    const sql = `select * from public.vault_items where workspace_id='${workspace}' and deleted_at is null and target_date between date '2026-10-01' and date '2026-10-31' and channel='threads' order by target_date, id limit 20`
    const results: number[] = []
    let firstPlan: any = null
    for (let i = 0; i < 50; i++) {
      const plan = explain(sql)
      if (!firstPlan) firstPlan = plan
      results.push(Number(plan['Execution Time']))
    }
    results.sort((a, b) => a - b)
    const p95 = results[Math.ceil(results.length * 0.95) - 1]
    console.log(`[ANI-1531] PostgreSQL 16, 1,000 rows, EXPLAIN ANALYZE (50 samples): p95=${p95.toFixed(3)}ms, min=${results[0].toFixed(3)}ms, max=${results.at(-1)!.toFixed(3)}ms, plan=${firstPlan.Plan['Node Type']}, child=${firstPlan.Plan.Plans?.[0]?.['Node Type'] ?? 'none'}`)
    expect(p95).toBeLessThanOrEqual(15)
  })
})
