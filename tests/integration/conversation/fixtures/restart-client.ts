import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'node:crypto'

// This child process has no production credentials. Fetch is restricted to the
// owned loopback DB; redirects must not bypass the initial origin check.
const port = process.env.SOHEE_MEMORY_API_PORT
if (process.env.SOHEE_MEMORY_DB_TEST !== '1' || !port || !/^\d+$/.test(port)) {
  throw new Error('Owned disposable DB required')
}
const origin = `http://127.0.0.1:${port}`
const originalFetch = globalThis.fetch
const loopbackFetch: typeof fetch = (input, init) => {
  const target = new URL(input instanceof Request ? input.url : String(input))
  if (target.origin !== origin) throw new Error('SANDBOX_NETWORK_BLOCKED')
  target.pathname = target.pathname.replace(/^\/rest\/v1(?=\/|$)/, '')
  const request = input instanceof Request ? new Request(target, input) : target
  return originalFetch(request, { ...init, redirect: 'error' })
}
globalThis.fetch = loopbackFetch
const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
const payload = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
  sub: '20000000-0000-4000-8000-000000000001', role: 'service_role',
  exp: Math.floor(Date.now() / 1000) + 120,
})}`
const signature = createHmac('sha256', 'local-car-test-only-not-a-production-secret-20261028').update(payload).digest('base64url')
const client = createClient(origin, 'local-test-key', {
  global: { fetch: loopbackFetch, headers: { Authorization: `Bearer ${payload}.${signature}` } },
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})
export const createServerSupabaseClient = () => client
export const createAdminSupabaseClient = () => client
