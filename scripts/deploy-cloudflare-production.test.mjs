import { describe, expect, it } from 'vitest'
import { validateDeployState } from './deploy-cloudflare-production.mjs'

const ready = Object.freeze({
  branch: 'main',
  dirty: false,
  head: 'a'.repeat(40),
  upstreamHead: 'a'.repeat(40),
  fixtureEnabled: false,
})

describe('production deployment preflight', () => {
  it('accepts only a clean main branch that matches its upstream', () => {
    expect(validateDeployState(ready)).toEqual([])
  })

  it.each([
    [{ ...ready, branch: 'codex/report' }, 'DEPLOY_BRANCH_NOT_ALLOWED'],
    [{ ...ready, dirty: true }, 'DEPLOY_WORKTREE_DIRTY'],
    [{ ...ready, upstreamHead: 'b'.repeat(40) }, 'DEPLOY_UPSTREAM_MISMATCH'],
    [{ ...ready, fixtureEnabled: true }, 'DEPLOY_FIXTURE_FLAG_FORBIDDEN'],
  ])('rejects unsafe state %#', (state, code) => {
    expect(validateDeployState(state)).toContain(code)
  })
})
