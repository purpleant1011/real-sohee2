import { access, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { verifyBuiltClientPublicEnv, resolveLocalPublicEnv } from './local-public-env.mjs'

const workerPath = new URL('../.open-next/worker.js', import.meta.url)
const buildIdentityPath = new URL('../.open-next/sohee-build.js', import.meta.url)
const clientChunksUrl = new URL('../.open-next/assets/_next/static/chunks/', import.meta.url)
const serverHandlerPath = new URL('../.open-next/server-functions/default/handler.mjs', import.meta.url)
const middlewareHandlerPath = new URL('../.open-next/middleware/handler.mjs', import.meta.url)

await access(workerPath)
await access(buildIdentityPath)
const worker = await readFile(workerPath, 'utf8')
const buildIdentity = await readFile(buildIdentityPath, 'utf8')
const serverHandler = await readFile(serverHandlerPath)
const middlewareHandler = await readFile(middlewareHandlerPath)
const clientChunksPath = fileURLToPath(clientChunksUrl)
const clientChunkFiles = (await readdir(clientChunksPath, { recursive: true }))
  .filter((file) => file.endsWith('.js'))
const clientArtifacts = await Promise.all(
  clientChunkFiles.map((file) => readFile(join(clientChunksPath, file), 'utf8')),
)

if (!/soheeBuildId = "[0-9a-f]{7}"/u.test(buildIdentity)) {
  throw new Error('Cloudflare build identity is missing or invalid')
}

const forbiddenPatterns = [
  'sk-proj-',
  'SUPABASE_SERVICE_ROLE_KEY=',
  'OPENAI_TEXT_API_KEY=',
  'OPENAI_IMAGE_API_KEY=',
]

for (const forbidden of forbiddenPatterns) {
  if (worker.includes(forbidden)) {
    throw new Error(`Cloudflare build contains a forbidden secret pattern: ${forbidden}`)
  }
}

let envToCheck = process.env
if (!envToCheck.NEXT_PUBLIC_SUPABASE_URL) {
  const wranglerText = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
  envToCheck = resolveLocalPublicEnv(process.env, wranglerText, { purpose: 'artifact-verify' })
}
verifyBuiltClientPublicEnv(clientArtifacts, envToCheck)

// Production runs on Workers Paid (10 MiB compressed script limit). Keep headroom below that limit
// and fail the build before a deploy would be rejected. Free plan would be 3 MiB.
const applicationBudgetMiB = Number(process.env.CLOUDFLARE_APPLICATION_BUDGET_MIB ?? '9')
const applicationBudgetBytes = Math.floor(applicationBudgetMiB * 1024 * 1024)
const compressedApplicationBytes = gzipSync(serverHandler, { level: 9 }).byteLength + gzipSync(middlewareHandler, { level: 9 }).byteLength
if (!Number.isFinite(applicationBudgetBytes) || compressedApplicationBytes >= applicationBudgetBytes) {
  throw new Error(`Cloudflare application bundle exceeds the ${applicationBudgetMiB} MiB application budget: ${compressedApplicationBytes} bytes`)
}

console.log(`Cloudflare worker artifact verified (${compressedApplicationBytes} compressed application bytes)`)
