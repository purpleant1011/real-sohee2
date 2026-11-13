#!/usr/bin/env node
/**
 * 두 기준선 JSON 을 비교해 before/after 표를 만든다 (Linear ANI-1741).
 *
 * 규칙:
 * - 표본 수가 다르면 그 사실을 표에 남긴다(다른 분모를 같은 것으로 비교하지 않기 위해).
 * - 한쪽에 값이 없으면 0 이 아니라 '—' 로 표시하고 감소율을 계산하지 않는다.
 * - 판정이 NOT_MEASURED 인 항목은 개선/악화 어느 쪽으로도 세지 않는다.
 *
 * 사용:
 *   node scripts/perf/compare-baselines.mjs --before a.json --after b.json [--out diff.json]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const METRICS = [
  { key: 'lcpMs', label: 'LCP (p75, ms)', lowerIsBetter: true },
  { key: 'cls', label: 'CLS (p75)', lowerIsBetter: true },
  { key: 'inpMs', label: 'INP (p75, ms)', lowerIsBetter: true },
]

function parseArgs(argv) {
  const args = new Map()
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || argv[i + 1] === undefined) throw new Error(`인자 형식 오류: ${argv[i] ?? ''}`)
    args.set(argv[i].slice(2), argv[i + 1])
  }
  return args
}

function indexResults(report) {
  const map = new Map()
  for (const row of report?.results ?? []) {
    map.set(`${row.environment?.profileId}::${row.route}`, row)
  }
  return map
}

/** 전송량은 첫 표본의 리소스 합계를 쓴다(라우트·프로필마다 동일 구조). */
function transferKb(row) {
  const sample = row?.samples?.[0]
  const bytes = sample?.resources?.totalTransferSize
  return Number.isFinite(bytes) ? Math.round(bytes / 1024) : null
}

function imageKb(row) {
  const sample = row?.samples?.[0]
  const bytes = sample?.resources?.byType?.img?.transferSize
  return Number.isFinite(bytes) ? Math.round(bytes / 1024) : null
}

export function compareReports(before, after) {
  const beforeIndex = indexResults(before)
  const afterIndex = indexResults(after)
  const keys = [...new Set([...beforeIndex.keys(), ...afterIndex.keys()])].sort()

  const rows = keys.map((key) => {
    const b = beforeIndex.get(key) ?? null
    const a = afterIndex.get(key) ?? null
    const [profileId, route] = key.split('::')
    const metrics = {}

    for (const metric of METRICS) {
      const beforeValue = b?.metrics?.[metric.key]?.p75 ?? null
      const afterValue = a?.metrics?.[metric.key]?.p75 ?? null
      const beforeStatus = b?.verdicts?.find((v) => v.metric === metric.key)?.status ?? 'NOT_MEASURED'
      const afterStatus = a?.verdicts?.find((v) => v.metric === metric.key)?.status ?? 'NOT_MEASURED'
      // 판정에서 제외된 지표(reference-only 프로필 등)는 값이 남아 있어도 개선/악화를 주장하지 않는다.
      // 그런 지표의 델타는 "예산 판정 밖"이라는 사실을 덮는다.
      const judgeable = beforeStatus !== 'NOT_MEASURED' && afterStatus !== 'NOT_MEASURED'
      metrics[metric.key] = {
        before: beforeValue,
        after: afterValue,
        deltaPct:
          judgeable && Number.isFinite(beforeValue) && Number.isFinite(afterValue) && beforeValue > 0
            ? Number((((afterValue - beforeValue) / beforeValue) * 100).toFixed(1))
            : null,
        beforeStatus,
        afterStatus,
        judged: judgeable,
      }
    }

    const beforeTransferKb = transferKb(b)
    const afterTransferKb = transferKb(a)

    return {
      profileId,
      route,
      sampleCountBefore: b?.sampleCount ?? 0,
      sampleCountAfter: a?.sampleCount ?? 0,
      metrics,
      transfer: {
        beforeKb: beforeTransferKb,
        afterKb: afterTransferKb,
        deltaPct:
          Number.isFinite(beforeTransferKb) && Number.isFinite(afterTransferKb) && beforeTransferKb > 0
            ? Number((((afterTransferKb - beforeTransferKb) / beforeTransferKb) * 100).toFixed(1))
            : null,
      },
      imageTransfer: { beforeKb: imageKb(b), afterKb: imageKb(a) },
    }
  })

  // 두 리포트가 같은 빌드를 잰 것인지 먼저 확인한다. 같은 head 라도 dirty 였다면 다른 빌드다.
  const beforeIdentity = before?.sourceRevision?.identity ?? null
  const afterIdentity = after?.sourceRevision?.identity ?? null
  const sources = {
    before: before?.sourceRevision ?? null,
    after: after?.sourceRevision ?? null,
    sameSource: beforeIdentity !== null && beforeIdentity === afterIdentity,
    // 한쪽이라도 dirty 였다면 "같은 커밋"이라고 단정할 수 없다.
    comparable: beforeIdentity !== null && afterIdentity !== null && beforeIdentity !== afterIdentity,
  }

  return { schemaVersion: 1, sources, rows }
}

function fmt(value, unit = '') {
  return Number.isFinite(value) ? `${value}${unit}` : '—'
}

function fmtDelta(pct) {
  if (!Number.isFinite(pct)) return '—'
  return `${pct > 0 ? '+' : ''}${pct}%`
}

/** 판정에서 제외된 지표는 델타 대신 그 사실을 적는다(개선/악화 주장 금지). */
function fmtMetricCell(m) {
  const delta = m.judged ? fmtDelta(m.deltaPct) : '판정 밖'
  return `${fmt(m.before)} → ${fmt(m.after)} (${delta})`
}

export function renderMarkdown(diff) {
  const src = diff.sources
  const sourceLine = src
    ? [
        '',
        `- before 소스: \`${src.before?.identity ?? '기록 없음'}\` (dirty: ${src.before?.dirty ?? '기록 없음'})`,
        `- after 소스:  \`${src.after?.identity ?? '기록 없음'}\` (dirty: ${src.after?.dirty ?? '기록 없음'})`,
        src.sameSource ? '- ⚠️ 두 리포트가 같은 소스를 잰 것으로 보인다 — before/after 비교가 성립하지 않는다.' : null,
      ].filter(Boolean)
    : []

  const lines = [
    ...sourceLine,
    '',
    '| 프로필 | 라우트 | 표본 | LCP p75 (ms) | CLS p75 | INP p75 (ms) | 전송량 (kB) | 이미지 (kB) |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const row of diff.rows) {
    const m = row.metrics
    const samples = row.sampleCountBefore === row.sampleCountAfter
      ? `${row.sampleCountAfter}`
      : `${row.sampleCountBefore}→${row.sampleCountAfter}`
    lines.push(
      `| ${row.profileId} | \`${row.route}\` | ${samples} ` +
        `| ${fmtMetricCell(m.lcpMs)} ` +
        `| ${fmtMetricCell(m.cls)} ` +
        `| ${fmtMetricCell(m.inpMs)} ` +
        `| ${fmt(row.transfer.beforeKb)} → ${fmt(row.transfer.afterKb)} (${fmtDelta(row.transfer.deltaPct)}) ` +
        `| ${fmt(row.imageTransfer.beforeKb)} → ${fmt(row.imageTransfer.afterKb)} |`,
    )
  }
  return lines.join('\n')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const beforePath = args.get('before')
  const afterPath = args.get('after')
  if (!beforePath || !afterPath) throw new Error('--before 와 --after 가 모두 필요합니다.')

  const diff = compareReports(
    JSON.parse(readFileSync(resolve(beforePath), 'utf8')),
    JSON.parse(readFileSync(resolve(afterPath), 'utf8')),
  )
  console.log(renderMarkdown(diff))

  const out = args.get('out')
  if (out) {
    const target = resolve(out)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, `${JSON.stringify(diff, null, 2)}\n`)
    console.log(`\n비교 JSON: ${out}`)
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    main()
  } catch (error) {
    console.error(`비교 실패: ${error?.message ?? error}`)
    process.exitCode = 1
  }
}
