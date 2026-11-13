// @vitest-environment node
import { createServer, type Server, type RequestListener } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const baseFetch = globalThis.fetch
const servers: Server[] = []

async function listen(handler: RequestListener) {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Owned loopback port required')
  return { origin: `http://127.0.0.1:${address.port}`, port: String(address.port) }
}

async function installSandbox(port: string) {
  vi.stubEnv('SOHEE_MEMORY_DB_TEST', '1')
  vi.stubEnv('SOHEE_MEMORY_API_PORT', port)
  await import('../integration/conversation/fixtures/restart-client')
}

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('fetch', baseFetch)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections()
  })))
})

describe('restart fixture fetch sandbox', () => {
  it.each([301, 302, 303, 307, 308])('blocks HTTP %s redirects before reaching a different loopback origin', async status => {
    let foreignRequests = 0
    const foreign = await listen((_req, res) => {
      foreignRequests++
      res.end('must not be reached')
    })
    const owned = await listen((_req, res) => {
      res.writeHead(status, { Location: `${foreign.origin}/outside` })
      res.end()
    })
    await installSandbox(owned.port)

    const outcome = await fetch(`${owned.origin}/rest/v1/redirect`, { redirect: 'follow' })
      .then(() => 'resolved', () => 'rejected')
    expect({ outcome, foreignRequests }).toEqual({ outcome: 'rejected', foreignRequests: 0 })
  })

  it('preserves Request method, body and headers while rewriting only the PostgREST prefix', async () => {
    const owned = await listen(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({
        method: req.method, path: req.url, body: Buffer.concat(chunks).toString(),
        authorization: req.headers.authorization,
      }))
    })
    await installSandbox(owned.port)

    const response = await fetch(new Request(`${owned.origin}/rest/v1/conversation_jobs?select=id`, {
      method: 'POST', body: JSON.stringify({ localFixture: true }),
      headers: { Authorization: 'Bearer local-fixture-only', 'Content-Type': 'application/json' },
    }))
    expect(await response.json()).toEqual({
      method: 'POST', path: '/conversation_jobs?select=id', body: '{"localFixture":true}',
      authorization: 'Bearer local-fixture-only',
    })
  })

  it.each(['string', 'URL', 'Request'])('rejects a direct foreign %s input before transport', async kind => {
    let foreignRequests = 0
    const foreign = await listen((_req, res) => { foreignRequests++; res.end() })
    const owned = await listen((_req, res) => res.end())
    await installSandbox(owned.port)
    const target = `${foreign.origin}/rest/v1/conversation_jobs`
    const input = kind === 'URL' ? new URL(target) : kind === 'Request' ? new Request(target) : target

    await expect(Promise.resolve().then(() => fetch(input))).rejects.toThrow('SANDBOX_NETWORK_BLOCKED')
    expect(foreignRequests).toBe(0)
  })
})
