import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { loadWorkspaceImageStyle } from './workspace-image-style-repository'

function client(result: unknown, calls: string[] = []) {
  const query: Record<string, unknown> = {}
  for (const name of ['eq', 'in']) query[name] = (...args: unknown[]) => { calls.push(`${name}:${args.join('|')}`); return query }
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return { from: () => ({ select: () => query }) }
}

describe('loadWorkspaceImageStyle', () => {
  it('reads only active image rules of the workspace and picks the custom style', async () => {
    const calls: string[] = []
    const style = await loadWorkspaceImageStyle(client({
      data: [{ rule_key: 'custom-image-style-v1', structured_rule: { custom: { subject: '네일', people: 'hands', avoid: [] } } }],
      error: null,
    }, calls), 'ws-1')
    expect(style?.subject).toBe('네일')
    expect(calls).toEqual(expect.arrayContaining(['eq:workspace_id|ws-1', 'eq:rule_type|image_generation', 'eq:status|active']))
  })

  it('returns null on read errors instead of blocking generation', async () => {
    expect(await loadWorkspaceImageStyle(client({ data: null, error: { message: 'x' } }), 'ws-1')).toBeNull()
    expect(await loadWorkspaceImageStyle({ from: () => { throw new Error('boom') } }, 'ws-1')).toBeNull()
  })
})
