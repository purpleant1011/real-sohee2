// @vitest-environment node
import { test as nodeTest } from 'node:test'
import assert from 'node:assert/strict'
import { compareReports, renderMarkdown } from './compare-baselines.mjs'

const test = process.env.VITEST ? (await import('vitest')).test : nodeTest

function report(rows) {
  return { results: rows }
}

function row({ route = '/', profileId = 'android-4g-mid', lcp = 1500, cls = 0.03, inp = 300, transferKb = 8000, imgKb = 4000, samples = 5, statuses } = {}) {
  return {
    environment: { profileId },
    route,
    sampleCount: samples,
    metrics: {
      lcpMs: { p75: lcp },
      cls: { p75: cls },
      inpMs: { p75: inp },
    },
    verdicts: statuses ?? [
      { metric: 'lcpMs', status: 'PASS' },
      { metric: 'cls', status: 'PASS' },
      { metric: 'inpMs', status: 'FAIL' },
    ],
    samples: [
      {
        resources: {
          totalTransferSize: transferKb * 1024,
          byType: { img: { transferSize: imgKb * 1024 } },
        },
      },
    ],
  }
}

test('개선은 음수 델타로, 악화는 양수 델타로 계산한다', () => {
  const diff = compareReports(
    report([row({ lcp: 2000, transferKb: 8000, imgKb: 4000 })]),
    report([row({ lcp: 1500, transferKb: 2000, imgKb: 300 })]),
  )
  const r = diff.rows[0]
  assert.equal(r.metrics.lcpMs.before, 2000)
  assert.equal(r.metrics.lcpMs.after, 1500)
  assert.equal(r.metrics.lcpMs.deltaPct, -25)
  assert.equal(r.transfer.beforeKb, 8000)
  assert.equal(r.transfer.afterKb, 2000)
  assert.equal(r.transfer.deltaPct, -75)
  assert.equal(r.imageTransfer.beforeKb, 4000)
  assert.equal(r.imageTransfer.afterKb, 300)
})

test('한쪽에 값이 없으면 0 이 아니라 null 이고 델타를 만들지 않는다', () => {
  const diff = compareReports(
    report([row({ inp: 300 })]),
    report([row({ inp: null })]),
  )
  const r = diff.rows[0]
  assert.equal(r.metrics.inpMs.after, null)
  assert.equal(r.metrics.inpMs.deltaPct, null)
})

test('before 가 0 이면 나눗셈 없이 델타는 null 이다', () => {
  const diff = compareReports(report([row({ cls: 0 })]), report([row({ cls: 0 })]))
  assert.equal(diff.rows[0].metrics.cls.deltaPct, null)
})

test('표본 수가 다르면 표에 그대로 드러난다', () => {
  const diff = compareReports(report([row({ samples: 5 })]), report([row({ samples: 3 })]))
  const md = renderMarkdown(diff)
  assert.match(md, /\| 5→3 \|/)
})

test('한쪽에만 있는 라우트도 사라지지 않고 행으로 남는다', () => {
  const diff = compareReports(
    report([row({ route: '/' }), row({ route: '/pricing' })]),
    report([row({ route: '/' })]),
  )
  assert.equal(diff.rows.length, 2)
  const pricing = diff.rows.find((r) => r.route === '/pricing')
  assert.equal(pricing.metrics.lcpMs.after, null)
  assert.equal(pricing.sampleCountAfter, 0)
})

test('마크다운 표는 결측을 0 이 아니라 — 로 표시한다', () => {
  const diff = compareReports(report([row()]), report([row({ inp: null })]))
  const md = renderMarkdown(diff)
  assert.match(md, /→ — \(—\)/)
  assert.ok(!/→ 0 \(/.test(md))
})

test('판정에서 제외된 지표는 값이 있어도 개선/악화를 주장하지 않는다', () => {
  const notMeasured = [
    { metric: 'lcpMs', status: 'NOT_MEASURED' },
    { metric: 'cls', status: 'NOT_MEASURED' },
    { metric: 'inpMs', status: 'NOT_MEASURED' },
  ]
  const diff = compareReports(
    report([row({ lcp: 500, statuses: notMeasured })]),
    report([row({ lcp: 100, statuses: notMeasured })]),
  )
  const lcp = diff.rows[0].metrics.lcpMs
  assert.equal(lcp.judged, false)
  assert.equal(lcp.deltaPct, null)
  // 값 자체는 보존한다 — 측정은 했고 판정만 하지 않는다.
  assert.equal(lcp.before, 500)
  assert.equal(lcp.after, 100)
  assert.match(renderMarkdown(diff), /판정 밖/)
})

test('양쪽 모두 판정된 지표만 델타를 낸다', () => {
  const judged = [
    { metric: 'lcpMs', status: 'PASS' },
    { metric: 'cls', status: 'PASS' },
    { metric: 'inpMs', status: 'FAIL' },
  ]
  const diff = compareReports(
    report([row({ lcp: 2000, statuses: judged })]),
    report([row({ lcp: 1500, statuses: judged })]),
  )
  assert.equal(diff.rows[0].metrics.lcpMs.judged, true)
  assert.equal(diff.rows[0].metrics.lcpMs.deltaPct, -25)
})

test('소스 신원이 같으면 before/after 비교가 성립하지 않는다고 알린다', () => {
  const withSource = (identity) => ({
    sourceRevision: { identity, dirty: true },
    results: [row()],
  })
  const same = compareReports(withSource('abc+dirty:111'), withSource('abc+dirty:111'))
  assert.equal(same.sources.sameSource, true)
  assert.match(renderMarkdown(same), /비교가 성립하지 않는다/)

  const different = compareReports(withSource('abc+dirty:111'), withSource('abc+dirty:222'))
  assert.equal(different.sources.sameSource, false)
})

test('소스 기록이 없는 예전 리포트도 비교는 하되 그 사실을 숨기지 않는다', () => {
  const diff = compareReports(report([row()]), report([row()]))
  assert.equal(diff.sources.before, null)
  assert.equal(diff.sources.comparable, false)
  assert.equal(diff.rows[0].metrics.lcpMs.deltaPct, 0)
})
