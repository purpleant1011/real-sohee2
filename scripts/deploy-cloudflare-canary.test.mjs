import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { validateCanaryState, planCanaryDeployment, deployCanary } from './deploy-cloudflare-canary.mjs'

const oldVersion = '11111111-1111-4111-8111-111111111111'
const newVersion = '22222222-2222-4222-8222-222222222222'
const deployment = { id: 'deployment-before', created_on: '2026-10-27T00:00:00Z', versions: [{ version_id: oldVersion, percentage: 100 }] }
const state = { branch: 'feat/ani-1889', dirtyPaths: ['.claude/launch.json'], head: 'a'.repeat(40), upstreamHead: 'a'.repeat(40), fixtureEnabled: false }

describe('ANI-1889 zero-percent canary deploy', () => {
  it('allows only the approved pushed branch and leaves launch.json untouched', () => {
    assert.deepEqual(validateCanaryState(state), [])
    for (const change of [
      { branch: 'main' }, { branch: 'feat/other' }, { dirtyPaths: ['src/app/page.tsx'] },
      { head: 'b'.repeat(40) }, { fixtureEnabled: true },
    ]) assert.ok(validateCanaryState({ ...state, ...change }).length > 0)
  })

  it('retains the existing version at 100% and canary at exactly 0%', () => {
    const plan = planCanaryDeployment(deployment, newVersion)
    assert.deepEqual(plan.specs, [`${oldVersion}@100%`, `${newVersion}@0%`])
    assert.equal(plan.overrideHeader, `real-sohee="${newVersion}"`)
  })

  it('replaces only an explicitly identified zero-percent canary, preserving the 100% version', () => {
    const previousCanary = '33333333-3333-4333-8333-333333333333'
    const current = { ...deployment, versions: [
      { version_id: previousCanary, percentage: 0 }, { version_id: oldVersion, percentage: 100 },
    ] }
    assert.deepEqual(planCanaryDeployment(current, newVersion, previousCanary).specs, [`${oldVersion}@100%`, `${newVersion}@0%`])
    for (const invalid of [undefined, newVersion, oldVersion, 'malformed']) {
      assert.throws(() => planCanaryDeployment(current, newVersion, invalid))
    }
    assert.throws(() => planCanaryDeployment(deployment, newVersion, previousCanary))
    assert.throws(() => planCanaryDeployment({ ...current, versions: [
      { version_id: previousCanary, percentage: 1 }, { version_id: oldVersion, percentage: 99 },
    ] }, newVersion, previousCanary))
    assert.throws(() => planCanaryDeployment(current, previousCanary, previousCanary))
  })

  it('refuses ambiguous, split, missing or reused version identities', () => {
    for (const current of [null, { versions: [] }, { versions: [{ version_id: oldVersion, percentage: 50 }] },
      { versions: [{ version_id: oldVersion, percentage: 100 }, { version_id: newVersion, percentage: 0 }] },
    ]) assert.throws(() => planCanaryDeployment(current, newVersion))
    for (const candidate of [oldVersion, '', 'malformed']) assert.throws(() => planCanaryDeployment(deployment, candidate))
  })

  for (const replaceCanaryVersion of [undefined, '33333333-3333-4333-8333-333333333333']) {
  it(`uploads a gated entry and activates only 100/0 (replacement: ${replaceCanaryVersion ?? 'none'})`, async () => {
    const currentDeployment = replaceCanaryVersion ? { ...deployment, versions: [
      { version_id: replaceCanaryVersion, percentage: 0 }, ...deployment.versions,
    ] } : deployment
    const commands = []
    let listCount = 0
    const result = await deployCanary({
      state, replaceCanaryVersion,
      run: async (args) => {
        commands.push(args)
        if (args[0] === 'build') return ''
        if (args.includes('list')) {
          listCount++
          return JSON.stringify([listCount < 3 ? currentDeployment : {
            id: 'deployment-after', created_on: '2026-10-27T00:01:00Z', versions: [
              { version_id: oldVersion, percentage: 100 }, { version_id: newVersion, percentage: 0 },
            ],
          }])
        }
        if (args.includes('upload')) return `Worker Version ID: ${newVersion}`
        return ''
      },
      readState: () => state,
    })
    assert.equal(result.canaryVersion, newVersion)
    const upload = commands.find((args) => args.includes('upload'))
    assert.ok(upload.includes('worker-canary-entry.js'))
    assert.ok(upload.includes('--keep-vars'))
    assert.deepEqual(commands.find((args) => args.includes('deploy')).slice(0, 4), [
      'versions', 'deploy', `${oldVersion}@100%`, `${newVersion}@0%`,
    ])
    assert.ok(!commands.some((args) => args[0] === 'deploy'))
  })
  }

  it('never activates after a concurrent deployment changes the baseline', async () => {
    const commands = []
    let listCount = 0
    await assert.rejects(deployCanary({ state, readState: () => state, run: async (args) => {
      commands.push(args)
      if (args.includes('list')) return JSON.stringify([{ ...deployment, id: ++listCount === 1 ? deployment.id : 'concurrent' }])
      if (args.includes('upload')) return `Worker Version ID: ${newVersion}`
      return ''
    } }), /CANARY_BASELINE_CHANGED/)
    assert.ok(!commands.some((args) => args.includes('deploy')))
  })

  it('accepts only build-generated metadata for the exact source revision after building', async () => {
    const afterBuild = { ...state, packageVersion: '1.0.0', dirtyPaths: ['.claude/launch.json', 'src/generated/build-meta.json'],
      buildMetadata: { version: '1.0.0', sha: state.head } }
    const commands = []
    let lists = 0
    const run = async (args) => {
      commands.push(args)
      if (args.includes('list')) return JSON.stringify([++lists < 3 ? deployment : {
        id: 'after', created_on: '2026-10-27T00:01:00Z', versions: [
          { version_id: oldVersion, percentage: 100 }, { version_id: newVersion, percentage: 0 },
        ],
      }])
      if (args.includes('upload')) return `Worker Version ID: ${newVersion}`
      return ''
    }
    assert.equal((await deployCanary({ state, run, readState: () => afterBuild })).canaryVersion, newVersion)
    lists = 0
    await assert.rejects(deployCanary({ state, run, readState: () => ({ ...afterBuild,
      buildMetadata: { version: '1.0.0', sha: 'b'.repeat(40) },
    }) }), /CANARY_WORKTREE_DIRTY/)
  })

  it('does not activate if the source changes during upload', async () => {
    const commands = []
    let reads = 0
    await assert.rejects(deployCanary({ state,
      readState: () => ++reads === 1 ? state : { ...state, dirtyPaths: ['worker-canary-entry.js'] },
      run: async (args) => {
        commands.push(args)
        if (args.includes('list')) return JSON.stringify([deployment])
        if (args.includes('upload')) return `Worker Version ID: ${newVersion}`
        return ''
      },
    }), /CANARY_WORKTREE_DIRTY/)
    assert.ok(!commands.some((args) => args.includes('deploy')))
  })

  it('does not upload when build fails', async () => {
    const commands = []
    await assert.rejects(deployCanary({ state, readState: () => state, run: async (args) => {
      commands.push(args)
      if (args.includes('list')) return JSON.stringify([deployment])
      if (args[0] === 'build') throw new Error('BUILD_FAILED')
      return ''
    } }), /BUILD_FAILED/)
    assert.ok(!commands.some((args) => args.includes('upload')))
  })

  it('reports deployment readback mismatch rather than claiming success', async () => {
    await assert.rejects(deployCanary({ state, readState: () => state, run: async (args) => {
      if (args.includes('list')) return JSON.stringify([deployment])
      if (args.includes('upload')) return `Worker Version ID: ${newVersion}`
      return ''
    } }), /CANARY_READBACK_MISMATCH/)
  })
})
