import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr'

const WORKSPACE_ID = '00000000-0000-4000-8000-0000000000a2'
const EMAIL = 'admin@example.com'
const NO_STORE = { 'cache-control': 'private, no-store', 'x-sohee-canary': 'h03' }

function failure(status) {
  return Response.json({ error: 'CANARY_ACCESS_DENIED' }, { status, headers: NO_STORE })
}

function isWorkspaceKey(key) {
  return ['workspace', 'workspaceid'].includes(key.toLowerCase().replaceAll('_', ''))
}

function hasConflictingWorkspace(value) {
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(([key, item]) =>
    (isWorkspaceKey(key) && item !== WORKSPACE_ID) || hasConflictingWorkspace(item))
}

// This entry is uploaded only as a zero-percent version. Existing production entry is unchanged.
export async function authorizeCanaryRequest(request, env, createClient = createServerClient) {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return { response: failure(503) }
  }
  const cookies = []
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => parseCookieHeader(request.headers.get('cookie') ?? ''),
      setAll: (values) => cookies.push(...values),
    },
  })
  // getUser verifies the session with Auth; an unverified cookie/JWT/email header is never identity.
  const { data, error } = await client.auth.getUser()
  if (error || !data?.user) return { response: failure(401) }
  if (data.user.email !== EMAIL) return { response: failure(403) }
  const { data: owner, error: ownerError } = await client.from('workspaces')
    .select('id').eq('id', WORKSPACE_ID).eq('created_by', data.user.id).maybeSingle()
  if (ownerError || owner?.id !== WORKSPACE_ID) return { response: failure(403) }

  const selected = parseCookieHeader(request.headers.get('cookie') ?? '')
    .filter((cookie) => cookie.name === 'sohee_active_workspace_id')
  if (selected.length !== 1 || selected[0].value !== WORKSPACE_ID) return { response: failure(403) }

  const url = new URL(request.url)
  // Refuse encoded routing separators/aliases rather than disagreeing with Next's decoding.
  if (url.pathname.includes('%')) return { response: failure(403) }
  const appPage = url.pathname === '/app' || url.pathname.startsWith('/app/')
  const asset = ['/_next/static/', '/brand/', '/fonts/', '/icons/'].some((prefix) => url.pathname.startsWith(prefix)) ||
    ['/favicon.ico', '/manifest.webmanifest', '/_next/image'].includes(url.pathname)
  if (!url.pathname.startsWith('/api/') && !(request.method === 'GET' || request.method === 'HEAD')) return { response: failure(403) }
  if (!url.pathname.startsWith('/api/') && !appPage && !asset) return { response: failure(403) }
  if ([...url.searchParams].some(([key, value]) => isWorkspaceKey(key) && value !== WORKSPACE_ID)) {
    return { response: failure(403) }
  }
  if (!['GET', 'HEAD'].includes(request.method) && request.body) {
    if (!request.headers.get('content-type')?.startsWith('application/json')) return { response: failure(403) }
    const body = await request.clone().json()
    if (hasConflictingWorkspace(body)) return { response: failure(403) }
  }
  const workspaceList = url.pathname === '/api/workspaces' && request.method === 'GET'
  const channelRead = request.method === 'GET' && ['/api/channels', '/api/channels/credentials'].includes(url.pathname)
  if (url.pathname.startsWith('/api/') && !workspaceList && !channelRead && !url.pathname.startsWith(`/api/workspaces/${WORKSPACE_ID}/`)) {
    return { response: failure(403) }
  }
  // Legacy channel reads have no workspace path segment. Pin their server-side resolver explicitly.
  if (channelRead) url.searchParams.set('workspaceId', WORKSPACE_ID)
  return { cookies, workspaceList, url: channelRead ? url.href : undefined }
}

export function createCanaryWorker(worker, authorize = authorizeCanaryRequest) {
  return {
    async fetch(request, env, ctx) {
      try {
        const access = await authorize(request, env)
        if (access.response) return access.response
        let forwardedRequest = access.url ? new Request(access.url, request) : request
        if (access.cookies?.length) {
          const cookies = new Map(parseCookieHeader(request.headers.get('cookie') ?? '').map(({ name, value }) => [name, value]))
          for (const { name, value } of access.cookies) cookies.set(name, value)
          const headers = new Headers(request.headers)
          headers.set('cookie', [...cookies].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('; '))
          forwardedRequest = new Request(forwardedRequest, { headers })
        }
        let response = await worker.fetch(forwardedRequest, env, ctx)
        if (access.workspaceList && response.ok) {
          const payload = await response.json()
          if (payload?.data?.activeId !== WORKSPACE_ID || !Array.isArray(payload.data.workspaces)) return failure(503)
          const workspaces = payload.data.workspaces.filter((item) => item.id === WORKSPACE_ID)
          if (workspaces.length !== 1) return failure(503)
          response = Response.json({ data: { ...payload.data, workspaces } }, { status: response.status, headers: response.headers })
          response.headers.delete('content-length')
          response.headers.delete('content-encoding')
          response.headers.delete('etag')
        }
        const headers = new Headers(response.headers)
        for (const [name, value] of Object.entries(NO_STORE)) headers.set(name, value)
        for (const cookie of access.cookies ?? []) {
          headers.append('set-cookie', serializeCookieHeader(cookie.name, cookie.value, cookie.options))
        }
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
      } catch {
        // Do not leak auth cookies, upstream diagnostics or customer data into logs/evidence.
        return failure(503)
      }
    },
    async scheduled() {
      // Scheduled work remains on the current 100% production version, never this canary.
    },
    async queue(batch) {
      // Never acknowledge or execute a production batch if accidentally routed to this version.
      batch.retryAll()
    },
  }
}
