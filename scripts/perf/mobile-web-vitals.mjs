#!/usr/bin/env node
/**
 * 모바일 Web Vitals 기준선 측정 러너 (Linear ANI-1741).
 *
 * 원칙:
 * 1. 서버를 직접 띄우지 않는다. 이미 떠 있는 프로덕션 빌드에 붙는다(빌드 1회 재사용).
 *    서버에 닿지 않으면 통과로 위장하지 않고 즉시 실패한다.
 * 2. 모든 수치는 실행 중 실제로 관측된 값만 기록한다. 표본이 없으면 null + NOT_MEASURED.
 * 3. 기기·네트워크·CPU 스로틀·빌드 SHA·표본 수를 분모로 함께 남긴다.
 * 4. 스로틀을 걸 수 없는 엔진(WebKit)은 그 사실을 지표 옆에 그대로 적는다.
 *
 * 사용 예:
 *   node scripts/perf/mobile-web-vitals.mjs \
 *     --base-url http://127.0.0.1:3311 \
 *     --routes /,/pricing,/login \
 *     --profiles android-4g-mid,ios-4g \
 *     --runs 5 \
 *     --out evidence/mobile-r2/ANI-1741/20261023/baseline.json
 *
 * 선택 인자:
 *   --server-mode dev   dev 서버(압축 전 번들) 측정. 예산 판정 없이 참고값으로만 남긴다.
 *     허용값은 production(기본) · dev 뿐이다. 오타 난 값은 production 으로 승격하지 않고 실패한다.
 *   --allow-redirects true   도착 경로가 달라도 표본을 버리지 않는다(기본: 버린다).
 *     세션 없는 /app 은 /login 으로 이동하므로 기본값에서는 NOT_MEASURED 가 된다.
 *   --interaction-selector   INP 대리 측정에 쓸 클릭 대상 CSS 선택자.
 *     화면마다 상호작용 지점이 다르므로 고정 선택자 하나로는 다른 화면에서 INP 가 항상 비게 된다.
 *   --interaction-index      위 선택자가 여러 개를 잡을 때 첫 번째로 누를 위치(0부터). 기본 0.
 *   --interaction-mode       toggle(기본, 클릭 후 Esc) | click(클릭만)
 *
 * 예) 앱 셸 탭 전환을 재는 경우
 *   --interaction-selector "nav[aria-label='소희 업무 메뉴'] button" \
 *   --interaction-index 4 \
 *   --interaction-mode click
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { chromium, devices, webkit } from '@playwright/test'
import {
  DEFAULT_BUDGETS,
  PERF_PROFILES,
  classifyLanding,
  describeEnvironment,
  describeSourceRevision,
  evaluateRun,
  interactionIndices,
  isScorableStatus,
  overallVerdict,
  parseNextBuildRouteTable,
  sessionWindowCls,
  summarizeChunkSizes,
} from './web-vitals-core.mjs'

const require = createRequire(import.meta.url)

/** 페이지 안에서 PerformanceObserver 로 LCP·CLS·이벤트 지연을 모은다. */
const COLLECTOR = `(() => {
  const state = { lcpMs: null, lcpElement: null, lcpUrl: null, cls: 0, shifts: [], events: [], longTaskCount: 0 }
  window.__perfVitals = state
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        state.lcpMs = entry.startTime
        state.lcpUrl = entry.url || null
        const el = entry.element
        if (el) {
          const id = el.id ? '#' + el.id : ''
          const cls = typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : ''
          state.lcpElement = el.tagName.toLowerCase() + id + cls
        }
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true })
  } catch (_e) {}
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue
        state.cls += entry.value
        state.shifts.push({ value: entry.value, startTime: entry.startTime })
      }
    }).observe({ type: 'layout-shift', buffered: true })
  } catch (_e) {}
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        state.events.push({
          name: entry.name,
          duration: entry.duration,
          startTime: entry.startTime,
          interactionId: entry.interactionId || 0,
        })
      }
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 })
  } catch (_e) {}
  try {
    new PerformanceObserver((list) => { state.longTaskCount += list.getEntries().length })
      .observe({ type: 'longtask', buffered: true })
  } catch (_e) {}
})()`

const CHROMIUM_CDP = new Set(['chromium'])

/** 기본 INP 대리 상호작용 대상. 화면마다 다르므로 --interaction-selector 로 바꿀 수 있다. */
const DEFAULT_INTERACTION_SELECTOR = 'button[aria-label="메뉴 열기"]'

function parseArgs(argv) {
  const args = new Map()
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    const value = argv[i + 1]
    if (!key?.startsWith('--') || value === undefined) throw new Error(`인자 형식 오류: ${key ?? '(없음)'}`)
    args.set(key.slice(2), value)
  }
  return args
}

function list(value, fallback) {
  if (!value) return fallback
  return value.split(',').map((v) => v.trim()).filter(Boolean)
}

async function assertServerReachable(baseUrl) {
  try {
    const res = await fetch(baseUrl, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (error) {
    throw new Error(
      `측정 대상 서버에 연결할 수 없습니다 (${baseUrl}): ${error?.message ?? error}. ` +
        '프로덕션 빌드 서버를 먼저 띄우세요. 러너는 서버를 대신 띄우지 않습니다.',
    )
  }
}

function gitSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

/**
 * 커밋 SHA 만으로는 커밋 전 변경을 측정한 경우를 구분하지 못한다.
 * 작업 트리 오염 여부와 변경 내용 해시를 함께 남겨 서로 다른 빌드가 같은 리비전으로 보이지 않게 한다.
 */
function readSourceRevision(head) {
  try {
    const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()
    const changedFileCount = status ? status.split('\n').length : 0
    const diff = execFileSync('git', ['diff', 'HEAD'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' })
    const diffSha256 = createHash('sha256').update(diff).update(untracked).digest('hex')
    return describeSourceRevision({ head, dirty: changedFileCount > 0, diffSha256, changedFileCount })
  } catch {
    return describeSourceRevision({ head, dirty: null, diffSha256: null, changedFileCount: null })
  }
}

function packageVersion(name) {
  try {
    return require(`${name}/package.json`).version
  } catch {
    return null
  }
}

/**
 * CDP 로 네트워크·CPU 스로틀을 실제 적용한다. 실패하면 조용히 넘기지 않는다.
 *
 * 주의: `downloadThroughput: 0` 은 "무제한"이 아니라 "완전 차단"이다.
 * 그래서 applyNetworkThrottle:false 인 프로필(android-unthrottled)은 네트워크 에뮬레이션을
 * 아예 보내지 않는다. CPU 스로틀은 rate 1 이 사실상 무제한이므로 그대로 적용해도 무해하다.
 */
async function applyChromiumThrottle(page, profile) {
  const session = await page.context().newCDPSession(page)
  if (profile.applyNetworkThrottle !== false) {
    const downloadBytesPerSecond = Math.round((profile.network.downloadKbps * 1024) / 8)
    const uploadBytesPerSecond = Math.round((profile.network.uploadKbps * 1024) / 8)
    await session.send('Network.enable')
    await session.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: profile.network.latencyMs,
      downloadThroughput: downloadBytesPerSecond,
      uploadThroughput: uploadBytesPerSecond,
    })
  }
  await session.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuThrottleRate })
  return { session, networkEmulated: profile.applyNetworkThrottle !== false }
}

async function collectResources(page) {
  return page.evaluate(() => {
    const entries = performance.getEntriesByType('resource')
    const rows = entries.map((e) => ({
      name: e.name,
      initiatorType: e.initiatorType,
      transferSize: e.transferSize || 0,
      encodedBodySize: e.encodedBodySize || 0,
      decodedBodySize: e.decodedBodySize || 0,
      duration: e.duration,
    }))
    const byType = {}
    for (const r of rows) {
      const key = r.initiatorType || 'other'
      byType[key] = byType[key] || { count: 0, transferSize: 0 }
      byType[key].count += 1
      byType[key].transferSize += r.transferSize
    }
    const largest = [...rows].sort((a, b) => b.transferSize - a.transferSize).slice(0, 8)
    const nav = performance.getEntriesByType('navigation')[0]
    return {
      totalTransferSize: rows.reduce((sum, r) => sum + r.transferSize, 0),
      byType,
      largest,
      domContentLoadedMs: nav ? nav.domContentLoadedEventEnd : null,
      loadEventMs: nav ? nav.loadEventEnd : null,
      responseStartMs: nav ? nav.responseStart : null,
    }
  })
}

async function runOnce(
  browser,
  profile,
  baseUrl,
  route,
  settleMs,
  {
    allowRedirects = false,
    interactionSelector = DEFAULT_INTERACTION_SELECTOR,
    interactionIndex = 0,
    interactionMode = 'toggle',
  } = {},
) {
  // 프로필이 주장하는 기기(Pixel 7 / iPhone 14)의 실제 UA·뷰포트·모바일 플래그를 쓴다.
  // 기본 desktop 컨텍스트로 재면 UA 기반 렌더링이 다른 환경을 재고도 기기 이름을 붙이게 된다.
  const descriptor = devices[profile.device]
  if (!descriptor) throw new Error(`Playwright 기기 프로필을 찾을 수 없습니다: ${profile.device}`)
  const context = await browser.newContext({
    ...descriptor,
    viewport: profile.viewport,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  })
  const page = await context.newPage()
  await page.addInitScript(COLLECTOR)

  let session = null
  let networkEmulated = false
  if (CHROMIUM_CDP.has(profile.engine)) {
    const applied = await applyChromiumThrottle(page, profile)
    session = applied.session
    networkEmulated = applied.networkEmulated
  }

  const failures = []
  page.on('requestfailed', (req) => {
    failures.push({ url: req.url(), error: req.failure()?.errorText ?? 'UNKNOWN' })
  })

  const startedAt = new Date().toISOString()
  const wallStart = Date.now()
  const response = await page.goto(`${baseUrl}${route}`, { waitUntil: 'load', timeout: 60_000 })
  await page.waitForTimeout(settleMs)

  // LCP·CLS 는 첫 입력 전 값이 Core Web Vitals 정의다. 상호작용 전에 읽는다.
  const preInteraction = await page.evaluate(() => {
    const s = window.__perfVitals
    return { lcpMs: s.lcpMs, lcpElement: s.lcpElement, lcpUrl: s.lcpUrl, shifts: s.shifts }
  })

  // 스크립트 상호작용으로 INP 대리값을 만든다. 실사용자 필드 INP 가 아님을 결과에 명시한다.
  // 대상 셀렉터는 --interaction-selector 로 바꿀 수 있다(셸 프리뷰처럼 메뉴 버튼이 없는 화면).
  const interactions = []
  const targets = page.locator(interactionSelector)
  const targetCount = await targets.count()
  const action = interactionMode === 'toggle' ? 'click-toggle' : 'click'
  // 시작 위치는 --interaction-index 다. 대상이 1개면 1회만 누른다.
  const baseIndex = targetCount > 0 ? Math.min(interactionIndex, targetCount - 1) : 0
  for (const index of interactionIndices(targetCount, interactionIndex, 2)) {
    try {
      await targets.nth(index).click({ timeout: 5000 })
      await page.waitForTimeout(250)
      if (interactionMode === 'toggle') {
        await page.keyboard.press('Escape')
        await page.waitForTimeout(250)
      }
      interactions.push({ action, selector: interactionSelector, index, ok: true })
    } catch (error) {
      interactions.push({ action, selector: interactionSelector, index, ok: false, error: String(error?.message ?? error).slice(0, 200) })
      break
    }
  }

  const post = await page.evaluate(() => {
    const s = window.__perfVitals
    return {
      events: s.events,
      longTaskCount: s.longTaskCount,
      clsAfterInput: s.cls,
    }
  })

  const resources = await collectResources(page)
  // 컨텍스트를 닫기 전에 도착 URL 을 읽는다. 닫은 뒤에는 리다이렉트 결과를 신뢰할 수 없다.
  const finalUrl = page.url()
  await context.close()

  const interactionEvents = post.events.filter((e) => e.interactionId > 0)
  const inpMs = interactionEvents.length
    ? Math.max(...interactionEvents.map((e) => e.duration))
    : null

  // CLS 는 세션 윈도우 최댓값이다. 전체 시프트 합산은 1초 이상 떨어진 시프트까지 더해 과대평가한다.
  const clsWindow = sessionWindowCls(preInteraction.shifts ?? [])

  const httpStatus = response?.status() ?? null
  // 404·500 페이지는 빠르게 렌더되므로 걸러내지 않으면 오타 난 라우트가 "성능 통과"가 된다.
  const scorable = isScorableStatus(httpStatus)

  // 리다이렉트를 따라가면 다른 화면의 숫자가 이 라우트의 성능으로 기록된다.
  // 세션 없는 /app → /login 이 대표적이다. 도착 경로가 다르면 표본을 버린다.
  const landing = classifyLanding(route, finalUrl, baseUrl)
  const redirectInvalid = !landing.matched && allowRedirects !== true

  const invalidReason = !scorable
    ? `HTTP_${httpStatus ?? 'NO_RESPONSE'}`
    : redirectInvalid
      ? landing.reason
      : null

  return {
    route,
    startedAt,
    wallMs: Date.now() - wallStart,
    httpStatus,
    finalUrl,
    landing,
    ...(invalidReason ? { invalid: true, invalidReason } : {}),
    lcpMs: Number.isFinite(preInteraction.lcpMs) ? Math.round(preInteraction.lcpMs) : null,
    lcpElement: preInteraction.lcpElement,
    lcpUrl: preInteraction.lcpUrl,
    cls: Number(clsWindow.cls.toFixed(4)),
    clsMethod: 'SESSION_WINDOW_MAX',
    clsWindowCount: clsWindow.windowCount,
    shiftCount: (preInteraction.shifts ?? []).length,
    inpMs: Number.isFinite(inpMs) ? Math.round(inpMs) : null,
    // 어떤 요소를 눌러 INP 를 쟀는지 남긴다. 대상이 없으면 INP 가 비는 이유가 여기 있다.
    interactionSelector,
    interactionTargetCount: targetCount,
    interactionCount: interactionEvents.length,
    interactions,
    interactionTarget: {
      selector: interactionSelector,
      baseIndex,
      mode: interactionMode,
      found: targetCount > 0,
    },
    // 대상이 하나뿐이면 두 번째 클릭은 같은 요소다. 그 사실을 숨기지 않는다.
    interactionDistinctTargets: targetCount,
    longTaskCount: post.longTaskCount,
    resources,
    requestFailures: failures.slice(0, 20),
    cdpSessionUsed: Boolean(session),
    networkEmulated,
  }
}

/**
 * `.next/build-manifest.json` 의 rootMainFiles(모든 라우트가 공유하는 청크)를 디스크에서 잰다.
 * 파일이 없으면 null 을 돌려준다 — 없는 값을 0 바이트로 보고하지 않는다.
 */
function readSharedChunkSizes(nextDir) {
  const manifestPath = resolve(nextDir, 'build-manifest.json')
  if (!existsSync(manifestPath)) {
    return { available: false, reason: 'BUILD_MANIFEST_MISSING', summary: null }
  }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    return { available: false, reason: 'BUILD_MANIFEST_UNREADABLE', summary: null }
  }
  const files = Array.isArray(manifest?.rootMainFiles) ? manifest.rootMainFiles : []
  if (files.length === 0) {
    return { available: false, reason: 'ROOT_MAIN_FILES_EMPTY', summary: null }
  }
  const entries = files.map((file) => {
    const absolute = resolve(nextDir, file)
    try {
      return { file, bytes: statSync(absolute).size }
    } catch {
      return { file, bytes: null }
    }
  })
  return {
    available: true,
    reason: null,
    fileList: files,
    summary: summarizeChunkSizes(entries),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = (args.get('base-url') ?? 'http://127.0.0.1:3311').replace(/\/$/u, '')
  const routes = list(args.get('routes'), ['/', '/pricing', '/login'])
  const profileIds = list(args.get('profiles'), ['android-4g-mid'])
  const runs = Number(args.get('runs') ?? 5)
  const settleMs = Number(args.get('settle-ms') ?? 2500)
  const interactionMode = args.get('interaction-mode') ?? 'toggle'
  if (!['toggle', 'click'].includes(interactionMode)) {
    throw new Error(`--interaction-mode 는 toggle 또는 click 이어야 합니다: ${interactionMode}`)
  }
  const interactionIndex = Number(args.get('interaction-index') ?? 0)
  if (!Number.isInteger(interactionIndex) || interactionIndex < 0) {
    throw new Error(`--interaction-index 는 0 이상의 정수여야 합니다: ${interactionIndex}`)
  }
  const outPath = resolve(args.get('out') ?? 'evidence/mobile-r2/ANI-1741/baseline.json')
  const buildLogPath = args.get('build-log')
  // dev 서버는 압축·미니파이 전 번들을 보낸다. production 빌드 예산과 같은 잣대로 판정하면
  // 실제보다 나쁜 수치를 "예산 미달"로 보고하게 되므로, 참고값으로만 남긴다.
  // 허용값을 명시한다. `--server-mode development` 같은 오타를 production 빌드로 승격하면
  // 이 플래그의 존재 이유(dev 수치를 실적 성능으로 오인하지 않기)가 통째로 무너진다.
  const serverModeArg = args.get('server-mode') ?? 'production'
  const SERVER_MODES = { production: 'PRODUCTION_BUILD', dev: 'DEV_SERVER' }
  const serverMode = SERVER_MODES[serverModeArg]
  if (!serverMode) {
    throw new Error(`--server-mode 는 production 또는 dev 여야 합니다: ${serverModeArg}`)
  }
  const allowRedirects = args.get('allow-redirects') === 'true'
  const interactionSelector = args.get('interaction-selector') ?? DEFAULT_INTERACTION_SELECTOR
  const referenceReason = serverMode === 'DEV_SERVER' ? 'DEV_SERVER_NOT_COMPARABLE' : 'REFERENCE_ONLY_PROFILE'

  if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error(`--runs 는 1~20 사이 정수여야 합니다: ${runs}`)
  const profiles = profileIds.map((id) => {
    const profile = PERF_PROFILES[id]
    if (!profile) throw new Error(`알 수 없는 프로필: ${id} (가능: ${Object.keys(PERF_PROFILES).join(', ')})`)
    return profile
  })

  await assertServerReachable(baseUrl)

  const buildTable = buildLogPath && existsSync(buildLogPath)
    ? parseNextBuildRouteTable(readFileSync(buildLogPath, 'utf8'))
    : { routes: [], sharedFirstLoadJsBytes: null, unparsedLines: 0, parsed: false, sizeColumnsAvailable: false }

  // Turbopack 표에는 라우트별 크기가 없다. 번들 분모는 실제 디스크 청크(rootMainFiles)에서 잰다.
  const sharedChunkSizes = readSharedChunkSizes(args.get('next-dir') ?? '.next')

  const sha = args.get('git-sha') ?? gitSha()
  // 같은 SHA 라도 커밋 전 변경을 측정했으면 다른 빌드다. 그 사실을 분모에 남긴다.
  const sourceRevision = readSourceRevision(sha)
  const results = []

  for (const profile of profiles) {
    // dev 서버 측정은 예산 판정을 하지 않는다(참고값). 판정 자체를 막아 FAIL 로 승격되지 않게 한다.
    const effective = serverMode === 'DEV_SERVER' ? { ...profile, budgetApplies: false } : profile
    const launcher = profile.engine === 'webkit' ? webkit : chromium
    const browser = await launcher.launch()
    try {
      for (const route of routes) {
        const samples = []
        for (let i = 0; i < runs; i += 1) {
          const sample = await runOnce(browser, profile, baseUrl, route, settleMs, {
            allowRedirects,
            interactionSelector,
            interactionIndex,
            interactionMode,
          })
          samples.push(sample)
          console.error(
            `[${profile.id}] ${route} run ${i + 1}/${runs} — LCP ${sample.lcpMs ?? 'N/A'}ms CLS ${sample.cls ?? 'N/A'} INP ${sample.inpMs ?? 'N/A'}ms` +
              (sample.invalid ? ` (제외: ${sample.invalidReason})` : ''),
          )
        }
        const evaluated = evaluateRun({ samples, profile: effective, referenceReason })
        if (effective.budgetApplies !== profile.budgetApplies) {
          console.error(
            `[${profile.id}] — ${serverMode} 측정이므로 예산 판정을 끕니다(budgetApplies=false). 참고값으로만 남깁니다.`,
          )
        }
        if (evaluated.rejectedSampleCount > 0) {
          console.error(
            `[${profile.id}] ${route} — 표본 ${evaluated.rejectedSampleCount}개 제외: ${evaluated.rejectedReasons.join(', ')}. ` +
              '오류 페이지는 그 라우트의 성능이 아니므로 점수에 넣지 않습니다.',
          )
        }
        const routeRow = buildTable.routes.find((r) => r.path === route) ?? null
        results.push({
          environment: describeEnvironment({
            // 판정에 실제로 쓴 프로필(effective)을 기록한다. 원본 profile 을 넘기면
            // DEV_SERVER 인데 budgetApplies: true 라고 적혀 증거 소비자를 오도한다.
            profile: effective,
            serverMode,
            originalBudgetApplies: profile.budgetApplies,
            gitSha: sha,
            buildId: require('./../../package.json').version ?? null,
            nodeVersion: process.version,
            playwrightVersion: packageVersion('@playwright/test'),
            sourceRevision,
            context: {
              userAgent: devices[profile.device]?.userAgent ?? null,
              viewport: profile.viewport,
              isMobile: devices[profile.device]?.isMobile ?? null,
              hasTouch: devices[profile.device]?.hasTouch ?? null,
              deviceScaleFactor: devices[profile.device]?.deviceScaleFactor ?? null,
            },
          }),
          route,
          ...evaluated,
          bundle: routeRow
            ? { sizeBytes: routeRow.sizeBytes, firstLoadJsBytes: routeRow.firstLoadJsBytes }
            : { sizeBytes: null, firstLoadJsBytes: null, source: 'NOT_IN_BUILD_TABLE' },
          samples,
        })
      }
    } finally {
      await browser.close()
    }
  }

  const report = {
    schemaVersion: 1,
    issue: 'ANI-1741',
    generatedAt: new Date().toISOString(),
    policy: 'LOCAL_LAB_MEASUREMENT_NO_FIELD_DATA',
    serverMode,
    baseUrl,
    runsPerRoute: runs,
    settleMs,
    interactionSelector,
    interactionIndex,
    interactionMode,
    // 같은 gitSha 라도 dirty 면 다른 빌드다. before/after 를 이 값으로 구분한다.
    sourceRevision,
    budgets: DEFAULT_BUDGETS,
    buildRouteTable: {
      parsed: buildTable.parsed,
      routeCount: buildTable.routes.length,
      sizeColumnsAvailable: buildTable.sizeColumnsAvailable,
      sharedFirstLoadJsBytes: buildTable.sharedFirstLoadJsBytes,
      unparsedLines: buildTable.unparsedLines,
      source: buildLogPath ? 'NEXT_BUILD_STDOUT' : 'NOT_PROVIDED',
    },
    // Turbopack 은 라우트별 First Load JS 를 표에 내지 않는다. 대신 모든 라우트가 공유하는
    // rootMainFiles 를 디스크에서 잰 값을 남긴다. 이 값이 번들 회귀 비교의 실제 분모다.
    sharedChunks: sharedChunkSizes,
    limitations: [
      serverMode === 'DEV_SERVER'
        ? 'DEV_SERVER: 압축·미니파이 전 번들이라 production 빌드 예산으로 판정하지 않는다(참고값 전용).'
        : 'PRODUCTION_BUILD: next build 산출물에 next start 로 붙어 측정했다.',
      'REDIRECT_GUARD: 도착 경로가 측정 라우트와 다르면(예: 세션 없는 /app → /login) 그 표본은 제외한다.',
      'LAB_SYNTHETIC: 실사용자 필드 데이터(CrUX/RUM)가 아니다. 표본은 로컬 실행 n회다.',
      `INP 는 스크립트로 만든 클릭 상호작용(${interactionSelector}, start=${interactionIndex}, mode=${interactionMode})의 최대 지연이며, 실사용자 p75 INP 가 아니다.`,
      'WebKit(ios-4g)은 Playwright 에 CDP 네트워크/CPU 스로틀이 없어 스로틀 없이 측정했다.',
      '단일 머신·단일 시점 측정이므로 절대 성능 보증이 아니라 회귀 비교용 기준선이다.',
      '번들 크기는 Turbopack 표에 없으므로 .next/build-manifest.json 의 rootMainFiles 디스크 크기로 잰다(라우트별 아님).',
    ],
    verdict: overallVerdict(results),
    results,
  }

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ out: outPath, verdict: report.verdict }, null, 2))
  // 예산 미달은 종료코드로 드러낸다. 측정 불가는 실패와 구분해 2로 남긴다.
  // PARTIAL_NOT_MEASURED 도 0 이면 안 된다 — 일부 지표가 빠진 증거를 CI 가 통과로 받아들이게 된다.
  if (report.verdict.status === 'FAIL') process.exitCode = 1
  else if (report.verdict.status === 'NOT_MEASURED') process.exitCode = 2
  else if (report.verdict.status === 'PARTIAL_NOT_MEASURED') process.exitCode = 3
}

main().catch((error) => {
  console.error(`측정 실패: ${error?.message ?? error}`)
  process.exitCode = 1
})
