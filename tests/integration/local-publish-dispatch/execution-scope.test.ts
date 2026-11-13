import { spawn, spawnSync } from 'node:child_process'
import { beforeAll, describe, expect, it } from 'vitest'

const id = (n: number) => `91000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const owner = id(1), otherOwner = id(2), viewer = id(3), manager = id(4)
const workspace = id(100), otherWorkspace = id(101)
const device = id(200), secondDevice = id(201), foreignDevice = id(202)
const connection = id(300), secondConnection = id(301)
const content = [id(400), id(401), id(402), id(403)]
const version = [id(500), id(501), id(502), id(503)]
const fingerprint = ['a', 'b', 'c', 'e'].map((s) => s.repeat(64))
const digest = 'd'.repeat(64), secondDigest = 'e'.repeat(64)
const selectedRequest = id(900)
let actions: string[] = []

function assertIsolated() {
  if (!process.env.PGHOST?.includes('sohee-vault-db-')) throw new Error('Isolated PostgreSQL required')
}
const binary = () => `${process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'}/psql`
const args = () => ['-X', '-q', '-A', '-t', '-P', 'null=null', '-v', 'ON_ERROR_STOP=1', '-d', process.env.PGDATABASE!]
function raw(sql: string) {
  assertIsolated()
  return spawnSync(binary(), args(), { input: sql, encoding: 'utf8' })
}
function value(run: ReturnType<typeof raw>): any {
  if (run.status !== 0) throw new Error(run.stderr)
  const line = run.stdout.trim().split('\n').filter((l) => l.startsWith('{') || l.startsWith('[') || l === 'null').at(-1)
  if (!line) throw new Error(`Missing JSON result: ${run.stdout}`)
  return JSON.parse(line)
}
function transaction(sql: string) {
  return value(raw(`begin; set local role service_role; ${sql}; rollback;`))
}
function grant(action = actions[2], fp = fingerprint[2], requestId = selectedRequest, actor = owner, expectedConnection = connection) {
  return `public.authorize_local_publish_execution_scope('${workspace}', '${actor}', '${action}', '${fp}', '${requestId}', '${expectedConnection}')`
}
function scopeQuery() {
  return `public.get_local_publish_execution_scope('${workspace}', '${device}', '${digest}')`
}
function scoped(scopeId: string | null = null, action = actions[2], deviceId = device, token = digest, ws = workspace) {
  const scope = scopeId === null ? `(select scope_id from private.connector_execution_scope_state where workspace_id='${workspace}' and device_id='${device}')` : `'${scopeId}'::uuid`
  return `public.claim_scoped_local_publish_job('${ws}', '${deviceId}', '${token}', '${action}', ${scope})`
}
function queueSnapshot() {
  return `jsonb_build_object('old', (select jsonb_agg(to_jsonb(request) order by id) from public.external_action_requests request where id in ('${actions[0]}','${actions[1]}')), 'other', (select status from public.external_action_requests where id='${actions[3]}'))`
}
function recover(jobId: string, leaseId: string | null = null, mayHaveSubmitted = false) {
  const lease = leaseId === null ? `(select id from private.local_publish_leases where workspace_id='${workspace}' and action_request_id='${jobId}')` : `'${leaseId}'::uuid`
  return `public.recover_scoped_local_publish_checkpoint('${workspace}','${device}','${digest}','${jobId}',${lease},${mayHaveSubmitted})`
}

beforeAll(() => {
  const setup = raw(`
    -- The raw-replay stub lacks Supabase's server service_role defaults.
    -- This fixture is guarded to this run's throwaway socket-only cluster.
    -- Client roles and production grants are not changed.
    alter role service_role bypassrls;
    grant select,insert,update on public.workspace_members,public.content_items,public.content_versions,
      public.approvals,public.media_assets,public.content_version_media,public.external_action_requests,
      public.external_action_attempts,public.external_action_receipts to service_role;
    insert into auth.users(id,email) values
      ('${owner}','scope-owner@sohee.test.invalid'),('${otherOwner}','scope-other@sohee.test.invalid'),
      ('${viewer}','scope-viewer@sohee.test.invalid'),('${manager}','scope-manager@sohee.test.invalid');
    insert into public.workspaces(id,name,created_by) values
      ('${workspace}','Scope A','${owner}'),('${otherWorkspace}','Scope B','${otherOwner}');
    insert into public.workspace_members(workspace_id,user_id,role,status) values
      ('${workspace}','${viewer}','viewer','active'),('${workspace}','${manager}','manager','active');
    insert into public.connector_devices(id,workspace_id,display_name,platform,client_version,token_digest,status,created_by) values
      ('${device}','${workspace}','Scope device','macos','0.1.2','${digest}','active','${owner}'),
      ('${secondDevice}','${workspace}','Other device','macos','0.1.2','${secondDigest}','active','${owner}'),
      ('${foreignDevice}','${otherWorkspace}','Foreign device','macos','0.1.2',repeat('f',64),'active','${otherOwner}');
    insert into public.browser_channel_connections(id,workspace_id,device_id,channel,external_account_label,target_external_id,target_url,target_fingerprint,environment,status,verified_at) values
      ('${connection}','${workspace}','${device}','naver_blog','scope-blog','scope-blog','https://blog.naver.com/scope-blog/postwrite',repeat('1',64),'test','connected',now()),
      ('${secondConnection}','${workspace}','${secondDevice}','naver_blog','other-blog','other-blog','https://blog.naver.com/other-blog/postwrite',repeat('2',64),'test','connected',now());
    ${content.map((cid,i) => `
      insert into public.media_assets(id,workspace_id,bucket_id,object_path,kind,mime_type,size_bytes,rights_status,created_by,sha256_digest) values
        ('${id(600+i)}','${workspace}','content-media','${workspace}/${owner}/scope-${i}.png','content','image/png',1024,'confirmed','${owner}',repeat('a',64));
      insert into storage.objects(bucket_id,name,owner,metadata) values
        ('content-media','${workspace}/${owner}/scope-${i}.png','${owner}','{"mimetype":"image/png","size":1024}'::jsonb);
      insert into public.content_items(id,workspace_id,channel,title,created_by) values
        ('${cid}','${workspace}','naver_blog','Scope ${i}','${owner}');
      insert into public.content_versions(id,workspace_id,content_id,version_number,caption,fingerprint,created_by,rights,generation_evidence,structured_payload) values
        ('${version[i]}','${workspace}','${cid}',1,'승인한 본문 ${i}','${fingerprint[i]}','${owner}','{"confirmed":true}','{"confirmed":true}','{"visibility":"private"}');
      insert into public.content_version_media(workspace_id,version_id,media_asset_id,position) values
        ('${workspace}','${version[i]}','${id(600+i)}',0);
      update public.content_items set current_version_id='${version[i]}' where id='${cid}';
    `).join('\n')}
  `)
  if (setup.status) throw new Error(setup.stderr)
  actions = content.map((cid,i) => value(raw(`begin; set local role authenticated;
    select set_config('request.jwt.claim.sub','${owner}',true);
    select public.approve_and_dispatch_local_content('${workspace}','${cid}','${version[i]}','${fingerprint[i]}','publish_now',null,'Asia/Seoul','${i===3 ? secondConnection : connection}'); commit;`)).actionRequestId)
  const order = raw(actions.map((action,i) => `update public.external_action_requests set created_at='2026-01-01T00:0${i}:00Z' where id='${action}';`).join('\n'))
  if (order.status) throw new Error(order.stderr)
})

describe('exact-action local publish scope', () => {
  it('selects one current approved action for an owner or manager', () => {
    const data = transaction(`select ${grant()} as result`)
    expect(data).toMatchObject({ actionId: actions[2], deviceId: device, targetExternalId: 'scope-blog' })
    expect(data.scopeId).toMatch(/^[0-9a-f-]{36}$/)
    expect(transaction(`select ${grant(actions[2],fingerprint[2],selectedRequest,manager)}`)).toMatchObject({ actionId: actions[2] })
  })

  it('rejects viewers, other-tenant actors and stale fingerprints without a scope', () => {
    expect(transaction(`select ${grant(actions[2],fingerprint[2],selectedRequest,viewer)}`)).toBeNull()
    expect(transaction(`select ${grant(actions[2],fingerprint[2],selectedRequest,otherOwner)}`)).toBeNull()
    expect(transaction(`select ${grant(actions[2],'0'.repeat(64))}`)).toBeNull()
  })

  it('returns the same current scope for an idempotent request', () => {
    const data = transaction(`select ${grant()}; select jsonb_build_object('id',(select id from private.local_publish_execution_scopes where workspace_id='${workspace}'),'second',${grant()},'n',(select count(*) from private.local_publish_execution_scopes where workspace_id='${workspace}'))`)
    expect(data.n).toBe(1)
    expect(data.second.scopeId).toBe(data.id)
  })

  it('does not let a superseded request reselect an old scope', () => {
    const data = transaction(`select ${grant()}; select ${grant(actions[0],fingerprint[0],id(901))}; select jsonb_build_object('replay',${grant()},'scope',${scopeQuery()})`)
    expect(data.replay).toBeNull()
    expect(data.scope.actionId).toBe(actions[0])
  })

  it('claims only the selected action and leaves older ready and other-device rows unchanged', () => {
    const before=transaction(`select ${queueSnapshot()}`)
    const data = transaction(`select ${grant()}; select jsonb_build_object('claim',${scoped()},'queue',${queueSnapshot()})`)
    expect(data.queue.old).toEqual(before.old)
    expect(data.claim.jobId).toBe(actions[2])
    expect(data.queue.old.map((row: any) => row.status)).toEqual(['ready','ready'])
    expect(data.queue.other).toBe('ready')
  })

  it('never falls back to FIFO for a missing or mismatched scope', () => {
    const data = transaction(`select ${grant()}; select jsonb_build_object('wrong',${scoped(id(999))},'generic',public.claim_local_publish_job('${workspace}','${device}','${digest}'),'queue',${queueSnapshot()})`)
    expect(data.wrong).toBeNull()
    expect(data.generic).toBeNull()
    expect(data.queue.old.map((row: any) => row.status)).toEqual(['ready','ready'])
  })

  it('blocks changed versions, unknown and completed actions instead of claiming another ready row', () => {
    const data = transaction(`select ${grant()}; update public.external_action_requests set status='unknown_result',failure_code='UNKNOWN_RESULT' where id='${actions[2]}'; select jsonb_build_object('claim',public.claim_scoped_local_publish_job('${workspace}','${device}','${digest}','${actions[2]}',(select scope_id from private.connector_execution_scope_state where device_id='${device}')),'queue',${queueSnapshot()})`)
    expect(data.claim).toBeNull()
    expect(data.queue.old.map((row: any) => row.status)).toEqual(['ready','ready'])
  })

  it('denies a different device token and workspace', () => {
    const res = raw(`begin; set local role service_role; select ${grant()}; select public.claim_scoped_local_publish_job('${otherWorkspace}','${device}','${digest}','${actions[2]}',(select scope_id from private.connector_execution_scope_state where device_id='${device}')); rollback;`)
    expect(res.status).not.toBe(0)
  })

  it('does not block an unrelated device scheduled queue', () => {
    const data = transaction(`select ${grant()}; select public.claim_local_publish_job('${workspace}','${secondDevice}','${secondDigest}')`)
    expect(data.jobId).toBe(actions[3])
  })

  it('recovers an expired no-permit/no-receipt lease to reconfirmation without requeueing old work', () => {
    const data = transaction(`select public.claim_local_publish_job('${workspace}','${device}','${digest}');
      update private.local_publish_leases set expires_at=now()-interval '1 minute' where action_request_id='${actions[0]}';
      select ${grant()};
      select ${recover(actions[0])};
      select jsonb_build_object('old',(select status from public.external_action_requests where id='${actions[0]}'),'other',(select status from public.external_action_requests where id='${actions[1]}'),'scope',${scopeQuery()});`)
    expect(data.old).toBe('reconfirmation_required')
    expect(data.other).toBe('ready')
    expect(data.scope.actionId).toBe(actions[2])
  })

  it('requires reconciliation for a permit boundary and does not requeue the old action', () => {
    const data = transaction(`select public.claim_local_publish_job('${workspace}','${device}','${digest}');
      update private.local_publish_leases set current_phase='preflight_verified',submit_permit_digest=repeat('a',64),submit_permit_issued_at=now(),expires_at=now()-interval '1 minute' where action_request_id='${actions[0]}';
      select ${recover(actions[0])};`)
    expect(data.state).toBe('reconcile_required')
  })

  it('does not treat a local submit boundary as proof of before-submit recovery', () => {
    const data = transaction(`select public.claim_local_publish_job('${workspace}','${device}','${digest}');
      update private.local_publish_leases set expires_at=now()-interval '1 minute' where action_request_id='${actions[0]}';
      select jsonb_build_object('recovery',${recover(actions[0],null,true)},'old',(select status from public.external_action_requests where id='${actions[0]}'));`)
    expect(data.recovery.state).toBe('reconcile_required')
    expect(data.old).toBe('executing')
  })

  it('never returns to FIFO when the selected scope expires', () => {
    const data = transaction(`select ${grant()}; reset role;
      update private.local_publish_execution_scopes set created_at=now()-interval '20 minutes',expires_at=now()-interval '1 minute' where device_id='${device}';
      set local role service_role; select jsonb_build_object('claim',${scoped()},'generic',public.claim_local_publish_job('${workspace}','${device}','${digest}'),'queue',${queueSnapshot()});`)
    expect(data.claim).toBeNull()
    expect(data.generic).toBeNull()
    expect(data.queue.old.map((row: any) => row.status)).toEqual(['ready','ready'])
  })

  it('denies anon/authenticated direct RPC and private table access', () => {
    const signature='public.authorize_local_publish_execution_scope(uuid,uuid,uuid,text,uuid,uuid)'
    const data = transaction(`select jsonb_build_object('anon',has_function_privilege('anon','${signature}','execute'),'authenticated',has_function_privilege('authenticated','${signature}','execute'),'service',has_function_privilege('service_role','${signature}','execute'))`)
    expect(data).toEqual({ anon:false, authenticated:false, service:true })
    expect(raw('begin; set local role authenticated; select * from private.connector_execution_scope_state; rollback;').status).not.toBe(0)
  })

  it('issues a permit once only for the selected action, not a previously claimed action', () => {
    const oldLease=`(select id from private.local_publish_leases where action_request_id='${actions[0]}')`
    const newLease=`(select id from private.local_publish_leases where action_request_id='${actions[2]}')`
    const data=transaction(`select public.claim_local_publish_job('${workspace}','${device}','${digest}'); select ${grant()};
      select public.record_local_publish_checkpoint('${workspace}','${device}','${actions[0]}',${oldLease},'preflight_verified',null,null,null);
      select ${scoped()};
      select public.record_local_publish_checkpoint('${workspace}','${device}','${actions[2]}',${newLease},'preflight_verified',null,null,null);
      select public.issue_local_submit_permit('${workspace}','${device}','${actions[2]}',${newLease},repeat('a',64));
      select jsonb_build_object('issued',(select submit_permit_digest is not null from private.local_publish_leases where action_request_id='${actions[2]}'),
        'duplicate',public.issue_local_submit_permit('${workspace}','${device}','${actions[2]}',${newLease},repeat('b',64)),
        'old',public.issue_local_submit_permit('${workspace}','${device}','${actions[0]}',${oldLease},repeat('c',64)));`)
    expect(data).toEqual({ issued:true,duplicate:false,old:false })
  })

  it('refuses a new scope while another action already holds a submit permit', () => {
    const oldLease=`(select id from private.local_publish_leases where action_request_id='${actions[0]}')`
    expect(transaction(`select public.claim_local_publish_job('${workspace}','${device}','${digest}');
      select public.record_local_publish_checkpoint('${workspace}','${device}','${actions[0]}',${oldLease},'preflight_verified',null,null,null);
      select public.issue_local_submit_permit('${workspace}','${device}','${actions[0]}',${oldLease},repeat('a',64)); select ${grant()};`)).toBeNull()
  })

  it('revalidates the current version before granting a submit permit', () => {
    const lease=`(select id from private.local_publish_leases where action_request_id='${actions[2]}')`
    const data=transaction(`select ${grant()}; select ${scoped()};
      update public.content_items set current_version_id=null where id='${content[2]}';
      select public.record_local_publish_checkpoint('${workspace}','${device}','${actions[2]}',${lease},'preflight_verified',null,null,null);
      select jsonb_build_object('permit',public.issue_local_submit_permit('${workspace}','${device}','${actions[2]}',${lease},repeat('a',64)));`)
    expect(data.permit).toBe(false)
  })

  it('does not classify a receipt-bearing lease as safe before-submit recovery', () => {
    const data=transaction(`select public.claim_local_publish_job('${workspace}','${device}','${digest}');
      update private.local_publish_leases set expires_at=now()-interval '1 minute' where action_request_id='${actions[0]}';
      insert into public.external_action_receipts(workspace_id,action_request_id,attempt_id,receipt_kind,recorded_by)
        select workspace_id,action_request_id,attempt_id,'submission','${owner}' from private.local_publish_leases where action_request_id='${actions[0]}';
      select ${recover(actions[0])};`)
    expect(data.state).toBe('reconcile_required')
  })

  it('fails closed when the submit-boundary assertion is absent at the database boundary', () => {
    const data=transaction(`select public.claim_local_publish_job('${workspace}','${device}','${digest}');
      update private.local_publish_leases set expires_at=now()-interval '1 minute' where action_request_id='${actions[0]}';
      select public.recover_scoped_local_publish_checkpoint('${workspace}','${device}','${digest}','${actions[0]}',
        (select id from private.local_publish_leases where action_request_id='${actions[0]}'),null);`)
    expect(data.state).toBe('blocked')
  })

  it('rejects a ready row that already has a submission receipt', () => {
    const data=transaction(`insert into public.external_action_attempts(id,workspace_id,action_request_id,attempt_number,status,created_by)
      values('${id(800)}','${workspace}','${actions[2]}',1,'unknown_result','${owner}');
      insert into public.external_action_receipts(workspace_id,action_request_id,attempt_id,receipt_kind,recorded_by)
      values('${workspace}','${actions[2]}','${id(800)}','submission','${owner}'); select ${grant()};`)
    expect(data).toBeNull()
  })

  it('quarantines the exact old released lease after a lost auto-requeue acknowledgement without touching other ready work', () => {
    const lease=`(select id from private.local_publish_leases where action_request_id='${actions[0]}')`
    const data=transaction(`select public.claim_local_publish_job('${workspace}','${device}','${digest}');
      update private.local_publish_leases set expires_at=now()-interval '1 minute' where action_request_id='${actions[0]}';
      select public.complete_local_publish_job('${workspace}','${device}','${actions[0]}',${lease},'failed_before_submit',null,null,'DEVICE_OFFLINE');
      select ${grant()}; select ${recover(actions[0])};
      select jsonb_build_object('old',(select status from public.external_action_requests where id='${actions[0]}'),'other',(select status from public.external_action_requests where id='${actions[1]}'));`)
    expect(data).toEqual({ old:'reconfirmation_required',other:'ready' })
  })

  it('rejects an omitted approval fingerprint even on an idempotent selection replay', () => {
    const data=transaction(`select ${grant()}; select public.authorize_local_publish_execution_scope('${workspace}','${owner}',
      '${actions[2]}',null,'${selectedRequest}','${connection}');`)
    expect(data).toBeNull()
  })

  it('reads a ready candidate through the real receipt schema without fabricating an outcome', () => {
    const data=transaction(`select public.find_local_publish_execution_candidate('${workspace}','${owner}',
      '${content[2]}','${version[2]}','${fingerprint[2]}','${connection}');`)
    expect(data).toEqual({ actionId:actions[2],status:'ready',targetExternalId:'scope-blog',resultUrl:null })
  })

  it('selects the latest observed receipt by recorded_at, ignoring newer submission-only receipts', () => {
    const data=transaction(`insert into public.external_action_attempts(id,workspace_id,action_request_id,attempt_number,status,created_by)
      values('${id(801)}','${workspace}','${actions[2]}',1,'succeeded','${owner}');
      update public.external_action_requests set status='succeeded' where id='${actions[2]}';
      insert into public.external_action_receipts(workspace_id,action_request_id,attempt_id,receipt_kind,result_url,recorded_by,recorded_at) values
        ('${workspace}','${actions[2]}','${id(801)}','observed_result','https://blog.naver.com/scope-blog/123456780','${owner}',now()-interval '2 minutes'),
        ('${workspace}','${actions[2]}','${id(801)}','observed_result','https://blog.naver.com/scope-blog/123456789','${owner}',now()-interval '1 minute'),
        ('${workspace}','${actions[2]}','${id(801)}','submission',null,'${owner}',now());
      select public.find_local_publish_execution_candidate('${workspace}','${owner}',
        '${content[2]}','${version[2]}','${fingerprint[2]}','${connection}');`)
    expect(data).toEqual({ actionId:actions[2],status:'succeeded',targetExternalId:'scope-blog',resultUrl:'https://blog.naver.com/scope-blog/123456789' })
  })

  it('creates one lease under concurrent targeted claims and never consumes older ready work', async () => {
    const chosen = value(raw(`begin; set local role service_role; select ${grant()}; commit;`))
    const statement = `begin; set local role service_role; select ${scoped(chosen.scopeId)}; commit;`
    const run = () => new Promise<any>((resolve,reject) => {
      assertIsolated()
      const child = spawn(binary(), args())
      let stdout='', stderr=''
      child.stdout.on('data',(b) => { stdout+=b })
      child.stderr.on('data',(b) => { stderr+=b })
      child.on('error',reject)
      child.on('close',(status) => {
        try { resolve(value({ status, stdout, stderr } as ReturnType<typeof raw>)) } catch(error) { reject(error) }
      })
      child.stdin.end(statement)
    })
    const results = await Promise.all([run(),run()])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(results.find(Boolean).jobId).toBe(actions[2])
    const data = transaction(`select jsonb_build_object('n',(select count(*)::int from private.local_publish_leases where action_request_id='${actions[2]}'),'queue',${queueSnapshot()})`)
    expect(data.n).toBe(1)
    expect(data.queue.old.map((row: any) => row.status)).toEqual(['ready','ready'])
  })
})
