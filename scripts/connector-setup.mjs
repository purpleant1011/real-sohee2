import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  buildChromeLauncherScript,
  installNativeHost,
} from '../connector/native-host/scripts/install.mjs'
import { SOHEE_EXTENSION_ID } from '../connector/shared/extension-id.mjs'

const require = createRequire(import.meta.url)

export function checkNodeVersion(minMajor = 20) {
  const currentMajor = parseInt(process.versions.node.split('.')[0], 10)
  if (currentMajor < minMajor) {
    throw new Error(
      `Node.js 버전이 ${minMajor} 이상이어야 합니다. (현재 버전: v${process.versions.node})\n` +
      `https://nodejs.org 에서 최신 LTS 버전을 설치해 주세요.`
    )
  }
  return true
}

export function checkPlaywrightResolution(startPath = process.cwd(), resolver = null) {
  if (typeof resolver === 'function') {
    return resolver(startPath)
  }
  try {
    const req = createRequire(path.join(startPath, 'package.json'))
    try {
      req.resolve('playwright')
      return { ok: true, package: 'playwright' }
    } catch {
      req.resolve('playwright-core')
      return { ok: true, package: 'playwright-core' }
    }
  } catch {
    try {
      require.resolve('playwright')
      return { ok: true, package: 'playwright' }
    } catch {
      try {
        require.resolve('playwright-core')
        return { ok: true, package: 'playwright-core' }
      } catch {
        return {
          ok: false,
          error:
            `playwright 패키지를 찾을 수 없습니다.\n` +
            `다음 명령어로 설치를 완료한 후 다시 시도해 주세요:\n` +
            `  npm install\n` +
            `  (또는 글로벌 설치: npm install -g playwright)`,
        }
      }
    }
  }
}

export async function runConnectorSetup({
  homeDir = os.homedir(),
  dryRun = false,
  skipBuild = false,
  silent = false,
  platform = process.platform,
  skipPlaywrightCheck = false,
  playwrightResolver = null,
  rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
} = {}) {
  const log = (...args) => { if (!silent) console.log(...args) }

  log('=============================================')
  log('소희 네이버 블로그 자동 게시 연결기 설정')
  log('=============================================\n')

  // 1. Node.js 버전 확인
  checkNodeVersion(20)
  log(`✓ Node.js 버전 확인 완료: v${process.versions.node}`)

  // 2. Playwright 의존성 확인
  if (!skipPlaywrightCheck) {
    const playwrightCheck = typeof playwrightResolver === 'function'
      ? playwrightResolver(rootDir)
      : checkPlaywrightResolution(rootDir)
    if (!playwrightCheck.ok) {
      if (!silent) console.error(playwrightCheck.error)
      throw new Error(playwrightCheck.error)
    }
    log(`✓ Playwright 확인 완료 (${playwrightCheck.package})`)
  }

  // 3. 빌드 실행
  if (!skipBuild && !dryRun) {
    log('\n[1/3] 확장 프로그램 및 로컬 연결기 빌드 중...')
    const extBuild = spawnSync(process.execPath, [path.join(rootDir, 'connector/chrome-extension/scripts/build.mjs')], {
      cwd: rootDir, stdio: silent ? 'ignore' : 'inherit',
    })
    if (extBuild.status !== 0) throw new Error('EXTENSION_BUILD_FAILED')

    const hostBuild = spawnSync(process.execPath, [path.join(rootDir, 'connector/native-host/scripts/build.mjs')], {
      cwd: rootDir, stdio: silent ? 'ignore' : 'inherit',
    })
    if (hostBuild.status !== 0) throw new Error('NATIVE_HOST_BUILD_FAILED')
    log('✓ 빌드 완료')
  } else if (dryRun) {
    log('ℹ --dry-run 모드: 빌드 단계를 건너뜁니다.')
  }

  // 4. 네이티브 메시징 호스트 매니페스트 및 래퍼 스크립트 설치
  log('\n[2/3] Chrome 네이티브 메시징 호스트 등록 중...')
  const installResult = await installNativeHost({
    home: homeDir,
    extensionId: SOHEE_EXTENSION_ID,
    dryRun,
    rootDir: path.join(rootDir, 'connector/native-host'),
    platform,
  })
  log(`✓ 매니페스트 등록 대상 경로:`)
  for (const p of installResult.manifestPaths) {
    log(`  - ${p}`)
  }

  // 5. 소희 크롬 실행기 생성
  log('\n[3/3] 소희 전용 크롬 실행기 생성 중...')
  const launcherContent = buildChromeLauncherScript({
    profileDir: path.join(homeDir, '.sohee/chrome-profile'),
    targetUrl: 'https://example.com/app/content',
  })

  const launcherExtension = platform === 'win32' ? '.bat' : platform === 'darwin' ? '.command' : '.sh'
  const launcherFilename = `소희 크롬${launcherExtension}`
  const launcherPaths = [
    path.join(homeDir, '.sohee', launcherFilename),
    path.join(rootDir, launcherFilename),
  ]

  if (!dryRun) {
    for (const launcherPath of launcherPaths) {
      await mkdir(path.dirname(launcherPath), { recursive: true })
      await writeFile(launcherPath, launcherContent, { mode: 0o755 })
      await chmod(launcherPath, 0o755)
      log(`✓ 실행기 생성 완료: ${launcherPath}`)
    }
  } else {
    for (const launcherPath of launcherPaths) {
      log(`ℹ [드라이런] 실행기 생성 예정: ${launcherPath}`)
    }
  }

  // 6. 다음 안내 출력
  log('\n=============================================')
  log('설치가 성공적으로 준비되었습니다!')
  log('=============================================')
  log('다음 단계 안내:')
  log('1. Chrome 브라우저에서 `chrome://extensions` 접속 후 우측 상단 [개발자 모드]를 켭니다.')
  log('2. [압축해제된 확장 프로그램을 로드합니다] 클릭 후 아래 폴더를 선택합니다:')
  log(`   ${path.join(rootDir, 'connector/chrome-extension/dist')}`)
  log('3. 생성된 [소희 크롬.command]를 실행하여 전용 크롬을 엽니다.')
  log('4. 열린 크롬 창에서 네이버에 1회 로그인합니다.')
  log('5. 소희 웹 화면(https://example.com/app/content)에서 [연결하기]를 누르면 완료됩니다.\n')

  return {
    ok: true,
    dryRun,
    manifest: installResult.manifest,
    manifestPaths: installResult.manifestPaths,
    plannedFiles: [...installResult.plannedFiles, ...launcherPaths],
    extensionId: SOHEE_EXTENSION_ID,
  }
}

async function cli() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const skipBuild = args.includes('--skip-build')
  const homeIndex = args.indexOf('--home')
  const homeDir = homeIndex !== -1 && args[homeIndex + 1] ? args[homeIndex + 1] : os.homedir()

  try {
    await runConnectorSetup({ homeDir, dryRun, skipBuild })
  } catch (err) {
    console.error('\n❌ 설정 중 오류가 발생했습니다:', err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void cli()
}
