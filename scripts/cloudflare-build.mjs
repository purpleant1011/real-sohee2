import { patchLoadCustomCacheHandlers } from './lib/patch-cache-handlers.mjs'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile, copyFile, readdir, rename } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, rmSync, cpSync, symlinkSync, realpathSync } from 'node:fs'
import { resolveCloudflareBuildEnv } from './local-public-env.mjs'
import { TemporaryPatchSession, patchNextServerContent } from './lib/temporary-source-patch.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export class CommandError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'CommandError'
    this.status = status
    this.exitCode = status
  }
}

export function run(command, args, env = process.env, options = {}) {
  const spawn = options.spawnSync || spawnSync
  const result = spawn(command, args, {
    cwd: options.cwd || root,
    env,
    stdio: options.stdio || 'inherit',
    maxBuffer: 1024 * 1024 * 256
  })
  if (result.status !== 0) {
    const status = result.status ?? 1
    throw new CommandError(`Command failed with status ${status}: ${command} ${(args || []).join(' ')}`, status)
  }
  return result
}

export async function buildCloudflare() {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim().toLowerCase()
  const wranglerText = await readFile(join(root, 'wrangler.jsonc'), 'utf8')
  const buildEnv = resolveCloudflareBuildEnv(process.env, wranglerText, sha)
  const cloudflareWebpackEnv = { ...buildEnv, SOHEE_CLOUDFLARE_WEBPACK: '1', NODE_ENV: 'production' }

  const e2eDir = join(root, 'src', 'app', 'e2e-fixture')
  const e2eBackup = join(root, '.e2e-fixture-backup')
  const qaDir = join(root, 'src', 'app', 'v075-qa')
  const qaBackup = join(root, '.v075-qa-backup')

  let movedE2E = false
  let movedQA = false
  const patchSession = new TemporaryPatchSession()

  try {
    if (existsSync(e2eDir)) {
      await rename(e2eDir, e2eBackup)
      movedE2E = true
    }
    if (existsSync(qaDir)) {
      await rename(qaDir, qaBackup)
      movedQA = true
    }

    const skipNextBuild = process.env.SKIP_NEXT_BUILD === '1'
    if (!skipNextBuild) {
      try { rmSync(join(root, '.next'), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch {}
      try { rmSync(join(root, 'node_modules', '.cache'), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch {}
    }
    try { rmSync(join(root, '.open-next'), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch {}

    // Next.js next-server.js의 Dynamic require 방지 임시 패치 (빌드 종료 후 원본 exact bytes 복원)
    const nextServerFiles = [
      join(root, 'node_modules', 'next', 'dist', 'server', 'next-server.js'),
      join(root, 'node_modules', 'next', 'dist', 'esm', 'server', 'next-server.js')
    ]
    for (const nsf of nextServerFiles) {
      await patchSession.patch(nsf, patchNextServerContent)
    }

    // Pre-seed required manifests for Next.js 16 Webpack build
    const preServerDir = join(root, '.next', 'server')
    await mkdir(preServerDir, { recursive: true })
    // Pre-seed _dummy.js placeholder — Next.js SSG generates _dummy.html but
    // then tries to unlink _dummy.js during cleanup, causing ENOENT if missing.
    const preServerPagesDir = join(preServerDir, 'pages')
    await mkdir(preServerPagesDir, { recursive: true })
    await writeFile(join(preServerPagesDir, '_dummy.js'), '// placeholder for SSG cleanup\n', 'utf8')
    await writeFile(join(preServerDir, 'pages-manifest.json'), '{}\n', 'utf8')
    await writeFile(join(preServerDir, 'middleware-manifest.json'), JSON.stringify({
      version: 3,
      middleware: {},
      sortedMiddleware: [],
      functions: {}
    }, null, 2), 'utf8')
    await writeFile(join(preServerDir, 'next-font-manifest.json'), JSON.stringify({
      pages: {},
      app: {},
      appUsingSizeAdjust: false,
      pagesUsingSizeAdjust: false
    }, null, 2), 'utf8')

    if (!skipNextBuild) {
      run(process.execPath, ['scripts/write-build-meta.mjs'], cloudflareWebpackEnv)
      run('npx', ['next', 'build', '--webpack'], cloudflareWebpackEnv)
    }

    // Next.js 서버 빌드 산출물(.next/server)은 CommonJS이므로 type: commonjs 명시 (esbuild CJS 번들링 활성화)
    await writeFile(join(root, '.next', 'server', 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8')
    const standaloneServerDir = join(root, '.next', 'standalone', '.next', 'server')
    await mkdir(standaloneServerDir, { recursive: true })
    await writeFile(join(standaloneServerDir, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8')

    const standaloneNext = join(root, '.next', 'standalone', '.next')
    await mkdir(standaloneNext, { recursive: true })

    const filesToSync = [
      'BUILD_ID',
      'routes-manifest.json',
      'prerender-manifest.json',
      'app-build-manifest.json',
      'build-manifest.json',
      'required-server-files.json',
    ]
    for (const f of filesToSync) {
      const src = join(root, '.next', f)
      const dst = join(standaloneNext, f)
      if (existsSync(src) && !existsSync(dst)) {
        cpSync(src, dst, { recursive: true })
      }
    }

    // 2. Server level manifests & all json files
    const serverSrc = join(root, '.next', 'server')
    const serverDst = join(standaloneNext, 'server')
    await mkdir(serverDst, { recursive: true })
    if (existsSync(serverSrc)) {
      cpSync(serverSrc, serverDst, { recursive: true })
    }

    // Worktree node_modules compatibility: ensure .next/standalone/node_modules exists
    const standaloneNodeModules = join(root, '.next', 'standalone', 'node_modules')
    if (!existsSync(standaloneNodeModules)) {
      symlinkSync(join(root, 'node_modules'), standaloneNodeModules, 'dir')
    }

    const serverDirs = [
      join(root, '.next', 'server'),
      join(root, '.next', 'standalone', '.next', 'server'),
    ]
    for (const dir of serverDirs) {
      await mkdir(dir, { recursive: true })
      if (!existsSync(join(dir, 'pages-manifest.json'))) {
        await writeFile(join(dir, 'pages-manifest.json'), '{}\n', 'utf8')
      }
      if (!existsSync(join(dir, 'middleware-manifest.json'))) {
        await writeFile(join(dir, 'middleware-manifest.json'), JSON.stringify({
          version: 3,
          middleware: {},
          sortedMiddleware: [],
          functions: {}
        }, null, 2), 'utf8')
      }
      if (!existsSync(join(dir, 'next-font-manifest.json'))) {
        await writeFile(join(dir, 'next-font-manifest.json'), JSON.stringify({
          pages: {},
          app: {},
          appUsingSizeAdjust: false,
          pagesUsingSizeAdjust: false
        }, null, 2), 'utf8')
      }

      // Ensure _global-error nft.json exists
      const globalErrorDir = join(dir, 'app', '_global-error')
      await mkdir(globalErrorDir, { recursive: true })
      if (!existsSync(join(globalErrorDir, 'page.js.nft.json'))) {
        await writeFile(join(globalErrorDir, 'page.js.nft.json'), JSON.stringify({ version: 1, files: [] }), 'utf8')
      }
    }

    const dirsToProtect = [
      { target: join(root, 'node_modules', 'sharp'), backup: join(root, 'node_modules', '.sharp-cf-backup') },
      { target: join(root, 'node_modules', '@img'), backup: join(root, 'node_modules', '.img-cf-backup') },
      { target: join(root, '..', '..', 'node_modules', 'sharp'), backup: join(root, '..', '..', 'node_modules', '.sharp-cf-backup-worktree') },
      { target: join(root, '..', '..', 'node_modules', '@img'), backup: join(root, '..', '..', 'node_modules', '.img-cf-backup-worktree') },
      { target: join(root, '.next', 'standalone', 'node_modules', 'sharp'), backup: join(root, '.next', 'standalone', 'node_modules', '.sharp-backup') },
      { target: join(root, '.next', 'standalone', 'node_modules', '@img'), backup: join(root, '.next', 'standalone', 'node_modules', '.img-backup') },
    ]
    const movedDirs = []

    try {
      for (const item of dirsToProtect) {
        if (existsSync(item.target)) {
          await rename(item.target, item.backup)
          movedDirs.push(item)
        }
      }
      // Guarantee middleware-manifest.json exists for OpenNext — Next.js 16 migrated
      // middleware to "proxy" and no longer emits this file, but OpenNext still reads it.
      const ensureManifestDirs = [
        join(root, '.next', 'server'),
        join(root, '.next', 'standalone', '.next', 'server'),
      ]
      const defaultMiddlewareManifest = JSON.stringify({
        version: 3, middleware: {}, sortedMiddleware: [], functions: {}
      }, null, 2)
      for (const mdir of ensureManifestDirs) {
        await mkdir(mdir, { recursive: true })
        const mpath = join(mdir, 'middleware-manifest.json')
        if (!existsSync(mpath)) {
          await writeFile(mpath, defaultMiddlewareManifest, 'utf8')
        }
      }
      run('npx', ['opennextjs-cloudflare', 'build', '--skipNextBuild'], cloudflareWebpackEnv)
    } finally {
      for (const item of movedDirs.reverse()) {
        if (existsSync(item.backup)) {
          await rename(item.backup, item.target)
        }
      }
    }
  } finally {
    const restorationErrors = []
    try {
      await patchSession.restore()
    } catch (err) {
      restorationErrors.push(err)
    }
    try {
      if (movedE2E && existsSync(e2eBackup)) {
        await rename(e2eBackup, e2eDir)
      }
    } catch (err) {
      restorationErrors.push(err)
    }
    try {
      if (movedQA && existsSync(qaBackup)) {
        await rename(qaBackup, qaDir)
      }
    } catch (err) {
      restorationErrors.push(err)
    }
    if (restorationErrors.length > 0) {
      if (restorationErrors.length === 1) throw restorationErrors[0]
      throw new AggregateError(restorationErrors, 'Build restoration cleanup failed')
    }
  }

  // 런타임 loadManifest 안전 패치: 누락된 font/optional manifest에 대해 안전한 기본값 반환
  const handlerFiles = [
    join(root, '.open-next', 'server-functions', 'default', 'handler.mjs'),
    join(root, '.open-next', 'server-functions', 'default', 'index.mjs'),
    join(root, '.open-next', 'worker.js'),
  ]
  for (const hFile of handlerFiles) {
    if (existsSync(hFile)) {
      let code = await readFile(hFile, 'utf8')
      if (code.includes('Unexpected loadManifest')) {
        code = code.replace(
          /throw new Error\(`Unexpected loadManifest\(\$\{[^}]+\}\) call!\`\);?/g,
          'return { pages: {}, app: {}, appUsingSizeAdjust: false, pagesUsingSizeAdjust: false };'
        )
      }
      if (code.includes('loadCustomCacheHandlers')) {
        code = patchLoadCustomCacheHandlers(code)
      }
      await writeFile(hFile, code, 'utf8')
    }
  }

  // Post-process OpenNext artifacts with esbuild minification to stay well under Cloudflare's limit.
  // console.log/debug/info are marked pure so they get dropped when unused,
  // while console.error and console.warn are preserved for production diagnostics.
  console.log('⚡ Minifying OpenNext server & middleware handlers...')
  const serverHandler = join(root, '.open-next', 'server-functions', 'default', 'handler.mjs')
  const middlewareHandler = join(root, '.open-next', 'middleware', 'handler.mjs')
  const workerEntry = join(root, '.open-next', 'worker.js')

  const esbuildFlags = [
    '--minify',
    '--legal-comments=none',
    '--drop:debugger',
    '--pure:console.log',
    '--pure:console.debug',
    '--pure:console.info',
    '--tree-shaking=true',
    '--platform=neutral',
    '--format=esm',
    '--allow-overwrite',
    '--log-level=warning',
    '--banner:js=var module = globalThis.module = globalThis.module || { exports: {} }; var exports = globalThis.exports = globalThis.exports || {};'
  ]

  run('npx', [
    'esbuild',
    serverHandler,
    `--outfile=${serverHandler}`,
    ...esbuildFlags
  ])

  run('npx', [
    'esbuild',
    middlewareHandler,
    `--outfile=${middlewareHandler}`,
    ...esbuildFlags
  ])

  run('npx', [
    'esbuild',
    workerEntry,
    `--outfile=${workerEntry}`,
    ...esbuildFlags
  ])

  // 런타임 Dynamic require 안전 패치 및 Global module/exports 주입
  const globalShim = 'var module = globalThis.module = globalThis.module || { exports: {} }; var exports = globalThis.exports = globalThis.exports || {};\n'
  const postFiles = [serverHandler, middlewareHandler, workerEntry]
  for (const pFile of postFiles) {
    if (existsSync(pFile)) {
      let code = await readFile(pFile, 'utf8')
      const dynamicRequirePattern = /throw\s+Error\((['"])Dynamic require of \1\+([a-zA-Z0-9_$]+)\+\1 is not supported\1\)/g
      code = code.replace(
        dynamicRequirePattern,
        'if ($2 && typeof $2 === "string" && ($2.includes("manifest") || $2.includes("BUILD_ID") || $2.includes("required-server-files"))) { return { version: 3, pages: {}, app: {}, middleware: {}, sortedMiddleware: [], functions: {}, appUsingSizeAdjust: false, pagesUsingSizeAdjust: false }; } throw Error("Dynamic require of \\""+$2+"\\" is not supported")'
      )
      const target = "throw Error('Dynamic require of \"'+P+'\" is not supported')"
      const replacement = 'if (P && typeof P === "string" && (P.includes("manifest") || P.includes("BUILD_ID") || P.includes("required-server-files"))) { return { version: 3, pages: {}, app: {}, middleware: {}, sortedMiddleware: [], functions: {}, appUsingSizeAdjust: false, pagesUsingSizeAdjust: false }; } throw Error(\'Dynamic require of "\'+P+\'" is not supported\')'
      code = code.replaceAll(target, replacement)
      if (!code.startsWith('var module =')) {
        code = globalShim + code
      }
      await writeFile(pFile, code, 'utf8')
    }
  }

  const generated = join(root, '.open-next', 'sohee-build.js')
  await mkdir(dirname(generated), { recursive: true })
  await writeFile(generated, `export const soheeBuildId = ${JSON.stringify(sha.slice(0, 7))}\n`, 'utf8')

  // Pre-rendered HTML Assets Synchronizer:
  // Copies static HTML from .next/server/app to .open-next/assets so Cloudflare Assets binding can serve them with 0ms CPU.
  const appServerDir = join(root, '.next', 'server', 'app')
  if (existsSync(appServerDir)) {
    const syncHtml = async (srcDir, relSub = '') => {
      const entries = await readdir(srcDir, { withFileTypes: true })
      for (const ent of entries) {
        const full = join(srcDir, ent.name)
        if (ent.isDirectory()) {
          const nextRel = ent.name.startsWith('(') ? relSub : join(relSub, ent.name)
          await syncHtml(full, nextRel)
        } else if (ent.name.endsWith('.html') && !ent.name.startsWith('_dummy')) {
          const outName = ent.name === '_not-found.html' ? '404.html' : ent.name
          const outDir = join(root, '.open-next', 'assets', relSub)
          await mkdir(outDir, { recursive: true })
          await copyFile(full, join(outDir, outName))
        }
      }
    }
    await syncHtml(appServerDir)
  }

  run(process.execPath, ['scripts/verify-cloudflare-build.mjs'], buildEnv)
}

const isDirectRun = () => {
  if (!process.argv[1]) return false
  try {
    const currentScript = fileURLToPath(import.meta.url)
    return resolve(process.argv[1]) === currentScript || realpathSync(process.argv[1]) === realpathSync(currentScript)
  } catch {
    return false
  }
}

if (isDirectRun()) {
  let exitCode = 0
  try {
    await buildCloudflare()
  } catch (err) {
    exitCode = typeof err?.status === 'number' ? err.status : (typeof err?.exitCode === 'number' ? err.exitCode : 1)
    console.error(err?.message || err)
  } finally {
    if (exitCode !== 0) {
      process.exitCode = exitCode
    }
  }
}
