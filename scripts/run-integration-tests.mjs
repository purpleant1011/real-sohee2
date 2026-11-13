import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
const wranglerSource = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')

function readWranglerString(name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = wranglerSource.match(
    new RegExp(`"${escapedName}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`),
  )

  if (!match?.[1]) throw new Error('integration_public_env_missing')
  return JSON.parse(match[1])
}

function readAdminSecret() {
  const existingSecret = (
    process.env.SOHEE_INTEGRATION_ADMIN_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim()
  if (existingSecret) return existingSecret

  if (process.platform !== 'darwin' || !process.env.USER) {
    throw new Error('integration_admin_secret_missing')
  }

  for (const service of ['example.com/SUPABASE_INTEGRATION_SECRET_KEY', 'example.com/SUPABASE_SERVICE_ROLE_KEY']) {
    try {
      const secret = execFileSync(
        'security',
        [
          'find-generic-password',
          '-s',
          service,
          '-w',
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim()

      if (secret) return secret
    } catch {}
  }

  throw new Error('integration_admin_secret_missing')
}


const child = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)),
    'run',
    '--config',
    'vitest.integration.config.ts',
    ...process.argv.slice(2),
  ],
  {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL:
        process.env.NEXT_PUBLIC_SUPABASE_URL || readWranglerString('NEXT_PUBLIC_SUPABASE_URL'),
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
        readWranglerString('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
      SOHEE_INTEGRATION_ADMIN_SECRET_KEY: readAdminSecret(),
    },
    stdio: 'inherit',
  },
)

if (child.error) throw new Error('integration_runner_failed')
process.exit(child.status ?? 1)
