import { spawn } from 'node:child_process'
import { createHmac, randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Real local JWT signature/expiry + PostgREST role switching. No hosted auth or tenant data. */
export async function verifyPostgrest({ sql, temp, env }) {
  const listener = createServer()
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port
  await new Promise(resolve => listener.close(resolve))
  const secret = randomBytes(32).toString('hex')
  const sign = (sub, extra = {}, signingSecret = secret) => {
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
    const payload = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 120, ...extra })}`
    return `${payload}.${createHmac('sha256', signingSecret).update(payload).digest('base64url')}`
  }
  sql('create role naver_test_auth login noinherit; grant anon,authenticated to naver_test_auth;')
  const config = join(temp, 'postgrest.conf')
  writeFileSync(config, `db-uri="postgresql://naver_test_auth@/postgres?host=${encodeURIComponent(temp)}"\ndb-schemas="public"\ndb-anon-role="anon"\njwt-secret="${secret}"\nserver-host="127.0.0.1"\nserver-port=${port}\nlog-level="crit"\n`, { mode: 0o600 })
  const child = spawn('/opt/homebrew/bin/postgrest', [config], { env, stdio: ['ignore', 'ignore', 'pipe'] })
  let startupError = ''
  child.stderr.on('data', value => { startupError += value })
  child.on('error', () => { startupError = 'PostgREST executable unavailable' })
  const origin = `http://127.0.0.1:${port}`
  const user = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const current = () => JSON.parse(sql(`select json_build_object('p_workspace_id',v.workspace_id,'p_content_id',v.content_id,'p_expected_base_version_id',v.id,'p_expected_base_fingerprint',v.fingerprint) from public.content_versions v join public.content_items i on i.current_version_id=v.id where i.id='30000000-0000-4000-8000-000000000001'`))
  const request = (path, token, body) => fetch(`${origin}/${path}`, {
    method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(5000),
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  try {
    let ready = false
    for (let n = 0; n < 60; n++) {
      if (child.exitCode !== null) throw new Error(`POSTGREST_START_FAILED: ${startupError.slice(-500)}`)
      try {
        const response = await request('rpc/naver_revision_readiness', sign(user(1)), {})
        if (response.status === 200) {
          const payload = await response.json()
          ready = payload.ready === true && payload.contract === 'naver-revision-v1'
        }
      } catch { /* Startup only. */ }
      if (ready) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!ready) throw new Error('POSTGREST_START_TIMEOUT')
    const sourceId = sql("select id from public.content_versions where content_id='30000000-0000-4000-8000-000000000001' and version_number=1").trim()
    for (const actor of [1, 2, 3]) {
      const token = sign(user(actor))
      for (const [command, fields] of [
        ['create_naver_block_revision', { p_block_index: 0, p_replacement_text: `JWT 수정 ${actor}` }],
        ['create_naver_meta_revision', { p_title: `JWT 제목 ${actor}`, p_keywords: ['안내'], p_hashtags: ['#안내'] }],
        ['restore_naver_version', { p_source_version_id: sourceId }],
      ]) {
        const before = current()
        const response = await request(`rpc/${command}`, token, { ...before, ...fields })
        if (response.status !== 200) throw new Error(`JWT_ROLE_COMMAND_FAILED: actor=${actor} command=${command} status=${response.status} ${await response.text()}`)
        const id = await response.json()
        const after = current()
        if (after.p_expected_base_version_id !== id || after.p_expected_base_fingerprint === before.p_expected_base_fingerprint) throw new Error('JWT_VERSION_READBACK_FAILED')
      }
    }
    const countBefore = sql('select count(*) from public.content_versions').trim()
    for (const actor of [4, 5, 6]) {
      const response = await request('rpc/create_naver_block_revision', sign(user(actor)), { ...current(), p_block_index: 0, p_replacement_text: '불허' })
      if (response.status !== 403) throw new Error(`JWT_UNAUTHORIZED_ACTOR_ACCEPTED: actor=${actor} status=${response.status}`)
    }
    for (const token of [null, sign(user(1), {}, 'wrong-test-secret'), sign(user(1), { exp: 1 })]) {
      const response = await request('rpc/create_naver_block_revision', token, { ...current(), p_block_index: 0, p_replacement_text: '불허' })
      if (response.status !== 401) throw new Error(`JWT_INVALID_TOKEN_ACCEPTED: status=${response.status}`)
    }
    const directWrite = await fetch(`${origin}/content_items?id=eq.30000000-0000-4000-8000-000000000001`, {
      method: 'PATCH', signal: AbortSignal.timeout(5000),
      headers: { authorization: `Bearer ${sign(user(1))}`, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'published' }),
    })
    if (directWrite.status !== 403) throw new Error(`JWT_DIRECT_TABLE_WRITE_ALLOWED: status=${directWrite.status}`)
    const hidden = await request('content_items?workspace_id=eq.20000000-0000-4000-8000-000000000002&select=id', sign(user(1)))
    if (hidden.status !== 200 || (await hidden.json()).length !== 0) throw new Error('JWT_CROSS_TENANT_READ_LEAK')
    if (sql('select count(*) from public.content_versions').trim() !== countBefore) throw new Error('JWT_DENIED_REQUEST_MUTATED_DATA')
    console.log('PASS: real HS256 JWT/PostgREST: 9 owner/manager/reviewer commands + version readback; viewer/nonmember/other-tenant 403; anon/forged/expired 401; tenant read isolation')
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM')
      await new Promise(resolve => child.once('close', resolve))
    }
  }
}
