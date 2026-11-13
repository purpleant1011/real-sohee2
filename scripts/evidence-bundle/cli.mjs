#!/usr/bin/env node
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, relative, dirname } from 'node:path'
import { buildBundle, collectPr, parsePrNumbers } from './bundle.mjs'

const allowed = new Set(['--prs', '--snapshot', '--linear', '--runs', '--out', '--repo'])
const args = new Map()
function readJson(path) {
  if (statSync(path).size > 2_000_000) throw new Error('INPUT_TOO_LARGE')
  return JSON.parse(readFileSync(path, 'utf8'))
}
try {
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 2) {
    if (!allowed.has(argv[i]) || !argv[i + 1] || args.has(argv[i])) throw new Error('INVALID_ARGUMENTS')
    args.set(argv[i], argv[i + 1])
  }
  if (args.has('--prs') === args.has('--snapshot')) throw new Error('CHOOSE_PRS_OR_SNAPSHOT')
  const base = resolve('docs/qa/v093')
  const output = resolve(args.get('--out') ?? `${base}/bundle-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  const within = relative(base, output)
  if (within.startsWith('..') || within === '' || output.slice(-5) !== '.json') throw new Error('OUTPUT_MUST_BE_UNDER_DOCS_QA_V093')
  const repo = args.get('--repo') ?? 'example-owner/real-sohee'
  const prs = []
  if (args.has('--snapshot')) {
    const data = readJson(args.get('--snapshot'))
    if (!Array.isArray(data)) throw new Error('SNAPSHOT_MUST_BE_ARRAY')
    prs.push(...data)
  } else {
    for (const number of parsePrNumbers(args.get('--prs'))) {
      try { prs.push(await collectPr(number, repo)) }
      catch { prs.push({ number, collectionError: true }) }
    }
  }
  const result = buildBundle({ prs, linear: args.has('--linear') ? readJson(args.get('--linear')) : [], runs: args.has('--runs') ? readJson(args.get('--runs')) : [] })
  result.provenance = { github: args.has('--prs') ? 'GH_PR_VIEW_READ_ONLY' : 'SUPPLIED_SNAPSHOT', linear: args.has('--linear') ? 'SUPPLIED_READ_ONLY_EXPORT' : 'NOT_FETCHED', commandsExecutedFromEvidence: 0 }
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' })
  console.log(`Evidence bundle written: ${relative(process.cwd(), output)}`)
  if (prs.some(pr => pr.collectionError)) process.exitCode = 2
} catch (error) {
  const safe = new Set(['INPUT_TOO_LARGE', 'INVALID_ARGUMENTS', 'CHOOSE_PRS_OR_SNAPSHOT', 'OUTPUT_MUST_BE_UNDER_DOCS_QA_V093', 'SNAPSHOT_MUST_BE_ARRAY', 'INVALID_PR_NUMBERS', 'INVALID_BUNDLE_INPUT', 'INVALID_PR_NUMBER', 'INVALID_PR_SNAPSHOT'])
  console.error(safe.has(error?.message) ? error.message : error?.code === 'EEXIST' ? 'OUTPUT_EXISTS_NOT_OVERWRITTEN' : 'EVIDENCE_COLLECTION_FAILED')
  process.exitCode = 1
}
