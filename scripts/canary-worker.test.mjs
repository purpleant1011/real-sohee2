import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { createCanaryWorker, authorizeCanaryRequest } from './canary-worker.mjs'

const workspace = '00000000-0000-4000-8000-0000000000a2'
const allowed = { id: 'owner', email: 'admin@example.com' }
const request = (path, options = {}) => new Request(`https://example.com${path}`, {
  ...options,
  headers: { cookie: `sohee_active_workspace_id=${workspace}`, ...options.headers },
})

function harness(identity = allowed, ownsWorkspace = true, upstreamResponse) {
  const calls = []
  const client = {
    auth: { getUser: async () => ({ data: { user: identity }, error: null }) },
    from(table) {
      assert.equal(table, 'workspaces')
      const query = {
        select: () => query,
        eq: (key, value) => { calls.push([key, value]); return query },
        maybeSingle: async () => ({ data: ownsWorkspace ? { id: workspace } : null, error: null }),
      }
      return query
    },
  }
  let dispatches = 0
  const worker = createCanaryWorker({
    fetch: async () => { dispatches++; return upstreamResponse ?? new Response('new app') },
  }, (req, env) => authorizeCanaryRequest(req, env, () => client))
  return { worker, calls, dispatches: () => dispatches }
}

const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public' }

describe('authenticated H03 canary boundary', () => {
  for (const path of ['/app', '/_next/static/app.js', '/index.html', `/api/workspaces/${workspace}/agent/activity`]) {
    it(`blocks unauthenticated requests before serving ${path}`, async () => {
      const h = harness(null)
      const response = await h.worker.fetch(request(path), env, {})
      assert.equal(response.status, 401)
      assert.equal(h.dispatches(), 0)
      assert.match(response.headers.get('cache-control'), /no-store/)
    })
  }

  it('rejects another authenticated email even with the intended workspace', async () => {
    const h = harness({ id: 'other', email: 'other@example.com' })
    const response = await h.worker.fetch(request(`/api/workspaces/${workspace}/agent/chat`), env, {})
    assert.equal(response.status, 403)
    assert.equal(h.dispatches(), 0)
  })

  it('requires server-confirmed ownership, not just the allowed email', async () => {
    const h = harness(allowed, false)
    const response = await h.worker.fetch(request('/app'), env, {})
    assert.equal(response.status, 403)
    assert.equal(h.dispatches(), 0)
    assert.deepEqual(h.calls, [['id', workspace], ['created_by', 'owner']])
  })

  for (const path of ['/api/workspaces/other/agent/chat', '/api/workspaces/active', '/api/admin/users', '/api/cron/run']) {
    it(`does not execute out-of-scope API ${path}`, async () => {
      const h = harness()
      const response = await h.worker.fetch(request(path), env, {})
      assert.equal(response.status, 403)
      assert.equal(h.dispatches(), 0)
    })
  }

  for (const path of ['/api/channels', '/api/channels/credentials']) {
    it(`pins authenticated channel reads to the approved workspace: ${path}`, async () => {
      let forwardedUrl
      const h = harness()
      const worker = createCanaryWorker({ fetch: async (req) => {
        forwardedUrl = new URL(req.url)
        return Response.json({ success: true })
      } }, (req, env) => authorizeCanaryRequest(req, env, () => ({
        auth: { getUser: async () => ({ data: { user: allowed }, error: null }) },
        from: () => {
          const query = { select: () => query, eq: () => query,
            maybeSingle: async () => ({ data: { id: workspace }, error: null }) }
          return query
        },
      })))
      assert.equal((await worker.fetch(request(path), env, {})).status, 200)
      assert.equal(forwardedUrl.searchParams.get('workspaceId'), workspace)
      for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) {
        assert.equal((await h.worker.fetch(request(path, { method }), env, {})).status, 403)
      }
      assert.equal((await h.worker.fetch(request(`${path}?workspaceId=other`), env, {})).status, 403)
      assert.equal((await harness(null).worker.fetch(request(path), env, {})).status, 401)
      assert.equal(h.dispatches(), 0)
    })
  }

  it('serves the scoped API only after authentication and ownership checks', async () => {
    const h = harness()
    const response = await h.worker.fetch(request(`/api/workspaces/${workspace}/agent/activity`), env, {})
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'new app')
    assert.equal(response.headers.get('x-sohee-canary'), 'h03')
    assert.match(response.headers.get('cache-control'), /no-store/)
    assert.equal(h.dispatches(), 1)
  })

  it('projects only the allowed workspace from the real workspace-list response', async () => {
    const h = harness(allowed, true, Response.json({ data: {
      loadState: 'ready', activeId: workspace, fellBack: false,
      workspaces: [{ id: workspace, name: 'real store' }, { id: 'other', name: 'private store' }],
    } }))
    const response = await h.worker.fetch(request('/api/workspaces'), env, {})
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).data.workspaces, [{ id: workspace, name: 'real store' }])
  })

  it('never substitutes a fake workspace list on upstream failure', async () => {
    const h = harness(allowed, true, Response.json({ error: 'upstream failed' }, { status: 500 }))
    const response = await h.worker.fetch(request('/api/workspaces'), env, {})
    assert.equal(response.status, 500)
    assert.deepEqual(await response.json(), { error: 'upstream failed' })
  })

  it('rejects an upstream list selecting another workspace', async () => {
    const h = harness(allowed, true, Response.json({ data: {
      activeId: 'other', workspaces: [{ id: workspace }],
    } }))
    assert.equal((await h.worker.fetch(request('/api/workspaces'), env, {})).status, 503)
  })

  it('does not allow workspace-list mutations', async () => {
    const h = harness()
    assert.equal((await h.worker.fetch(request('/api/workspaces', { method: 'POST' }), env, {})).status, 403)
    assert.equal(h.dispatches(), 0)
  })

  it('fails closed without auth configuration', async () => {
    const h = harness()
    const response = await h.worker.fetch(request('/app'), {}, {})
    assert.equal(response.status, 503)
    assert.equal(h.dispatches(), 0)
  })

  it('does not expose auth failure details or dispatch on auth outage', async () => {
    const worker = createCanaryWorker({ fetch: () => assert.fail('must not dispatch') }, async () => { throw new Error('secret diagnostic') })
    const response = await worker.fetch(request('/app'), env, {})
    assert.equal(response.status, 503)
    assert.doesNotMatch(await response.text(), /secret diagnostic/)
  })

  for (const cookie of ['', 'sohee_active_workspace_id=other']) {
    it(`rejects missing or different active workspace: ${cookie}`, async () => {
      const h = harness()
      const response = await h.worker.fetch(request('/app', { headers: { cookie } }), env, {})
      assert.equal(response.status, 403)
      assert.equal(h.dispatches(), 0)
    })
  }

  it('rejects a conflicting workspace query even on the scoped path', async () => {
    const h = harness()
    const response = await h.worker.fetch(request(`/api/workspaces/${workspace}/agent/chat?workspaceId=other`), env, {})
    assert.equal(response.status, 403)
    assert.equal(h.dispatches(), 0)
  })

  it('rejects a nested conflicting workspace in a JSON command', async () => {
    const h = harness()
    const response = await h.worker.fetch(request(`/api/workspaces/${workspace}/agent/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command: { workspace_id: 'other' } }),
    }), env, {})
    assert.equal(response.status, 403)
    assert.equal(h.dispatches(), 0)
  })

  for (const path of ['/admin', '/%61pi/admin/users', '/api%2fadmin/users', '/app/%2e%2e%2fapi%2fadmin/users']) {
    it(`rejects non-app pages and ambiguous encoded routes: ${path}`, async () => {
      const h = harness()
      assert.equal((await h.worker.fetch(request(path), env, {})).status, 403)
      assert.equal(h.dispatches(), 0)
    })
  }

  it('preserves a scoped command body for the downstream route', async () => {
    const h = harness()
    const req = request(`/api/workspaces/${workspace}/agent/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: workspace, message: '목표 입력' }),
    })
    assert.equal((await h.worker.fetch(req, env, {})).status, 200)
    assert.equal((await req.json()).message, '목표 입력')
  })

  it('forwards refreshed auth cookies to the app and browser without dropping other cookies', async () => {
    let forwardedCookie
    const worker = createCanaryWorker({ fetch: async (req) => {
      forwardedCookie = req.headers.get('cookie')
      return new Response('app')
    } }, async () => ({ cookies: [{ name: 'sb-session', value: 'rotated', options: { path: '/', httpOnly: true } }] }))
    const response = await worker.fetch(request('/app', { headers: {
      cookie: `sohee_active_workspace_id=${workspace}; sb-session=old`,
    } }), env, {})
    assert.match(forwardedCookie, /sb-session=rotated/)
    assert.match(forwardedCookie, /sohee_active_workspace_id=f23209fb/)
    assert.match(response.headers.get('set-cookie'), /sb-session=rotated/)
  })

  it('does not run scheduled tasks or acknowledge queued jobs in the canary', async () => {
    let retried = 0
    const worker = createCanaryWorker({
      scheduled: () => assert.fail('must not run global scheduled tasks'),
      queue: () => assert.fail('must not consume production jobs'),
    })
    await worker.scheduled({}, env, {})
    await worker.queue({ retryAll: () => { retried++ } }, env, {})
    assert.equal(retried, 1)
  })
})
