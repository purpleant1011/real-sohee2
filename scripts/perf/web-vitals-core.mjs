/**
 * 모바일 Web Vitals 기준선 코어 (Linear ANI-1741).
 *
 * 이 파일은 순수 함수만 담는다 — 브라우저·파일·네트워크 접근 없음.
 * 측정 러너(scripts/perf/mobile-web-vitals.mjs)와 단위 테스트가 같은 판정 규칙을 공유한다.
 *
 * 정직성 원칙:
 * - 표본이 없거나 측정 불가면 0 이 아니라 NOT_MEASURED 로 남긴다.
 * - 측정하지 않은 지표를 PASS 로 승격하지 않는다.
 * - 네트워크·CPU 스로틀을 걸지 못한 프로필은 그 사실을 그대로 기록한다.
 */

/** 문서 docs/mobile-r2/03-pwa-design-system-and-claude.md §E 의 모바일 합격 목표. */
export const DEFAULT_BUDGETS = Object.freeze({
  lcpMs: 2500,
  cls: 0.1,
  inpMs: 200,
})

/**
 * 측정 분모(denominator)를 명시하는 프로필 정의.
 *
 * - android-4g-mid: 중급 Android + 4G. Chrome DevTools "Slow 4G" 계열(1.6Mbps/750kbps/150ms)
 *   에 CPU 4x 스로틀을 더한 값. CDP 로 실제 적용된다.
 * - android-unthrottled: 같은 기기·같은 폭, 스로틀 없음. 번들·렌더 자체의 기준선.
 * - ios-4g: iPhone Safari. Playwright 의 WebKit 에는 CDP 네트워크/CPU 스로틀이 없다.
 *   따라서 이 프로필은 **스로틀 불가**이며, 그 사실을 지표와 함께 기록한다.
 *   iOS 를 스로틀한 것처럼 보고하면 거짓 수치가 된다.
 */
export const PERF_PROFILES = Object.freeze({
  'android-4g-mid': {
    id: 'android-4g-mid',
    engine: 'chromium',
    device: 'Pixel 7',
    viewport: { width: 390, height: 844 },
    network: { label: 'SLOW_4G', latencyMs: 150, downloadKbps: 1600, uploadKbps: 750 },
    cpuThrottleRate: 4,
    throttleSupport: 'CDP_APPLIED',
    budgetApplies: true,
  },
  'android-unthrottled': {
    id: 'android-unthrottled',
    engine: 'chromium',
    device: 'Pixel 7',
    viewport: { width: 390, height: 844 },
    // throughput 0 을 CDP 에 넘기면 "무제한"이 아니라 "완전 차단"이 된다. 그래서 이 프로필은
    // 네트워크 에뮬레이션 자체를 건너뛴다(applyNetworkThrottle: false).
    network: { label: 'NO_THROTTLE', latencyMs: 0, downloadKbps: 0, uploadKbps: 0 },
    applyNetworkThrottle: false,
    cpuThrottleRate: 1,
    throttleSupport: 'CDP_APPLIED',
    budgetApplies: false,
  },
  'ios-4g': {
    id: 'ios-4g',
    engine: 'webkit',
    device: 'iPhone 14',
    viewport: { width: 390, height: 844 },
    network: { label: 'NOT_THROTTLED_UNSUPPORTED', latencyMs: 0, downloadKbps: 0, uploadKbps: 0 },
    cpuThrottleRate: 1,
    throttleSupport: 'NOT_SUPPORTED_WEBKIT',
    budgetApplies: false,
  },
})

/**
 * nearest-rank 백분위수. 표본이 비면 null.
 * n=5, p=0.75 → index 3 (정렬 후 4번째 값). 보간하지 않는다 — 소표본에서 보간값은 실측처럼 보이지 않기 때문이다.
 */
export function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return null
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  if (p <= 0) return sorted[0]
  if (p >= 1) return sorted[sorted.length - 1]
  const rank = Math.ceil(p * sorted.length)
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]
}

/**
 * CLS 를 Core Web Vitals 정의대로 **세션 윈도우 최댓값**으로 계산한다.
 *
 * 정의(web-vitals): 레이아웃 시프트를 시간순으로 보며, 직전 시프트와의 간격이 1초를 넘거나
 * 윈도우 시작으로부터 5초를 넘으면 새 윈도우를 연다. CLS 는 그중 점수가 가장 큰 윈도우다.
 *
 * 모든 시프트를 단순 합산하면 1초 이상 떨어진 시프트까지 더해져 CLS 가 과대평가되고,
 * 예산을 잘못 실패시킬 수 있다.
 *
 * @param {{value: number, startTime: number}[]} shifts hadRecentInput 이 아닌 시프트만
 */
export function sessionWindowCls(shifts) {
  const list = (Array.isArray(shifts) ? shifts : [])
    .filter((s) => Number.isFinite(s?.value) && Number.isFinite(s?.startTime))
    .sort((a, b) => a.startTime - b.startTime)

  const windows = []
  let current = null
  for (const shift of list) {
    const startsNew =
      !current ||
      shift.startTime - current.lastTime > 1000 ||
      shift.startTime - current.startTime > 5000
    if (startsNew) {
      current = { value: 0, startTime: shift.startTime, lastTime: shift.startTime }
      windows.push(current)
    }
    current.value += shift.value
    current.lastTime = shift.startTime
  }

  const values = windows.map((w) => w.value)
  return {
    cls: values.length ? Math.max(...values) : 0,
    windowCount: windows.length,
    windows: windows.map((w) => ({ value: w.value, startTime: w.startTime, endTime: w.lastTime })),
  }
}

/** 표본 요약. count/min/median/p75/max 와 함께 사용한 백분위 규칙을 남긴다. */
export function summarize(values) {
  const clean = (Array.isArray(values) ? values : []).filter((v) => Number.isFinite(v))
  if (clean.length === 0) {
    return { count: 0, min: null, median: null, p75: null, max: null, method: 'NEAREST_RANK' }
  }
  return {
    count: clean.length,
    min: Math.min(...clean),
    median: percentile(clean, 0.5),
    p75: percentile(clean, 0.75),
    max: Math.max(...clean),
    method: 'NEAREST_RANK',
  }
}

/**
 * 예산 판정. 값이 없으면 NOT_MEASURED — 절대 PASS 로 승격하지 않는다.
 * 반환: { metric, value, budget, status: 'PASS'|'FAIL'|'NOT_MEASURED', reason? }
 */
export function evaluateBudget(metric, value, budget) {
  const finite = Number.isFinite(value)
  if (!finite) {
    return { metric, value: null, budget, status: 'NOT_MEASURED', reason: 'NO_SAMPLES' }
  }
  if (!Number.isFinite(budget)) {
    return { metric, value, budget: null, status: 'NOT_MEASURED', reason: 'NO_BUDGET' }
  }
  return { metric, value, budget, status: value <= budget ? 'PASS' : 'FAIL' }
}

/**
 * 한 프로필·한 라우트의 원시 표본에서 지표 요약과 예산 판정을 만든다.
 * budgetApplies=false 인 프로필(스로틀 없음·스로틀 불가)은 판정 대신 참고값으로 남긴다.
 */
export function evaluateRun({ samples, profile, budgets = DEFAULT_BUDGETS, referenceReason = 'REFERENCE_ONLY_PROFILE' }) {
  // 오류 페이지(404·500)나 실패한 표본은 그 라우트의 성능이 아니다. 점수 계산에서 제외한다.
  const all = Array.isArray(samples) ? samples : []
  const valid = all.filter((s) => s?.invalid !== true)

  const lcp = summarize(valid.map((s) => s.lcpMs))
  const cls = summarize(valid.map((s) => s.cls))
  const inp = summarize(valid.map((s) => s.inpMs))

  const status = profile.budgetApplies ? 'BUDGETED' : 'REFERENCE_ONLY'
  const verdicts = profile.budgetApplies
    ? [
        evaluateBudget('lcpMs', lcp.p75, budgets.lcpMs),
        evaluateBudget('cls', cls.p75, budgets.cls),
        evaluateBudget('inpMs', inp.p75, budgets.inpMs),
      ]
    : [
        { metric: 'lcpMs', value: lcp.p75, budget: null, status: 'NOT_MEASURED', reason: referenceReason },
        { metric: 'cls', value: cls.p75, budget: null, status: 'NOT_MEASURED', reason: referenceReason },
        { metric: 'inpMs', value: inp.p75, budget: null, status: 'NOT_MEASURED', reason: referenceReason },
      ]

  return {
    status,
    sampleCount: valid.length,
    // 왜 표본이 빠졌는지 남긴다. 조용히 줄어든 표본 수는 분모를 속인다.
    rejectedSampleCount: all.length - valid.length,
    rejectedReasons: [...new Set(all.filter((s) => s?.invalid === true).map((s) => s.invalidReason ?? 'UNKNOWN'))],
    metrics: { lcpMs: lcp, cls, inpMs: inp },
    verdicts,
    throttleSupport: profile.throttleSupport,
    networkLabel: profile.network.label,
    cpuThrottleRate: profile.cpuThrottleRate,
  }
}

/**
 * 전체 실행의 결론. 예산이 적용되는 프로필의 판정만 모아서 본다.
 * 하나라도 FAIL → FAIL. 판정 가능한 것이 없으면 NOT_MEASURED. 전부 PASS 여야 PASS.
 */
export function overallVerdict(runs) {
  const budgeted = runs.filter((r) => r.status === 'BUDGETED')
  const verdicts = budgeted.flatMap((r) => r.verdicts)
  if (verdicts.length === 0) return { status: 'NOT_MEASURED', pass: 0, fail: 0, notMeasured: 0 }
  const fail = verdicts.filter((v) => v.status === 'FAIL').length
  const pass = verdicts.filter((v) => v.status === 'PASS').length
  const notMeasured = verdicts.filter((v) => v.status === 'NOT_MEASURED').length
  if (fail > 0) return { status: 'FAIL', pass, fail, notMeasured }
  if (notMeasured > 0) return { status: 'PARTIAL_NOT_MEASURED', pass, fail, notMeasured }
  return { status: 'PASS', pass, fail, notMeasured }
}

// 라우트 표는 Next 버전에 따라 두 형식이 있다.
//  - webpack 빌드: `├ ○ /pricing    4.1 kB    150 kB`  (Size + First Load JS)
//  - Turbopack 빌드(Next 16): `├ ƒ /pricing`            (크기 열 자체가 없음)
// 크기 열이 없는 경우 경로만 기록하고 sizeBytes 는 null 로 둔다. 0 으로 채우지 않는다.
const ROUTE_WITH_SIZES = /(\/[^\s]*)\s+([\d.]+\s*(?:kB|MB|B))\s+([\d.]+\s*(?:kB|MB|B))\s*$/u
const ROUTE_PATH_ONLY = /(\/[^\s]*)\s*$/u

function toBytes(text) {
  const match = /^([\d.]+)\s*(B|kB|MB)$/u.exec(text.trim())
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value)) return null
  const unit = match[2]
  if (unit === 'B') return Math.round(value)
  if (unit === 'kB') return Math.round(value * 1024)
  return Math.round(value * 1024 * 1024)
}

/**
 * `next build` 표준출력의 라우트 표를 파싱한다.
 * Next 는 표를 터미널 폭에 맞춰 자르기도 하므로, 파싱 실패는 조용히 넘기지 않고
 * unparsed 줄 수로 남긴다(번들 분모가 일부만 잡혔다는 사실을 숨기지 않기 위해).
 */
export function parseNextBuildRouteTable(stdout) {
  const routes = []
  let unparsed = 0
  let sharedFirstLoadJsBytes = null

  for (const rawLine of String(stdout ?? '').split('\n')) {
    const line = rawLine.replace(/\u001b\[[0-9;]*m/gu, '')
    const shared = /First Load JS shared by all\s+(.+)$/u.exec(line)
    if (shared) {
      sharedFirstLoadJsBytes = toBytes(shared[1].trim())
      continue
    }
    if (!/^\s*[├└┌│]/u.test(line)) continue
    const withSizes = ROUTE_WITH_SIZES.exec(line)
    if (withSizes) {
      routes.push({
        path: withSizes[1].trim(),
        sizeBytes: toBytes(withSizes[2]),
        firstLoadJsBytes: toBytes(withSizes[3]),
        raw: line.trim(),
      })
      continue
    }
    const pathOnly = ROUTE_PATH_ONLY.exec(line)
    if (!pathOnly) {
      unparsed += 1
      continue
    }
    // Turbopack 표: 경로는 잡히지만 크기 열이 없다. null 로 남겨 "크기 미제공"과 "0 바이트"를 구분한다.
    routes.push({
      path: pathOnly[1].trim(),
      sizeBytes: null,
      firstLoadJsBytes: null,
      raw: line.trim(),
    })
  }

  return {
    routes,
    routeCount: routes.length,
    sharedFirstLoadJsBytes,
    unparsedLines: unparsed,
    // 크기 열 유무를 별도로 노출한다. 라우트 목록만 보고 번들 크기를 안다고 착각하면 안 된다.
    sizeColumnsAvailable: routes.some((r) => Number.isFinite(r.sizeBytes)),
    parsed: routes.length > 0,
  }
}

/** 표에서 특정 라우트를 찾는다. 없으면 null — 없는 값을 0 으로 대체하지 않는다. */
export function findRoute(routes, path) {
  if (!Array.isArray(routes)) return null
  return routes.find((r) => r.path === path) ?? null
}

/**
 * 디스크에 실제로 존재하는 청크 파일 크기를 요약한다.
 *
 * Turbopack 빌드는 라우트별 First Load JS 를 표에 내지 않으므로, 번들 분모는
 * `.next/build-manifest.json` 의 rootMainFiles 등 **실제 파일**에서 잰다.
 * 파일을 못 찾은 항목은 missing 으로 남기고 합계에서 조용히 빼지 않는다.
 */
export function summarizeChunkSizes(entries) {
  const list = Array.isArray(entries) ? entries : []
  const found = list.filter((e) => Number.isFinite(e?.bytes))
  const missing = list.filter((e) => !Number.isFinite(e?.bytes)).map((e) => e?.file ?? null)
  if (found.length === 0) {
    return { fileCount: 0, totalBytes: null, missing, method: 'DISK_FILE_SIZE' }
  }
  return {
    fileCount: found.length,
    totalBytes: found.reduce((sum, e) => sum + e.bytes, 0),
    missing,
    method: 'DISK_FILE_SIZE',
  }
}

/**
 * 측정한 라우트가 실제로 그 화면이었는지 판정한다.
 * 404·500 페이지는 빠르게 렌더되므로, 걸러내지 않으면 오타 난 라우트가 "성능 통과"로 기록된다.
 */
export function isScorableStatus(status) {
  return Number.isInteger(status) && status >= 200 && status < 400
}

/** 경로 비교용 정규화. 쿼리·해시·끝 슬래시를 지운다. `/app/` 과 `/app` 은 같은 화면이다. */
function normalizePathname(value) {
  const path = String(value ?? '').split('?')[0].split('#')[0] || '/'
  return path === '/' ? '/' : path.replace(/\/+$/u, '')
}

/**
 * 측정한 라우트가 실제로 그 화면에 도착했는지 판정한다.
 *
 * `/app` 은 세션 없이 열면 `/login?next=%2Fapp` 으로 이동한다. Playwright 는 리다이렉트를
 * 따라가므로, 도착 경로를 확인하지 않으면 **로그인 화면의 숫자를 "/app 성능"으로** 기록한다.
 * 200 응답이라는 이유로 그 표본이 유효하다고 보면 안 된다 — 그래서 경로를 함께 본다.
 */
export function classifyLanding(requestedPath, finalUrl, baseUrl = 'http://localhost') {
  const requested = normalizePathname(requestedPath)
  let finalPath
  try {
    finalPath = normalizePathname(new URL(String(finalUrl ?? ''), baseUrl).pathname)
  } catch {
    return { requestedPath: requested, finalPath: null, matched: false, redirected: true, reason: 'UNPARSEABLE_FINAL_URL' }
  }
  const matched = finalPath === requested
  return {
    requestedPath: requested,
    finalPath,
    matched,
    redirected: !matched,
    reason: matched ? null : `REDIRECTED_TO_${finalPath}`,
  }
}

/**
 * 측정 대상 소스 리비전. 커밋 SHA 만 적으면 커밋 전 변경을 측정한 경우
 * 서로 다른 빌드가 같은 리비전으로 보인다(실제로 이 PR 의 before/after 가 그렇게 보였다).
 * 그래서 작업 트리 오염 여부와 변경 내용 해시를 함께 남긴다.
 */
export function describeSourceRevision({ head, dirty, diffSha256, changedFileCount }) {
  return {
    head: head ?? null,
    dirty: dirty === true,
    diffSha256: diffSha256 ?? null,
    changedFileCount: Number.isInteger(changedFileCount) ? changedFileCount : null,
    // 같은 head 라도 dirty=true 면 서로 다른 빌드일 수 있다.
    identity: dirty === true ? `${head ?? 'NO_HEAD'}+dirty:${(diffSha256 ?? 'unknown').slice(0, 12)}` : head ?? null,
  }
}

/**
 * INP 대리 측정에서 실제로 누를 요소 인덱스 목록.
 *
 * 대상이 정확히 2개일 때 `Math.min(i + 1, count - 1)` 은 두 번 모두 1 이 되어 같은 요소를
 * 두 번 누른다. 두 번째 클릭은 상태 변화가 없어 이벤트 항목을 만들지 않고, 결과적으로
 * INP 표본이 비거나 대표성을 잃는다. 시작 위치에서 나머지 연산으로 돌려 개수와 무관하게
 * 서로 다른 요소를 고른다.
 *
 * 대상이 1개면 클릭도 1회다. 같은 요소를 두 번 누르는 것은 "서로 다른 상호작용 2회"가 아니다.
 */
export function interactionIndices(targetCount, baseIndex = 0, clickCount = 2) {
  if (!Number.isInteger(targetCount) || targetCount <= 0) return []
  const base = Math.min(Math.max(Number.isInteger(baseIndex) ? baseIndex : 0, 0), targetCount - 1)
  if (targetCount === 1) return [base]
  const out = []
  const clicks = Math.min(Number.isInteger(clickCount) && clickCount > 0 ? clickCount : 1, targetCount)
  for (let i = 0; i < clicks; i += 1) out.push((base + i) % targetCount)
  return out
}

/**
 * 실행 환경 분모. 기기·네트워크·빌드 SHA·표본 수를 한 덩어리로 묶는다.
 *
 * `profile` 은 **판정에 실제로 쓴** 프로필이어야 한다. dev 서버 측정은 budgetApplies=false 로
 * 덮어쓴 프로필로 판정하므로, 원본 프로필을 넘기면 `REFERENCE_ONLY` 인데 `budgetApplies: true`
 * 라고 적힌 모순된 증거가 남는다. 원본 선언값은 `profileBudgetApplies` 로 따로 남긴다.
 */
export function describeEnvironment({
  profile,
  gitSha,
  buildId,
  nodeVersion,
  playwrightVersion,
  sourceRevision,
  context,
  serverMode = 'PRODUCTION_BUILD',
  originalBudgetApplies = profile?.budgetApplies,
}) {
  // dev 서버 수치는 압축 이전 번들이라 어떤 경우에도 예산을 적용하면 안 된다. fail-closed.
  const budgetApplies = serverMode === 'DEV_SERVER' ? false : profile.budgetApplies
  return {
    profileId: profile.id,
    // dev 서버 수치는 압축·미니파이 이전 번들이라 production 빌드와 비교할 수 없다. 분모에 남긴다.
    serverMode,
    engine: profile.engine,
    device: profile.device,
    viewport: profile.viewport,
    network: profile.network,
    cpuThrottleRate: profile.cpuThrottleRate,
    throttleSupport: profile.throttleSupport,
    // 실제 판정에 쓴 값. 서버 모드 때문에 꺼졌으면 꺼졌다고 적는다.
    budgetApplies,
    // 프로필 자체가 선언한 값. 위와 다르면 서버 모드 때문에 판정이 꺼진 것이다.
    profileBudgetApplies: originalBudgetApplies === undefined ? null : originalBudgetApplies === true,
    gitSha: gitSha ?? null,
    buildId: buildId ?? null,
    nodeVersion: nodeVersion ?? null,
    playwrightVersion: playwrightVersion ?? null,
    datasetMode: serverMode === 'DEV_SERVER' ? 'LOCAL_DEV_SERVER' : 'LOCAL_PRODUCTION_BUILD',
    measurementKind: 'LAB_SYNTHETIC',
    // 실제로 측정한 브라우저 컨텍스트. device 라벨이 실제 UA/뷰포트와 어긋나면 그 사실을 남긴다.
    context: context ?? null,
    sourceRevision: sourceRevision ?? null,
  }
}
