#!/usr/bin/env node

/**
 * 동적 층: 렌더된 화면 텍스트 금칙어 스캔 (ANI-1553 v2)
 *
 * 정적 lint(index.mjs)는 소스의 문자열만 본다. 그래서 `{state}` 처럼 변수에 담긴 상태 코드가
 * 화면에서 `보관 ERROR · 외부 게시 ERROR` 로 조립되는 경우는 못 잡는다.
 * 이 스크립트는 개발 갤러리(/dev/*)를 ego-browser(Ego Lite)로 실제 렌더한 뒤
 * 화면에 보이는 텍스트 노드와 aria-label/title/placeholder/alt 값을 같은 규칙(rules.json)으로 검사한다.
 *
 * 사용법
 *   npm run lint:user-copy:rendered
 *   node scripts/lint-user-copy/scan-rendered.mjs --base-url http://localhost:3000   # 이미 떠 있는 개발 서버 재사용
 *   node scripts/lint-user-copy/scan-rendered.mjs --routes /dev/vault-board --json
 *
 * 개발 서버가 없으면 임의의 빈 포트에 `npm run dev` 와 같은 서버를 직접 띄우고 끝나면 종료한다.
 * ego-browser 를 쓸 수 없으면 통과로 위장하지 않고 사유와 함께 종료 코드 2로 실패한다.
 */

import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { loadRules, matchText } from './matcher.mjs'

export const DEFAULT_ROUTES = ['/dev/preview-gallery', '/dev/empty-states', '/dev/vault-board', '/dev/channel-studio', '/dev/channel-studio/studio']
export const DRIVER_MARKER = '__LINT_USER_COPY_RENDERED__'

const REPO_ROOT = path.resolve(import.meta.dirname, '../..')

/**
 * 렌더 결과 항목을 규칙으로 검사한다 (순수 함수).
 * @param {Array<{ route: string, kind: 'text' | 'attr', attr?: string, text: string, where?: string }>} entries
 * @param {Array} rules
 */
export function scanRenderedEntries(entries, rules) {
  const violations = []
  const warnings = []

  for (const entry of entries) {
    if (!entry || typeof entry.text !== 'string' || !entry.text.trim()) continue
    // 렌더된 텍스트는 정의상 사용자 문구이므로 'ui' 규칙 전체 + 렌더 전용('rendered') 규칙을 적용한다.
    const matches = [
      ...matchText(entry.text, entry.route, rules, { context: 'ui' }),
      ...matchText(entry.text, entry.route, rules, { context: 'rendered' }),
    ]
    const seen = new Set()
    for (const m of matches) {
      const key = `${m.ruleId}:${m.index}:${m.matched}`
      if (seen.has(key)) continue
      seen.add(key)
      const finding = {
        route: entry.route,
        kind: entry.kind,
        attr: entry.attr,
        where: entry.where,
        ruleId: m.ruleId,
        ruleName: m.ruleName,
        severity: m.severity,
        matched: m.matched,
        snippet: entry.text.replace(/\s+/g, ' ').trim().slice(0, 100),
      }
      if (m.severity === 'warn') warnings.push(finding)
      else violations.push(finding)
    }
  }

  return { violations, warnings }
}

/** 드라이버 stdout 에서 마커 줄(JSON)을 파싱한다. */
export function parseDriverOutput(stdout, stderr = '') {
  const pages = []
  for (const line of `${stdout || ''}\n${stderr || ''}`.split('\n')) {
    const idx = line.indexOf(DRIVER_MARKER)
    if (idx === -1) continue
    const json = line.slice(idx + DRIVER_MARKER.length).trim()
    try {
      pages.push(JSON.parse(json))
    } catch {
      throw new Error(`드라이버 출력 JSON을 해석하지 못했습니다: ${json.slice(0, 120)}`)
    }
  }
  return pages
}

/**
 * ego-browser 에서 실행할 드라이버 스크립트를 만든다.
 * 이 문자열은 `ego-browser nodejs` 런타임에서 실행되며, 화면 텍스트 노드와 사용자 노출 속성만 수집한다.
 */
export function buildDriverScript({ baseUrl, routes }) {
  const payload = JSON.stringify({ baseUrl, routes, marker: DRIVER_MARKER })
  return `
const cfg = ${payload};
const task = await taskSpace("lint-user-copy rendered scan");
const page = task.page("p1");
console.error("[scan-rendered] taskSpaceId=" + task.spaceId);

const collect = () => {
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
  const ATTRS = ["aria-label", "aria-description", "aria-roledescription", "aria-valuetext", "title", "placeholder", "alt"];
  const out = [];
  const describe = (el) => {
    const parts = [];
    for (let cur = el, depth = 0; cur && cur !== document.body && depth < 4; cur = cur.parentElement, depth++) {
      const area = cur.getAttribute && (cur.getAttribute("data-gallery-area") || cur.getAttribute("aria-label"));
      parts.unshift(cur.tagName.toLowerCase() + (area ? "[" + area.slice(0, 30) + "]" : ""));
    }
    return parts.join(" > ");
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType === 1) {
      const el = node;
      if (SKIP.has(el.tagName) || el.tagName === "NEXTJS-PORTAL") continue;
      for (const attr of ATTRS) {
        const v = el.getAttribute(attr);
        if (v && v.trim()) out.push({ kind: "attr", attr, text: v.trim(), where: describe(el) });
      }
    } else if (node.nodeType === 3) {
      const parent = node.parentElement;
      if (!parent || SKIP.has(parent.tagName) || parent.closest("nextjs-portal")) continue;
      const t = (node.nodeValue || "").replace(/\\s+/g, " ").trim();
      if (t) out.push({ kind: "text", text: t, where: describe(parent) });
    }
  }
  const title = (document.title || "").trim();
  if (title) out.unshift({ kind: "text", text: title, where: "document.title" });
  return out;
};

for (const route of cfg.routes) {
  await page.goto(cfg.baseUrl + route, { waitUntil: "load", timeout: 120000 });
  await page.waitForSelector("main", { state: "attached", timeout: 60000 });
  await page.waitForTimeout(400);
  const entries = await page.evaluate(collect);
  console.log(cfg.marker + " " + JSON.stringify({ route, url: cfg.baseUrl + route, entries }));
}

await task.finish({ keep: [] });
`
}

function findEgoBrowser() {
  const candidates = [process.env.EGO_BROWSER_BIN, 'ego-browser', path.join(os.homedir(), '.local/bin/ego-browser')].filter(Boolean)
  for (const cand of candidates) {
    const probe = spawnSync(cand, ['--help'], { encoding: 'utf8', timeout: 20000 })
    if (!probe.error) return cand
  }
  return null
}

async function isReachable(url, timeoutMs = 3000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return res.status < 500
  } catch {
    return false
  }
}

async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

/** 개발 서버를 띄운다. 이미 떠 있으면 재사용하고 stop() 은 아무것도 하지 않는다. */
async function ensureDevServer({ baseUrl, probeRoute, log }) {
  if (baseUrl) {
    if (!(await isReachable(baseUrl + probeRoute, 60000))) {
      throw new Error(`지정한 개발 서버에 연결할 수 없습니다: ${baseUrl}`)
    }
    return { baseUrl, stop: () => {} }
  }

  const port = await findFreePort()
  const url = `http://127.0.0.1:${port}`
  log(`개발 서버를 시작합니다 (포트 ${port})...`)
  const extraArgs = (process.env.LINT_RENDERED_DEV_ARGS || '').split(' ').filter(Boolean)
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'scripts/local-public-env.mjs'), '-p', String(port), ...extraArgs], {
    cwd: REPO_ROOT,
    env: { ...process.env, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  let output = ''
  const capture = chunk => {
    output = (output + chunk.toString()).slice(-6000)
  }
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)
  let exited = false
  child.on('exit', () => {
    exited = true
  })

  const stop = () => {
    if (exited) return
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      try {
        child.kill('SIGTERM')
      } catch {
        // 이미 종료됨
      }
    }
  }
  process.once('SIGINT', () => {
    stop()
    process.exit(130)
  })

  const deadline = Date.now() + 240000
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(`개발 서버가 시작 직후 종료되었습니다.\n${output.trim().split('\n').slice(-12).join('\n')}`)
    }
    if (await isReachable(url + probeRoute, 8000)) {
      return { baseUrl: url, stop }
    }
    await new Promise(r => setTimeout(r, 1500))
  }
  stop()
  throw new Error(`개발 서버가 제한 시간(240초) 안에 준비되지 않았습니다.\n${output.trim().split('\n').slice(-12).join('\n')}`)
}

/**
 * 렌더 스캔 실행.
 * @returns {Promise<{ success: boolean, pages: Array, violations: Array, warnings: Array, error?: string }>}
 */
export async function runRenderedScan(options = {}) {
  const routes = options.routes && options.routes.length > 0 ? options.routes : DEFAULT_ROUTES
  const log = options.log || (msg => console.error(`[scan-rendered] ${msg}`))
  const rules = loadRules(options.rulesPath)

  const ego = findEgoBrowser()
  if (!ego) {
    return {
      success: false,
      pages: [],
      violations: [],
      warnings: [],
      error: 'ego-browser CLI 를 찾을 수 없습니다 (PATH 또는 ~/.local/bin). Ego Lite 설치/온보딩 후 다시 실행하세요. 렌더 스캔은 통과로 간주하지 않습니다.',
    }
  }

  let server
  try {
    server = await ensureDevServer({ baseUrl: options.baseUrl, probeRoute: routes[0], log })

    // 모든 경로가 200 으로 렌더되는지 먼저 확인 (production 에서는 notFound() 이므로 스캔이 무의미하다)
    for (const route of routes) {
      const res = await fetch(server.baseUrl + route, { signal: AbortSignal.timeout(120000) })
      if (res.status !== 200) {
        throw new Error(`${route} 가 HTTP ${res.status} 를 반환했습니다. 개발 서버(NODE_ENV=development)에서만 열리는 경로입니다.`)
      }
    }

    log(`ego-browser 로 ${routes.length}개 경로를 렌더합니다: ${routes.join(', ')}`)
    const script = buildDriverScript({ baseUrl: server.baseUrl, routes })
    const run = spawnSync(ego, ['nodejs'], { input: script, encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024 })
    if (run.error || run.status !== 0) {
      throw new Error(`ego-browser 실행 실패 (exit ${run.status ?? 'n/a'}): ${(run.error?.message || run.stderr || run.stdout || '').toString().trim().slice(-800)}`)
    }
    if (/\[ego-browser:notice\]/.test(`${run.stdout}${run.stderr}`)) {
      log('Ego Lite 업데이트 알림이 있습니다 (ego-browser upgrade 는 사용자 승인 후 실행).')
    }

    const pages = parseDriverOutput(run.stdout, run.stderr)
    if (pages.length !== routes.length) {
      throw new Error(`렌더 결과가 부족합니다: 기대 ${routes.length}개 경로, 수집 ${pages.length}개\n${(run.stderr || '').toString().slice(-600)}`)
    }

    const entries = pages.flatMap(p => p.entries.map(e => ({ ...e, route: p.route })))
    const { violations, warnings } = scanRenderedEntries(entries, rules)
    return {
      success: violations.length === 0,
      pages: pages.map(p => ({ route: p.route, url: p.url, entryCount: p.entries.length, textChars: p.entries.reduce((n, e) => n + e.text.length, 0) })),
      violations,
      warnings,
    }
  } catch (err) {
    return { success: false, pages: [], violations: [], warnings: [], error: err instanceof Error ? err.message : String(err) }
  } finally {
    server?.stop()
  }
}

function parseArgs(argv) {
  const args = { json: false, routes: [], baseUrl: undefined }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') args.json = true
    else if (a === '--base-url') args.baseUrl = argv[++i]
    else if (a === '--routes') args.routes = String(argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean)
  }
  return args
}

function printReport(result, routes) {
  console.log('='.repeat(70))
  console.log('  🖥️  Sohee Rendered Copy Scan (ANI-1553 v2, ego-browser)')
  console.log('='.repeat(70))
  if (result.error) {
    console.error(`❌ [ERROR] 렌더 스캔을 실행하지 못했습니다: ${result.error}`)
    return
  }
  for (const p of result.pages) {
    console.log(`  - ${p.route}: 텍스트/속성 ${p.entryCount}개 (${p.textChars}자) 검사`)
  }
  console.log(`대상 경로: ${routes.length}개 / 위반: ${result.violations.length}건 / 경고: ${result.warnings.length}건`)
  console.log('-'.repeat(70))
  for (const v of result.violations) {
    console.error(`  ❌ ${v.route} [${v.ruleId}] "${v.matched}" (${v.kind}${v.attr ? `:${v.attr}` : ''}) @ ${v.where || '-'}`)
    console.error(`     "${v.snippet}"`)
  }
  for (const w of result.warnings.slice(0, 20)) {
    console.log(`  ⚠️  ${w.route} [${w.ruleId}] "${w.matched}" @ ${w.where || '-'} → "${w.snippet}"`)
  }
  if (result.violations.length === 0) {
    console.log('✅ [PASS] 렌더된 화면에서 금칙어 위반 0건')
  } else {
    console.error(`❌ [FAIL] 렌더된 화면에서 금칙어 위반 ${result.violations.length}건`)
  }
  console.log('='.repeat(70))
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const args = parseArgs(process.argv.slice(2))
  const routes = args.routes.length > 0 ? args.routes : DEFAULT_ROUTES
  runRenderedScan({ routes, baseUrl: args.baseUrl })
    .then(result => {
      if (args.json) {
        console.log(JSON.stringify(result, null, 2))
      } else {
        printReport(result, routes)
      }
      // 2: 스캔 자체를 못 돌림 (통과로 위장하지 않음), 1: 금칙어 위반
      process.exit(result.error ? 2 : result.success ? 0 : 1)
    })
    .catch(err => {
      console.error('[scan-rendered] 치명적 오류:', err)
      process.exit(2)
    })
}
