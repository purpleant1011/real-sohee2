import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function validateCanaryState(state, { afterBuild = false } = {}) {
  const errors = []
  const generatedMetadataMatches = afterBuild && state.buildMetadata?.sha === state.head &&
    state.buildMetadata?.version === state.packageVersion && typeof state.packageVersion === 'string' &&
    Object.keys(state.buildMetadata).sort().join(',') === 'sha,version'
  if (state.branch !== 'feat/ani-1889') errors.push('CANARY_BRANCH_NOT_ALLOWED')
  if (!Array.isArray(state.dirtyPaths) || state.dirtyPaths.some((path) => path !== '.claude/launch.json' &&
      !(path === 'src/generated/build-meta.json' && generatedMetadataMatches))) errors.push('CANARY_WORKTREE_DIRTY')
  if (!/^[0-9a-f]{40}$/.test(state.head ?? '') || state.head !== state.upstreamHead) errors.push('CANARY_UPSTREAM_MISMATCH')
  if (state.fixtureEnabled) errors.push('CANARY_FIXTURE_FORBIDDEN')
  return errors
}

export function planCanaryDeployment(current, canaryVersion, replaceCanaryVersion) {
  const versions = current?.versions
  const baseline = Array.isArray(versions) ? versions.find((item) => item.percentage === 100) : null
  const validVersions = Array.isArray(versions) && (replaceCanaryVersion === undefined
    ? versions.length === 1
    : UUID.test(replaceCanaryVersion) && versions.length === 2 &&
      versions.some((item) => item.version_id === replaceCanaryVersion && item.percentage === 0))
  if (!current?.id || !validVersions || !baseline || !UUID.test(baseline.version_id) ||
      !UUID.test(canaryVersion) || versions.some((item) => item.version_id === canaryVersion)) {
    throw new Error('CANARY_BASELINE_INVALID')
  }
  return {
    specs: [`${baseline.version_id}@100%`, `${canaryVersion}@0%`],
    overrideHeader: `real-sohee="${canaryVersion}"`,
  }
}

function latestDeployment(output) {
  const deployments = JSON.parse(output)
  if (!Array.isArray(deployments) || deployments.length === 0 ||
      deployments.some((item) => !item.id || !Number.isFinite(Date.parse(item.created_on)))) {
    throw new Error('CANARY_DEPLOYMENT_LIST_INVALID')
  }
  return [...deployments].sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0]
}

function requireCleanState(state, options) {
  const errors = validateCanaryState(state, options)
  if (errors.length) throw new Error(errors.join(', '))
}

export async function deployCanary({ state, run, readState, replaceCanaryVersion }) {
  requireCleanState(state)
  const list = ['deployments', 'list', '--json', '--config', 'wrangler.jsonc']
  const baseline = latestDeployment(await run(list))
  // Validate the baseline before spending time building or uploading a version.
  planCanaryDeployment(baseline, '00000000-0000-4000-8000-000000000000', replaceCanaryVersion)
  const baselineVersion = baseline.versions.find((item) => item.percentage === 100).version_id
  await run(['build'])
  const afterBuild = await readState()
  requireCleanState(afterBuild, { afterBuild: true })
  if (afterBuild.head !== state.head) throw new Error('CANARY_SOURCE_CHANGED')
  const output = await run(['versions', 'upload', 'worker-canary-entry.js', '--config', 'wrangler.jsonc',
    '--keep-vars', '--tag', `ani-1889-${state.head.slice(0, 12)}`, '--message', 'ANI-1889 authenticated H03 zero-percent canary'])
  const version = output.match(/Worker Version ID:\s*([0-9a-f-]{36})/i)?.[1]
  const plan = planCanaryDeployment(baseline, version, replaceCanaryVersion)
  const current = latestDeployment(await run(list))
  if (current.id !== baseline.id || JSON.stringify(current.versions) !== JSON.stringify(baseline.versions)) {
    throw new Error('CANARY_BASELINE_CHANGED')
  }
  const beforeActivation = await readState()
  requireCleanState(beforeActivation, { afterBuild: true })
  if (beforeActivation.head !== state.head) throw new Error('CANARY_SOURCE_CHANGED')
  await run(['versions', 'deploy', ...plan.specs, '--config', 'wrangler.jsonc', '--yes',
    '--message', 'ANI-1889: existing 100%, authenticated H03 canary 0%'])
  const readback = latestDeployment(await run(list))
  const versions = readback.versions
  if (!Array.isArray(versions) || versions.length !== 2 ||
      !versions.some((item) => item.version_id === baselineVersion && item.percentage === 100) ||
      !versions.some((item) => item.version_id === version && item.percentage === 0)) {
    throw new Error('CANARY_READBACK_MISMATCH')
  }
  return { baselineVersion, canaryVersion: version,
    deploymentId: readback.id, overrideHeader: plan.overrideHeader }
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function readState() {
  return {
    branch: git(['branch', '--show-current']),
    head: git(['rev-parse', 'HEAD']),
    upstreamHead: git(['rev-parse', '@{upstream}']),
    packageVersion: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
    buildMetadata: JSON.parse(readFileSync(join(root, 'src/generated/build-meta.json'), 'utf8')),
    dirtyPaths: execFileSync('git', ['status', '--porcelain', '-z'], { cwd: root, encoding: 'utf8' })
      .split('\0').filter(Boolean).map((line) => line.slice(3)),
    fixtureEnabled: process.env.E2E_APP_SHELL_FIXTURE !== undefined || process.env.E2E_ADMIN_SETUP_FIXTURE !== undefined || process.env.SKIP_NEXT_BUILD !== undefined,
  }
}

function run(args) {
  if (args[0] === 'build') {
    const result = spawnSync(process.execPath, ['scripts/cloudflare-build.mjs'], { cwd: root, stdio: 'inherit', env: process.env })
    if (result.status !== 0) throw new Error('CANARY_BUILD_FAILED')
    return ''
  }
  return execFileSync(join(root, 'node_modules', '.bin', 'wrangler'), args,
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await deployCanary({ state: readState(), run, readState,
    replaceCanaryVersion: process.env.H03_REPLACE_CANARY_VERSION })
  console.log(JSON.stringify(result))
}
