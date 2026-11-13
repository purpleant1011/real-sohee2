// @vitest-environment node
import { execFileSync, spawn } from 'node:child_process'
import { beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
if (!process.env.PGHOST?.includes('sohee-tenant-db-') || process.env.PGDATABASE !== 'tenant_security') throw new Error('Owned isolated PostgreSQL required')
const bin = `${process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'}/psql`
const ws='a7360000-0000-4000-8000-000000000001', actor='a7360000-0000-4000-8000-000000000002', dm='a7360000-0000-4000-8000-000000000003', comment='a7360000-0000-4000-8000-000000000004'
const q=(v: unknown) => v == null ? 'null' : `'${String(v).replaceAll("'", "''")}'`
function sql(input: string) { return execFileSync(bin,['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8'}).trim() }
function command(kind: string,id: string,text: string,at: string|null,old: string|null,workspace=ws) { return `begin; select set_config('request.jwt.claims','{"role":"service_role"}',true); set local role service_role; select public.save_mobile_reply_draft(${q(workspace)},${q(kind)},${q(id)},${q(text)},${q(at)},${q(old)},${q(actor)}); commit;` }
function save(...args: Parameters<typeof command>) { const out=sql(command(...args)); return JSON.parse(out.split('\n').find(line=>line.includes('"saved"'))!) }
function parallel(input:string):Promise<any> { return new Promise((resolve,reject)=>{const c=spawn(bin,['-X','-q','-A','-t','-v','ON_ERROR_STOP=1']);let out='',err='';c.stdout.on('data',b=>{out+=b});c.stderr.on('data',b=>{err+=b});c.on('error',reject);c.on('exit',code=>code!==0?reject(new Error(err)):resolve(JSON.parse(out.split('\n').find(line=>line.includes('"saved"'))!)));c.stdin.end(input)}) }
beforeAll(()=>sql(`insert into auth.users(id) values(${q(actor)}); insert into public.workspaces(id,name,created_by) values(${q(ws)},'local reply',${q(actor)}); insert into public.channel_connections(id,workspace_id,channel,status) values(${q(dm)},${q(ws)},'instagram','connected'); insert into public.instagram_dm_threads(id,workspace_id,channel_connection_id,provider_thread_id,customer_id,customer_handle,last_message_at,expires_at,last_message_text) values(${q(dm)},${q(ws)},${q(dm)},'local','local','local',now(),now()+interval '1 day','inquiry'); insert into public.social_comments(id,workspace_id,channel_connection_id,channel,provider_comment_id,provider_media_id,author_handle,comment_text,comment_created_at) values(${q(comment)},${q(ws)},${q(dm)},'instagram','local','local','local','inquiry',now());`))
describe('Track 2 actual PostgreSQL raw draft/CAS',()=>{
 it('DM와 댓글 모두 원문 공백/개행을 보존하며 기존 승인 없이 저장한다',()=>{
  for(const [kind,id,table,col] of [['dm',dm,'instagram_dm_drafts','thread_id'],['comment',comment,'comment_reply_drafts','comment_id']]) {
   const result=save(kind,id,'  raw\n\nreply  ',null,null);expect(result.saved).toBe(true)
   const row=JSON.parse(sql(`select row_to_json(r) from (select draft_text,approved_fingerprint from public.${table} where ${col}=${q(id)}) r;`));expect(row).toEqual({draft_text:'  raw\n\nreply  ',approved_fingerprint:null})
  }
 })
 it('두 연결이 같은 버전을 수정하면 하나만 저장되고 다른 하나는 conflict다',async()=>{
  const row=JSON.parse(sql(`select row_to_json(r) from (select draft_text,updated_at from public.instagram_dm_drafts where thread_id=${q(dm)}) r;`))
  const results=await Promise.all([parallel(command('dm',dm,'first edit',row.updated_at,row.draft_text)),parallel(command('dm',dm,'second edit',row.updated_at,row.draft_text))]);expect(results.filter(r=>r.saved)).toHaveLength(1);expect(results.filter(r=>r.code==='DRAFT_CONFLICT')).toHaveLength(1)
 })
 it('타 가게/없는 부모/이미 보낸 답안은 저장하지 않는다',()=>{
  expect(save('dm',dm,'foreign',null,null,randomUUID()).code).toBe('FORBIDDEN')
  expect(save('dm',randomUUID(),'missing',null,null).code).toBe('NOT_FOUND')
  sql(`update public.instagram_dm_threads set status='SENT' where id=${q(dm)};`)
  expect(save('dm',dm,'sent mutation',null,null).code).toBe('IMMUTABLE_REPLY_STATE')
 })
})
