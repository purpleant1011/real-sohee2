// @vitest-environment node
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { calculateApprovalFingerprint, type ExactApprovalPayload } from '../../../src/features/missions/conversational-first-post'
if (!process.env.PGHOST?.includes('sohee-tenant-db-') || process.env.PGDATABASE !== 'tenant_security') throw new Error('Owned isolated PostgreSQL required')
const bin = `${process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'}/psql`
const WS = 'a7890000-0000-4000-8000-000000000001'
const ACTOR = 'a7890000-0000-4000-8000-000000000002'
const q = (value: unknown) => `'${(typeof value === 'object' ? JSON.stringify(value) : String(value)).replaceAll("'", "''")}'`
function sql(input: string) { return execFileSync(bin, ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8' }).trim() }
function mission(text = 'same raw\ncopy', intent?: string) {
  const id = randomUUID()
  const payload: ExactApprovalPayload = { workspaceId: WS, missionId: id, channels: [{ provider: 'instagram', handle: '@local' }], copies: { instagram: { caption: text }, threads: { content: text } }, imageIds: ['photo-a'], boundVersions: { knowledgeVersion: 1, textHarnessVersion: 1, imageHarnessVersion: 1, operatingPolicyVersion: 1 }, rights: { rightsStatus: 'OWNED', consentStatus: 'NOT_APPLICABLE' } }
  const fingerprint = calculateApprovalFingerprint(payload)
  sql(`insert into public.marketing_missions(id,workspace_id,trace_id,goal,status,metadata) values (${q(id)},${q(WS)},'local','local','APPROVED',${q({ payload, approvedMission: { approvedFingerprint: fingerprint }, ...(intent ? { publishIntentId: intent } : {}) })});`)
  return { id, payload, fingerprint }
}
function consume(m: ReturnType<typeof mission>, hold = false): Promise<{ claimed: boolean; code?: string }> {
  const snapshot = JSON.parse(sql(`select json_build_object('metadata',metadata,'updated_at',updated_at) from public.marketing_missions where id=${q(m.id)};`))
  const statement = `begin; select set_config('request.jwt.claims','{"role":"service_role"}',true); set local role service_role; select public.claim_first_post_publish(${q(WS)},${q(m.id)},${q(m.fingerprint)},${q(m.payload)}::jsonb,${q(randomUUID())},${q(snapshot.metadata)}::jsonb,${q(snapshot.updated_at)}::timestamptz,null); ${hold ? 'select pg_sleep(0.15);' : ''} commit;`
  return new Promise((resolve, reject) => { const child = spawn(bin, ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1']); let out = '', err = ''; child.stdout.on('data', b => { out += b }); child.stderr.on('data', b => { err += b }); child.on('error', reject); child.on('exit', code => { if (code !== 0) return reject(new Error(err)); const line = out.split('\n').find(l => l.includes('"claimed"')); if (!line) return reject(new Error(out)); resolve(JSON.parse(line)) }); child.stdin.end(statement) })
}
beforeAll(() => sql(`insert into auth.users(id) values (${q(ACTOR)}); insert into public.workspaces(id,name,created_by) values (${q(WS)},'atomic local test',${q(ACTOR)}); insert into public.channel_connections(workspace_id,channel,status,account_label,external_account_id) values (${q(WS)},'instagram','connected','@local','provider-account-a');`))
describe('ANI-1789 actual PostgreSQL concurrent consumption', () => {
  it('실제 스키마로 연결과 암호화 자격증명을 원자 저장한다', () => {
    const result = sql(`begin;
      update public.workspace_members set role='owner',status='active' where workspace_id=${q(WS)} and user_id=${q(ACTOR)};
      select set_config('request.jwt.claims','{"role":"service_role"}',true);
      set local role service_role;
      select public.save_meta_channel_connection(${q(WS)},${q(ACTOR)},'threads','credential-account','@credential','encrypted-test-only-not-a-real-token','MDEyMzQ1Njc4OWFi',array['threads_basic','threads_content_publish'],null,null);
      -- The replay role intentionally has no BYPASSRLS; inspect persistence as the fixture owner.
      reset role;
      select count(*) from public.meta_channel_credentials c join public.channel_connections n
        on n.workspace_id=c.workspace_id and n.id=c.channel_connection_id
        where c.workspace_id=${q(WS)} and c.provider='threads' and c.status='active'
          and n.status='connected' and n.external_account_id='credential-account';
      rollback;`)
    expect(result.split('\n').at(-1)).toBe('1')
    expect(() => sql(`begin;
      update public.workspace_members set status='disabled' where workspace_id=${q(WS)} and user_id=${q(ACTOR)};
      select set_config('request.jwt.claims','{"role":"service_role"}',true);
      set local role service_role;
      select public.save_meta_channel_connection(${q(WS)},${q(ACTOR)},'threads','credential-account','@credential','encrypted-test-only-not-a-real-token','MDEyMzQ1Njc4OWFi','{}',null,null); commit;`)).toThrow()
    expect(sql(`select count(*) from public.channel_connections where workspace_id=${q(WS)} and channel='threads';`)).toBe('0')
  })
  it('공개 준비 검사는 고객 데이터 없이 실제 함수 권한 드리프트를 차단한다', () => {
    const read = () => JSON.parse(sql('begin read only; set local role anon; select public.sns_release_readiness(); rollback;'))
    expect(read()).toMatchObject({ ready: true, contract: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(Object.keys(read()).sort()).toEqual(['contract', 'ready'])
    sql('grant execute on function public.claim_first_post_publish(uuid,uuid,text,jsonb,uuid,jsonb,timestamptz,text) to authenticated;')
    try { expect(read()).toEqual({ ready: false }) }
    finally { sql('revoke execute on function public.claim_first_post_publish(uuid,uuid,text,jsonb,uuid,jsonb,timestamptz,text) from authenticated;') }
    expect(read().ready).toBe(true)
  })
  it('독립 두 연결·서로 다른 R1/R2 mission도 같은 콘텐츠/계정은 승자 1개뿐이다', async () => {
    const a = mission(), b = mission()
    const results = await Promise.all([consume(a, true), consume(b)])
    expect(results.filter(r => r.claimed)).toHaveLength(1)
    expect(results.filter(r => r.code === 'PUBLISH_CONTENT_ALREADY_CLAIMED')).toHaveLength(1)
    const winner = results[0].claimed ? a : b
    expect(sql(`select status from public.marketing_missions where id=${q(winner.id)};`)).toBe('EXECUTING')
    expect(await consume(winner)).toMatchObject({ claimed: false, code: 'STALE_PUBLISH_APPROVAL' })
  })
  it('운영 저장 RPC의 authorized 연결도 발행할 수 있다', async () => {
    sql(`update public.channel_connections set status='authorized' where workspace_id=${q(WS)};`)
    try { expect(await consume(mission('authorized channel'))).toMatchObject({ claimed: true }) }
    finally { sql(`update public.channel_connections set status='connected' where workspace_id=${q(WS)};`) }
  })
  it('다른 새 콘텐츠 또는 별도로 승인한 새 intent는 부당하게 시간창으로 막지 않는다', async () => {
    expect(await consume(mission('different content'))).toMatchObject({ claimed: true })
    expect(await consume(mission('same raw\ncopy', randomUUID()))).toMatchObject({ claimed: true })
  })
  it('stale payload/지문은 원장 삽입 없이 차단된다', async () => {
    const m = mission('stale'); m.fingerprint = '0'.repeat(64)
    expect(await consume(m)).toMatchObject({ claimed: false, code: 'STALE_PUBLISH_APPROVAL' })
    expect(sql(`select count(*) from public.first_post_publish_consumptions where mission_id=${q(m.id)};`)).toBe('0')
  })
  it('두 채널 중 하나가 불명이라도 부분 claim을 남기지 않는다', async () => {
    const m = mission('multi-target'); m.payload.channels.push({ provider: 'threads', handle: '@missing' }); m.fingerprint = calculateApprovalFingerprint(m.payload)
    sql(`update public.marketing_missions set metadata=${q({ payload: m.payload, approvedMission: { approvedFingerprint: m.fingerprint } })} where id=${q(m.id)};`)
    expect(await consume(m)).toMatchObject({ claimed: false, code: 'PUBLISH_TARGET_UNAVAILABLE' })
    expect(sql(`select count(*) from public.first_post_publish_consumptions where mission_id=${q(m.id)};`)).toBe('0')
  })
  it('기존 게시/불확실 기록도 새 mission으로 우회하지 못한다', async () => {
    const old = mission('historical accepted')
    sql(`update public.marketing_missions set status='PUBLISHED_VERIFIED' where id=${q(old.id)};`)
    expect(await consume(mission('historical accepted'))).toMatchObject({ claimed: false, code: 'PUBLISH_CONTENT_ALREADY_CLAIMED' })
  })
  it('확정 실패만 같은 콘텐츠 새 승인을 허용하며 unknown/accepted는 차단한다', async () => {
    for (const stage of ['FAILED', 'RESULT_UNKNOWN', 'PROVIDER_ACCEPTED']) {
      const text = `rejection-${stage}`
      const old = mission(text)
      expect(await consume(old)).toMatchObject({ claimed: true })
      sql(`update public.marketing_missions set status='FAILED', metadata=(metadata-'retryLock') || ${q({ executionResult: { approvalFingerprint: old.fingerprint, receipts: { instagram: { stage, approvalFingerprint: old.fingerprint } } } })}::jsonb where id=${q(old.id)};`)
      expect(await consume(mission(text))).toMatchObject(stage === 'FAILED' ? { claimed: true } : { claimed: false, code: 'PUBLISH_CONTENT_ALREADY_CLAIMED' })
      expect(sql(`select count(*) from public.first_post_publish_consumptions where mission_id=${q(old.id)};`)).toBe('1')
    }
  })
  it('구버전 원장만 소비한 APPROVED 미션은 원장 이력을 보존하며 원자적으로 복구한다', async () => {
    const m = mission('orphaned before CAS')
    sql(`insert into public.first_post_publish_consumptions(workspace_id,mission_id,approved_fingerprint,provider,account_id,intent_scope,content_fingerprint,claim_token) values (${q(WS)},${q(m.id)},${q(m.fingerprint)},'instagram','provider-account-a','first-post',private.first_post_publish_key(${q(m.payload)}::jsonb,'instagram'),${q(randomUUID())});`)
    expect(await consume(m)).toMatchObject({ claimed: true })
    expect(sql(`select count(*) from public.first_post_publish_consumptions where mission_id=${q(m.id)};`)).toBe('1')
    expect(sql(`select status from public.marketing_missions where id=${q(m.id)};`)).toBe('EXECUTING')
    expect(await consume(m)).toMatchObject({ claimed: false })
  })
  it('같은 미션 동시 claim은 승자 하나이며 두 채널 실패는 상태까지 롤백한다', async () => {
    const m = mission('same mission race')
    expect((await Promise.all([consume(m, true), consume(m)])).filter(r => r.claimed)).toHaveLength(1)
    const failed = mission('rollback state')
    failed.payload.channels.push({ provider: 'threads', handle: '@missing' })
    failed.fingerprint = calculateApprovalFingerprint(failed.payload)
    sql(`update public.marketing_missions set metadata=${q({ payload: failed.payload, approvedMission: { approvedFingerprint: failed.fingerprint } })} where id=${q(failed.id)};`)
    expect(await consume(failed)).toMatchObject({ claimed: false })
    expect(sql(`select status from public.marketing_missions where id=${q(failed.id)};`)).toBe('APPROVED')
  })
  it('anon/authenticated에는 RPC 실행 권한이 없다', () => {
    expect(sql(`select has_function_privilege('authenticated','public.claim_first_post_publish(uuid,uuid,text,jsonb,uuid,jsonb,timestamptz,text)','EXECUTE');`)).toBe('f')
    expect(sql(`select has_function_privilege('anon','public.claim_first_post_publish(uuid,uuid,text,jsonb,uuid,jsonb,timestamptz,text)','EXECUTE');`)).toBe('f')
    expect(sql(`select has_function_privilege('authenticated','public.consume_first_post_publish(uuid,uuid,text,jsonb,uuid)','EXECUTE');`)).toBe('f')
    expect(sql(`select has_function_privilege('anon','public.consume_first_post_publish(uuid,uuid,text,jsonb,uuid)','EXECUTE');`)).toBe('f')
  })
})
