import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { beforeAll, expect, it } from 'vitest'
import { query } from './pg-client'
const owner = randomUUID(), viewer = randomUUID(), foreign = randomUUID(), ws = randomUUID(), content = randomUUID(), version = randomUUID()
const fingerprint = 'b'.repeat(64)
beforeAll(() => {
  query(`with u as (insert into auth.users(id) values ('${owner}'),('${viewer}'),('${foreign}') returning id) select id from u`)
  query(`with w as (insert into public.workspaces(id,name,created_by) values ('${ws}','승인 명령 검증','${owner}') returning id) select id from w`)
  query(`with m as (insert into public.workspace_members(workspace_id,user_id,role,status) values ('${ws}','${viewer}','viewer','active'),('${ws}','${owner}','owner','active') on conflict (workspace_id,user_id) do nothing returning user_id) select user_id from m`)
  query(`with c as (insert into public.content_items(id,workspace_id,channel,title,created_by) values ('${content}','${ws}','threads','검증 초안','${owner}') returning id) select id from c`)
  query(`with v as (insert into public.content_versions(id,workspace_id,content_id,version_number,caption,fingerprint,rights,generation_evidence,created_by) values ('${version}','${ws}','${content}',1,'검증 본문','${fingerprint}','{"confirmed":true}','{"confirmed":true}','${owner}') returning id) select id from v`)
  query(`with c as (update public.content_items set current_version_id='${version}' where id='${content}' returning id) select id from c`)
})
function command(actor = owner, hash = fingerprint) {
  return `select public.approve_and_dispatch_content_as_actor('${actor}','${ws}','${content}','${version}','${hash}','approve_only',null,null,null,'meta') as result`
}
function service(sql: string) {
  if (!process.env.PGHOST?.includes('sohee-vault-db-')) throw new Error('Isolated PostgreSQL required')
  const run = spawnSync(`${process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'}/psql`, ['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-d',process.env.PGDATABASE!], {
    input: `begin; set local role service_role; ${sql}; select json_build_object('restored',coalesce(current_setting('request.jwt.claim.sub',true),'')='') ; commit;`, encoding: 'utf8',
  })
  if (run.status) throw new Error(run.stderr)
  return run.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}
it('keeps both the original privileged RPC and actor command inaccessible to browser roles', () => {
  expect(() => query(command(), owner)).toThrow(/permission denied/)
  expect(query<{ allowed: boolean }>(`select has_function_privilege('anon','public.approve_and_dispatch_content_as_actor(uuid,uuid,uuid,uuid,text,text,timestamptz,text,uuid,text)','execute') as allowed`)[0].allowed).toBe(false)
  expect(query<{ allowed: boolean }>(`select has_function_privilege('authenticated','public.approve_and_dispatch_meta_content(uuid,uuid,uuid,text,text,timestamptz,text,uuid)','execute') as allowed`)[0].allowed).toBe(false)
})
it('rejects viewer and foreign actors and preserves the exact fingerprint gate', () => {
  expect(() => service(command(viewer))).toThrow(/APPROVAL_ACTOR_FORBIDDEN/)
  expect(() => service(command(foreign))).toThrow(/APPROVAL_ACTOR_FORBIDDEN/)
  expect(() => service(command(owner, 'c'.repeat(64)))).toThrow(/지문/)
})
it('approves through the native owner command once, restores actor context and never schedules in approve_only mode', () => {
  const first = service(command())
  expect(first[0].next).toBe('approved')
  expect(first[1].restored).toBe(true)
  expect(service(command())[0].approvalId).toBe(first[0].approvalId)
  expect(query<{ count: number }>(`select count(*) from public.schedules where workspace_id='${ws}'`)[0].count).toBe(0)
  expect(query<{ decided_by: string }>(`select decided_by from public.approvals where content_id='${content}'`)[0].decided_by).toBe(owner)
})
