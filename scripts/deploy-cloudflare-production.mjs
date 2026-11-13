import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export function validateDeployState({ branch, dirty, head, upstreamHead, fixtureEnabled = false }) {
  const errors = []
  if (branch !== 'main') errors.push('DEPLOY_BRANCH_NOT_ALLOWED')
  if (dirty) errors.push('DEPLOY_WORKTREE_DIRTY')
  if (!head || head !== upstreamHead) errors.push('DEPLOY_UPSTREAM_MISMATCH')
  if (fixtureEnabled) errors.push('DEPLOY_FIXTURE_FLAG_FORBIDDEN')
  return errors
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env: process.env, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

export function readDeployState() {
  const branch = process.env.GITHUB_REF_NAME || git(['branch', '--show-current'])
  const head = git(['rev-parse', 'HEAD'])
  const upstreamHead = process.env.GITHUB_ACTIONS === 'true'
    ? git(['rev-parse', `origin/${branch}`])
    : git(['rev-parse', '@{upstream}'])
  return Object.freeze({
    branch,
    dirty: git(['status', '--porcelain']).length > 0,
    head,
    upstreamHead,
    fixtureEnabled:
      process.env.E2E_APP_SHELL_FIXTURE !== undefined ||
      process.env.E2E_ADMIN_SETUP_FIXTURE !== undefined,
  })
}

async function main() {
  const state = readDeployState()
  const errors = validateDeployState(state)
  if (errors.length > 0) {
    console.error(`Production deploy blocked: ${errors.join(', ')}`)
    process.exit(1)
  }

  // Live read-only schema/RPC/ACL contract, independent of hosted migration timestamp aliases.
  // Never apply migrations during app deployment or accept an offline readiness assertion.
  run(process.execPath, ['scripts/sns-release-database-gate.mjs', 'ready'])
  run(process.execPath, ['scripts/cloudflare-build.mjs'])
  
  // Direct Production Deploy to 100% Traffic
  console.log('⚡ Deploying fresh build directly to Cloudflare production...')
  run('npx', ['wrangler', 'deploy', '--keep-vars', '--config', join(root, 'wrangler.jsonc')])
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
