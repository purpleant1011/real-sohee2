import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('Cloudflare Worker Agent Chat Routing Contract (ANI-1033)', () => {
  const workerEntryPath = path.resolve(process.cwd(), 'worker-entry.js')
  const workerSource = fs.readFileSync(workerEntryPath, 'utf8')

  it('must not intercept /agent/chat directly at the Cloudflare worker entry level', () => {
    // Edge router bypass must not exist
    expect(workerSource).not.toContain("url.pathname.includes('/agent/chat')")
    expect(workerSource).not.toContain('handleEdgeAgentChat(request, env)')
    expect(workerSource).not.toContain('handleEdgeAgentChat')
  })

  it('must delegate all application and agent API requests to OpenNext worker', () => {
    expect(workerSource).toContain('openNextWorker')
    expect(workerSource).toContain('openNextWorker.fetch(request, env, ctx)')
  })

  it('preserves infrastructure-only concerns at edge (scanner block, static cache, headers)', () => {
    expect(workerSource).toContain('Scanner Blocker')
    expect(workerSource).toContain('x-sohee-build')
  })
})
