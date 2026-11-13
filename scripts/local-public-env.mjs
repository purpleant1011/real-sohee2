import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PRODUCTION_SUPABASE_REF = 'your-project-ref'
const FIRST_POST_FLAG = 'NEXT_PUBLIC_MOBILE_R2_FIRSTPOST'

const PUBLIC_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
]

export const VALID_PURPOSES = [
  'cloudflare-build',
  'artifact-verify',
  'allow-production-read',
]

export function isProductionSupabaseUrl(url) {
  if (!url || typeof url !== 'string') return false
  return (
    url.includes(PRODUCTION_SUPABASE_REF) ||
    url.includes('example.com')
  )
}

function extractJsonString(source, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`"${escapedKey}"\\s*:\\s*"([^"]*)"`))
  return match?.[1]
}

export function resolveLocalPublicEnv(currentEnv, wranglerText, options = {}) {
  const { purpose } = options
  const isAuthorizedProductionPurpose =
    purpose === 'cloudflare-build' ||
    purpose === 'artifact-verify' ||
    purpose === 'allow-production-read'

  const resolved = { ...currentEnv }

  // 1. Guard against explicit injection of production URL in local env without explicit purpose
  const explicitUrl = currentEnv['NEXT_PUBLIC_SUPABASE_URL']
  if (explicitUrl && isProductionSupabaseUrl(explicitUrl) && !isAuthorizedProductionPurpose) {
    throw new Error(
      `[SECURITY FAIL-CLOSED] 환경 변수에 운영 Supabase URL(${explicitUrl})이 지정되어 있습니다. 로컬 개발 환경에서 운영 DB 연결은 기본 차단됩니다. 의도적인 경우 '--allow-production-read' 플래그 또는 명시적 purpose 옵션을 제공하세요.`
    )
  }

  // 2. Resolve missing public keys from wrangler.jsonc with fail-closed production check
  for (const key of PUBLIC_KEYS) {
    if (!resolved[key]) {
      const extracted = extractJsonString(wranglerText, key)
      if (
        key === 'NEXT_PUBLIC_SUPABASE_URL' &&
        isProductionSupabaseUrl(extracted) &&
        !isAuthorizedProductionPurpose
      ) {
        throw new Error(
          `[SECURITY FAIL-CLOSED] 로컬 Supabase 환경 변수가 설정되지 않았으며, 운영 Supabase(${extracted})로의 자동 폴백은 운영 데이터 쓰기 및 오염 방지를 위해 차단되었습니다. 로컬 개발 시에는 .env.local 또는 환경 변수에 로컬 Supabase URL(예: http://127.0.0.1:54321)을 지정하거나, 의도적인 경우 '--allow-production-read' 플래그를 추가하세요. (빌드/검증 도구는 options.purpose를 명시해야 합니다)`
        )
      }
      resolved[key] = extracted
    }
  }

  if (PUBLIC_KEYS.some((key) => !resolved[key])) {
    throw new Error('로컬 공개 설정을 준비하지 못했습니다.')
  }

  if (isProductionSupabaseUrl(resolved.NEXT_PUBLIC_SUPABASE_URL) && purpose === 'allow-production-read') {
    console.warn(
      "\n⚠️  [SECURITY WARNING] '--allow-production-read' 플래그에 의해 로컬 개발 환경에 운영 Supabase 설정이 연결됩니다. 운영 데이터에 쓰기 작업이 발생하지 않도록 각별히 주의하세요.\n"
    )
  }

  return resolved
}

export function resolveCloudflareBuildEnv(currentEnv, wranglerText, buildSha) {
  // Keep the compiled client flag aligned with the declared Worker configuration.
  const firstPostFlag = extractJsonString(wranglerText, FIRST_POST_FLAG) ?? 'off'
  if (firstPostFlag !== 'on' && firstPostFlag !== 'off') {
    throw new Error('Invalid R2 first-post build flag: expected on or off')
  }
  if (currentEnv[FIRST_POST_FLAG] !== undefined && currentEnv[FIRST_POST_FLAG] !== firstPostFlag) {
    throw new Error('R2 first-post build flag conflicts with Worker configuration')
  }
  return {
    ...resolveLocalPublicEnv(currentEnv, wranglerText, { purpose: 'cloudflare-build' }),
    [FIRST_POST_FLAG]: firstPostFlag,
    NEXT_PUBLIC_SOHEE_BUILD_SHA: buildSha,
  }
}

export function verifyBuiltClientPublicEnv(artifacts, publicEnv) {
  const runtimePattern = /\.env\.(?:NEXT_PUBLIC_SUPABASE_(?:URL|PUBLISHABLE_KEY)|NEXT_PUBLIC_MOBILE_R2_FIRSTPOST)/u
  if (artifacts.some((artifact) => runtimePattern.test(artifact))) {
    throw new Error('Cloudflare client artifact still depends on runtime public environment variables')
  }

  for (const key of PUBLIC_KEYS) {
    const value = publicEnv[key]
    if (!value || !artifacts.some((artifact) => artifact.includes(value))) {
      throw new Error(`Cloudflare client artifact is missing ${key}`)
    }
  }
}

async function runNextDev() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
  const projectRoot = path.resolve(scriptDirectory, '..')
  const wranglerText = await readFile(path.join(projectRoot, 'wrangler.jsonc'), 'utf8')

  const args = process.argv.slice(2)
  const allowProdFlag = args.includes('--allow-production-read') || args.includes('--allow-production-env')
  const forwardArgs = args.filter((arg) => arg !== '--allow-production-read' && arg !== '--allow-production-env')

  let env
  try {
    env = resolveLocalPublicEnv(
      process.env,
      wranglerText,
      allowProdFlag ? { purpose: 'allow-production-read' } : {}
    )
  } catch (err) {
    console.error('\n🚨 [치명적 보안 차단]:', err.message, '\n')
    process.exit(1)
  }

  const nextBin = path.join(projectRoot, 'node_modules', 'next', 'dist', 'bin', 'next')
  const child = spawn(process.execPath, [nextBin, 'dev', ...forwardArgs], {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exitCode = code ?? 1
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runNextDev().catch(() => {
    console.error('로컬 개발 서버를 시작하지 못했습니다. 공개 연결 설정을 확인해 주세요.')
    process.exit(1)
  })
}
