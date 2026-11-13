// @vitest-environment node
import { test as nodeTest } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_BUDGETS,
  PERF_PROFILES,
  classifyLanding,
  describeEnvironment,
  evaluateBudget,
  evaluateRun,
  findRoute,
  overallVerdict,
  parseNextBuildRouteTable,
  describeSourceRevision,
  interactionIndices,
  isScorableStatus,
  percentile,
  sessionWindowCls,
  summarize,
  summarizeChunkSizes,
} from './web-vitals-core.mjs'

const test = process.env.VITEST ? (await import('vitest')).test : nodeTest

const budgetedProfile = PERF_PROFILES['android-4g-mid']
const referenceProfile = PERF_PROFILES['ios-4g']

test('백분위수는 nearest-rank 이며 표본이 없으면 null 이다', () => {
  assert.equal(percentile([], 0.75), null)
  assert.equal(percentile([undefined, null], 0.75), null)
  assert.equal(percentile([10, 20, 30, 40, 50], 0.75), 40)
  assert.equal(percentile([10, 20, 30, 40, 50], 0.5), 30)
  assert.equal(percentile([50, 10, 30], 1), 50)
  assert.equal(percentile([50, 10, 30], 0), 10)
})

test('요약은 표본 수와 함께 계산 규칙을 남긴다', () => {
  assert.deepEqual(summarize([]), { count: 0, min: null, median: null, p75: null, max: null, method: 'NEAREST_RANK' })
  const s = summarize([100, 200, 300, 400])
  assert.equal(s.count, 4)
  assert.equal(s.min, 100)
  assert.equal(s.max, 400)
  assert.equal(s.p75, 300)
  assert.equal(s.method, 'NEAREST_RANK')
})

test('측정값이 없으면 PASS 가 아니라 NOT_MEASURED 다', () => {
  assert.equal(evaluateBudget('lcpMs', null, 2500).status, 'NOT_MEASURED')
  assert.equal(evaluateBudget('lcpMs', undefined, 2500).reason, 'NO_SAMPLES')
  assert.equal(evaluateBudget('lcpMs', 1000, null).reason, 'NO_BUDGET')
})

test('예산 경계값은 통과, 초과는 실패다', () => {
  assert.equal(evaluateBudget('lcpMs', 2500, 2500).status, 'PASS')
  assert.equal(evaluateBudget('lcpMs', 2501, 2500).status, 'FAIL')
  assert.equal(evaluateBudget('cls', 0.1, 0.1).status, 'PASS')
  assert.equal(evaluateBudget('cls', 0.11, 0.1).status, 'FAIL')
})

test('예산 적용 프로필은 p75 로 판정하고 표본 전부를 보존한다', () => {
  const samples = [
    { lcpMs: 1000, cls: 0.02, inpMs: 100 },
    { lcpMs: 1200, cls: 0.03, inpMs: 120 },
    { lcpMs: 1500, cls: 0.04, inpMs: 140 },
    { lcpMs: 2600, cls: 0.05, inpMs: 160 },
    { lcpMs: 2700, cls: 0.05, inpMs: 170 },
  ]
  const run = evaluateRun({ samples, profile: budgetedProfile })
  assert.equal(run.status, 'BUDGETED')
  assert.equal(run.sampleCount, 5)
  assert.equal(run.metrics.lcpMs.p75, 2600)
  assert.equal(run.verdicts.find((v) => v.metric === 'lcpMs').status, 'FAIL')
  assert.equal(run.verdicts.find((v) => v.metric === 'cls').status, 'PASS')
  assert.equal(run.networkLabel, 'SLOW_4G')
  assert.equal(run.cpuThrottleRate, 4)
})

test('스로틀 불가 프로필은 참고값만 남기고 예산 판정을 하지 않는다', () => {
  const run = evaluateRun({
    samples: [{ lcpMs: 500, cls: 0, inpMs: 50 }],
    profile: referenceProfile,
  })
  assert.equal(run.status, 'REFERENCE_ONLY')
  assert.equal(run.throttleSupport, 'NOT_SUPPORTED_WEBKIT')
  assert.ok(run.verdicts.every((v) => v.status === 'NOT_MEASURED'))
  assert.ok(run.verdicts.every((v) => v.reason === 'REFERENCE_ONLY_PROFILE'))
  // 값 자체는 남긴다 — 측정했으면 기록하고, 판정만 하지 않는다.
  assert.equal(run.metrics.lcpMs.p75, 500)
})

test('전체 결론: 실패가 하나라도 있으면 FAIL, 판정 대상이 없으면 NOT_MEASURED', () => {
  assert.equal(overallVerdict([]).status, 'NOT_MEASURED')
  assert.equal(overallVerdict([evaluateRun({ samples: [], profile: referenceProfile })]).status, 'NOT_MEASURED')

  const good = evaluateRun({
    samples: [{ lcpMs: 1000, cls: 0.01, inpMs: 50 }],
    profile: budgetedProfile,
  })
  assert.equal(overallVerdict([good]).status, 'PASS')

  const bad = evaluateRun({
    samples: [{ lcpMs: 9000, cls: 0.01, inpMs: 50 }],
    profile: budgetedProfile,
  })
  assert.equal(overallVerdict([good, bad]).status, 'FAIL')
})

test('기본 예산은 문서의 모바일 목표와 일치한다', () => {
  assert.deepEqual({ ...DEFAULT_BUDGETS }, { lcpMs: 2500, cls: 0.1, inpMs: 200 })
})

test('next build 라우트 표를 바이트로 파싱한다', () => {
  const stdout = [
    'Route (app)                                 Size  First Load JS',
    '┌ ○ /                                    12.3 kB         210 kB',
    '├ ○ /pricing                              4.1 kB         150 kB',
    '└ ○ /login                                2.0 kB         120 kB',
    '+ First Load JS shared by all              99.9 kB',
    '',
  ].join('\n')
  const table = parseNextBuildRouteTable(stdout)
  assert.equal(table.parsed, true)
  assert.equal(table.routeCount, 3)
  assert.equal(table.sizeColumnsAvailable, true)
  assert.equal(table.sharedFirstLoadJsBytes, Math.round(99.9 * 1024))
  const home = findRoute(table.routes, '/')
  assert.equal(home.firstLoadJsBytes, 210 * 1024)
  assert.equal(home.sizeBytes, Math.round(12.3 * 1024))
  assert.equal(findRoute(table.routes, '/nope'), null)
})

test('Turbopack 표처럼 크기 열이 없으면 경로만 남기고 크기는 null 이다', () => {
  const stdout = [
    'Route (app)',
    '┌ ƒ /',
    '├ ƒ /_not-found',
    '├ ƒ /pricing',
    '└ ƒ /login',
    '',
  ].join('\n')
  const table = parseNextBuildRouteTable(stdout)
  assert.equal(table.parsed, true)
  assert.equal(table.routeCount, 4)
  // 크기를 모르는 것을 0 바이트로 위장하지 않는다.
  assert.equal(table.sizeColumnsAvailable, false)
  assert.equal(findRoute(table.routes, '/pricing').sizeBytes, null)
  assert.equal(findRoute(table.routes, '/pricing').firstLoadJsBytes, null)
})

test('동적 세그먼트·그룹 경로도 경로 토큰으로 인식한다', () => {
  const stdout = ['├ ƒ /app/missions/[missionId]', '├ ƒ /admin/missions/[missionId]', ''].join('\n')
  const table = parseNextBuildRouteTable(stdout)
  assert.equal(table.routeCount, 2)
  assert.ok(findRoute(table.routes, '/app/missions/[missionId]'))
})

test('파싱 불가 줄은 조용히 사라지지 않고 unparsedLines 로 남는다', () => {
  const stdout = [
    'Route (app)                                 Size  First Load JS',
    '├ ○ /pricing                              4.1 kB         150 kB',
    '├ (이 줄은 경로 토큰이 없다)',
    '',
  ].join('\n')
  const table = parseNextBuildRouteTable(stdout)
  assert.equal(table.routeCount, 1)
  assert.equal(table.unparsedLines, 1)
})

test('라우트 표가 없으면 parsed=false 이고 라우트를 지어내지 않는다', () => {
  const table = parseNextBuildRouteTable('빌드 로그 없음')
  assert.equal(table.parsed, false)
  assert.deepEqual(table.routes, [])
  assert.equal(table.sharedFirstLoadJsBytes, null)
  assert.equal(table.sizeColumnsAvailable, false)
})

test('청크 크기 요약은 없는 파일을 합계에서 조용히 빼지 않는다', () => {
  assert.deepEqual(summarizeChunkSizes([]), { fileCount: 0, totalBytes: null, missing: [], method: 'DISK_FILE_SIZE' })
  const summary = summarizeChunkSizes([
    { file: 'a.js', bytes: 100 },
    { file: 'b.js', bytes: 250 },
    { file: 'c.js', bytes: null },
  ])
  assert.equal(summary.fileCount, 2)
  assert.equal(summary.totalBytes, 350)
  assert.deepEqual(summary.missing, ['c.js'])
})

test('환경 분모는 스로틀 적용 여부를 숨기지 않는다', () => {
  const env = describeEnvironment({ profile: referenceProfile, gitSha: 'a'.repeat(40) })
  assert.equal(env.throttleSupport, 'NOT_SUPPORTED_WEBKIT')
  assert.equal(env.network.label, 'NOT_THROTTLED_UNSUPPORTED')
  assert.equal(env.measurementKind, 'LAB_SYNTHETIC')
  assert.equal(env.datasetMode, 'LOCAL_PRODUCTION_BUILD')
})

test('CLS 는 세션 윈도우 최댓값이다 (1초 간격·5초 윈도우)', () => {
  // 1초 이내 간격은 같은 윈도우로 합산된다.
  assert.equal(sessionWindowCls([
    { value: 0.02, startTime: 100 },
    { value: 0.03, startTime: 500 },
  ]).cls.toFixed(4), '0.0500')

  // 1초를 넘게 떨어지면 새 윈도우다. 합산(0.06)이 아니라 최댓값(0.05)이 CLS.
  const split = sessionWindowCls([
    { value: 0.03, startTime: 100 },
    { value: 0.03, startTime: 2000 },
  ])
  assert.equal(split.cls.toFixed(4), '0.0300')
  assert.equal(split.windowCount, 2)
})

test('5초를 넘긴 윈도우는 간격이 짧아도 새로 연다', () => {
  const result = sessionWindowCls([
    { value: 0.01, startTime: 0 },
    { value: 0.01, startTime: 900 },
    { value: 0.01, startTime: 1800 },
    { value: 0.01, startTime: 2700 },
    { value: 0.01, startTime: 3600 },
    { value: 0.01, startTime: 4500 },
    { value: 0.01, startTime: 5400 },
  ])
  // 0~5400 은 5초를 넘으므로 5400 에서 새 윈도우. 앞 윈도우는 0~4500 = 0.06.
  assert.equal(result.windowCount, 2)
  assert.equal(result.cls.toFixed(4), '0.0600')
})

test('시프트가 없으면 CLS 는 0 이고 윈도우도 없다', () => {
  assert.deepEqual(sessionWindowCls([]), { cls: 0, windowCount: 0, windows: [] })
  assert.equal(sessionWindowCls(undefined).cls, 0)
})

test('세션 윈도우는 정렬되지 않은 입력도 시간순으로 처리한다', () => {
  const result = sessionWindowCls([
    { value: 0.04, startTime: 3000 },
    { value: 0.01, startTime: 100 },
  ])
  assert.equal(result.windowCount, 2)
  assert.equal(result.cls.toFixed(4), '0.0400')
  assert.equal(result.windows[0].startTime, 100)
})

test('오류 응답은 점수 대상이 아니다', () => {
  assert.equal(isScorableStatus(200), true)
  assert.equal(isScorableStatus(304), true)
  assert.equal(isScorableStatus(404), false)
  assert.equal(isScorableStatus(500), false)
  assert.equal(isScorableStatus(null), false)
  assert.equal(isScorableStatus(undefined), false)
})

test('invalid 표본은 점수에서 빠지고 그 사실이 남는다', () => {
  const run = evaluateRun({
    samples: [
      { lcpMs: 1000, cls: 0.01, inpMs: 50 },
      { lcpMs: 10, cls: 0, inpMs: 1, invalid: true, invalidReason: 'HTTP_404' },
    ],
    profile: budgetedProfile,
  })
  assert.equal(run.sampleCount, 1)
  assert.equal(run.rejectedSampleCount, 1)
  assert.deepEqual(run.rejectedReasons, ['HTTP_404'])
  // 404 표본이 섞여 p75 가 낮아지지 않는다.
  assert.equal(run.metrics.lcpMs.p75, 1000)
})

test('전부 invalid 면 PASS 가 아니라 NOT_MEASURED 다', () => {
  const run = evaluateRun({
    samples: [{ lcpMs: 5, cls: 0, inpMs: 1, invalid: true, invalidReason: 'HTTP_404' }],
    profile: budgetedProfile,
  })
  assert.equal(run.sampleCount, 0)
  assert.ok(run.verdicts.every((v) => v.status === 'NOT_MEASURED'))
})

test('리다이렉트로 다른 화면에 도착한 표본은 그 라우트의 성능이 아니다', () => {
  // 세션 없는 /app 은 /login 으로 이동한다. 200 응답이지만 /app 성능이 아니다.
  const redirected = classifyLanding('/app', 'http://127.0.0.1:3311/login?next=%2Fapp')
  assert.equal(redirected.matched, false)
  assert.equal(redirected.redirected, true)
  assert.equal(redirected.finalPath, '/login')
  assert.equal(redirected.reason, 'REDIRECTED_TO_/login')

  // 같은 화면이면 쿼리·해시·끝 슬래시가 달라도 통과한다.
  assert.equal(classifyLanding('/app', 'http://127.0.0.1:3311/app?tab=home#top').matched, true)
  assert.equal(classifyLanding('/app/', 'http://localhost/app').matched, true)
  assert.equal(classifyLanding('/', 'http://localhost/').matched, true)

  // 해석할 수 없는 URL 을 통과로 승격하지 않는다.
  assert.equal(classifyLanding('/app', 'not a url:://').matched, false)
})

test('dev 서버 측정은 참고값으로 남고 예산 판정을 하지 않는다', () => {
  const run = evaluateRun({
    samples: [{ lcpMs: 9000, cls: 0.4, inpMs: 900 }],
    profile: { ...budgetedProfile, budgetApplies: false },
    referenceReason: 'DEV_SERVER_NOT_COMPARABLE',
  })
  assert.equal(run.status, 'REFERENCE_ONLY')
  // 수치는 남기되 PASS/FAIL 로 승격하지 않는다.
  assert.equal(run.metrics.lcpMs.p75, 9000)
  assert.ok(run.verdicts.every((v) => v.status === 'NOT_MEASURED'))
  assert.ok(run.verdicts.every((v) => v.reason === 'DEV_SERVER_NOT_COMPARABLE'))

  const env = describeEnvironment({ profile: referenceProfile, serverMode: 'DEV_SERVER' })
  assert.equal(env.serverMode, 'DEV_SERVER')
  assert.equal(env.datasetMode, 'LOCAL_DEV_SERVER')
})

test('INP 클릭 대상이 2개면 서로 다른 두 요소를 누른다', () => {
  // 회귀 방지: 예전 Math.min(i + 1, count - 1) 은 둘 다 1 이 되어 같은 요소를 두 번 눌렀다.
  assert.deepEqual(interactionIndices(2, 0), [0, 1])
  assert.deepEqual(interactionIndices(3, 0), [0, 1])
  assert.deepEqual(interactionIndices(3, 2), [2, 0])
  // 대상이 1개면 클릭도 1회다. 같은 요소 2회는 "서로 다른 상호작용 2회"가 아니다.
  assert.deepEqual(interactionIndices(1, 0), [0])
  // 대상이 없으면 누를 것이 없다.
  assert.deepEqual(interactionIndices(0, 0), [])
  // 범위를 벗어난 시작 위치는 마지막 요소로 당긴다.
  assert.deepEqual(interactionIndices(2, 9), [1, 0])
  assert.deepEqual(interactionIndices(2, -3), [0, 1])
})

test('dev 서버 환경 분모는 예산 적용 여부를 실제 판정값으로 적는다', () => {
  // 회귀 방지: 원본 프로필을 넘겨 REFERENCE_ONLY 인데 budgetApplies: true 로 남던 모순.
  const env = describeEnvironment({
    profile: { ...budgetedProfile, budgetApplies: false },
    serverMode: 'DEV_SERVER',
    originalBudgetApplies: true,
  })
  assert.equal(env.serverMode, 'DEV_SERVER')
  assert.equal(env.budgetApplies, false)
  assert.equal(env.profileBudgetApplies, true)

  // dev 모드인데 프로필이 예산 적용을 주장해도 fail-closed 로 꺼진다.
  const forced = describeEnvironment({ profile: budgetedProfile, serverMode: 'DEV_SERVER' })
  assert.equal(forced.budgetApplies, false)

  // production 빌드에서는 프로필 선언값을 그대로 쓴다.
  assert.equal(describeEnvironment({ profile: budgetedProfile }).budgetApplies, true)
})

test('소스 리비전은 dirty 여부까지 신원에 넣는다', () => {
  const clean = describeSourceRevision({ head: 'a'.repeat(40), dirty: false, diffSha256: 'b'.repeat(64), changedFileCount: 0 })
  assert.equal(clean.identity, 'a'.repeat(40))

  const dirty = describeSourceRevision({ head: 'a'.repeat(40), dirty: true, diffSha256: 'b'.repeat(64), changedFileCount: 3 })
  // 같은 head 라도 dirty 면 다른 신원이어야 한다.
  assert.notEqual(dirty.identity, clean.identity)
  assert.match(dirty.identity, /\+dirty:/)
  assert.equal(dirty.changedFileCount, 3)
})

test('unthrottled 프로필은 네트워크 에뮬레이션을 끈다 (throughput 0 은 차단이다)', () => {
  assert.equal(PERF_PROFILES['android-unthrottled'].applyNetworkThrottle, false)
  assert.equal(PERF_PROFILES['android-4g-mid'].applyNetworkThrottle, undefined)
})
