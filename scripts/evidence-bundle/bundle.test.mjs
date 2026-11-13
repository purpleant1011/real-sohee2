// @vitest-environment node
import { test as nodeTest } from 'node:test'
import assert from 'node:assert/strict'
import { buildBundle, collectPr, parsePrNumbers, safeAuditUrl } from './bundle.mjs'

const test = process.env.VITEST ? (await import('vitest')).test : nodeTest

const sha = 'a'.repeat(40)
const now = '2026-10-21T12:00:00Z'
const pr = { number: 1717, url: 'https://github.com/example-owner/real-sohee/pull/1717', headRefOid: sha, title: '[ANI-1637] evidence', body: 'Status: CODE_COMPLETE\nNOT VERIFIED: provider readback', isDraft: true, state: 'OPEN', statusCheckRollup: [] }
const run = { gitSha: sha, command: ['npm', 'run', 'typecheck'], exitCode: 0, startedAt: '2026-10-21T11:00:00Z', finishedAt: '2026-10-21T11:01:00Z', environment: 'LOCAL' }
const bundle = (prs = [pr], runs = []) => buildBundle({ prs, runs, linear: [{ id: 'ANI-1637', status: 'Done' }], now })

test('a completion claim and Linear Done never imply live verification', () => {
 const row = bundle().pullRequests[0]
 assert.equal(row.codeState, 'CODE_COMPLETE_CLAIMED')
 assert.equal(row.liveState, 'NOT_LIVE_VERIFIED')
 assert.equal(row.canAdvertiseLive, false)
 assert.equal(row.issues[0].status, 'Done')
 assert.ok(row.notVerified.includes('PROVIDER_READBACK_NOT_INDEPENDENTLY_VERIFIED'))
})
test('issue → PR → exact SHA → reported command/exit is preserved', () => {
 const row = bundle([pr], [run]).pullRequests[0]
 assert.equal(row.sha, sha)
 assert.equal(row.issues[0].id, 'ANI-1637')
 assert.equal(row.runs[0].exitCode, 0)
 assert.deepEqual(row.runs[0].command, run.command)
 assert.equal(row.runsState, 'PASS_RECORDED_NOT_INDEPENDENTLY_VERIFIED')
})
test('a nonzero exit is never hidden by another successful command', () => {
 assert.equal(bundle([pr], [run, { ...run, command: ['npm', 'run', 'lint'], exitCode: 1 }]).pullRequests[0].runsState, 'FAIL_RECORDED')
})
test('wrong-SHA evidence and future timestamps cannot qualify the current head', () => {
 assert.equal(bundle([pr], [{ ...run, gitSha: 'b'.repeat(40) }]).pullRequests[0].runsState, 'MISSING_OR_STALE')
 assert.equal(bundle([pr], [{ ...run, finishedAt: '2027-01-01T00:00:00Z' }]).pullRequests[0].runsState, 'MISSING_OR_STALE')
})
test('missing/empty checks are UNKNOWN; pending and failure remain distinct', () => {
 assert.equal(bundle().pullRequests[0].ciState, 'UNKNOWN')
 assert.equal(bundle([{ ...pr, statusCheckRollup: [{ status: 'IN_PROGRESS', conclusion: '' }] }]).pullRequests[0].ciState, 'PENDING')
 assert.equal(bundle([{ ...pr, statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] }]).pullRequests[0].ciState, 'FAILING')
 assert.equal(bundle([{ ...pr, statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SKIPPED' }] }]).pullRequests[0].ciState, 'UNKNOWN')
})
test('raw PR text, private URLs and credentials never appear in the bundle', () => {
 const body = 'ANI-1637 sk-secret-value owner@example.com https://example.com/object?token=secret https://github.com/example-owner/real-sohee/actions/runs/123'
 const text = JSON.stringify(bundle([{ ...pr, body }]))
 for (const value of ['sk-secret-value', 'owner@example.com', 'example.com/object', '?token=']) assert.equal(text.includes(value), false)
 assert.ok(text.includes('actions/runs/123'))
})
test('unsafe commands are rejected as data and are never executed', () => {
 const row = bundle([pr], [{ ...run, command: ['npm', 'run', 'test; rm -rf /'] }]).pullRequests[0]
 assert.equal(row.runs.length, 0)
 assert.ok(row.notVerified.includes('RUN_RECORDS_REJECTED'))
})
test('missing Linear snapshot is explicit rather than inferred Done', () => {
 const row = buildBundle({ prs: [pr], now }).pullRequests[0]
 assert.equal(row.issues[0].status, 'NOT_FETCHED')
})
test('safe audit URLs reject credentials, signed queries and nonapproved origins', () => {
 assert.equal(safeAuditUrl('https://user:pass@github.com/a/b'), null)
 assert.equal(safeAuditUrl('https://github.com/a/b?token=secret'), null)
 assert.equal(safeAuditUrl('https://untrusted.example/file'), null)
 assert.equal(safeAuditUrl(pr.url), pr.url)
})
test('PR operands are positive integers, deduplicated, never shell syntax', () => {
 assert.deepEqual(parsePrNumbers('1717,1718,1717'), [1717, 1718])
 for (const value of ['1717; touch /tmp/file', '-1', '', '0', '1717,']) assert.throws(() => parsePrNumbers(value))
})
test('collector executes only gh pr view with validated operands, not source instructions', async () => {
 const calls = []
 const result = await collectPr(1717, 'example-owner/real-sohee', async (file, args) => { calls.push([file, args]); return JSON.stringify(pr) })
 assert.equal(result.number, 1717)
 assert.equal(calls[0][0], 'gh')
 assert.deepEqual(calls[0][1].slice(0, 5), ['pr', 'view', '1717', '--repo', 'example-owner/real-sohee'])
 await assert.rejects(collectPr('1717;echo hacked', 'example-owner/real-sohee', async () => '{}'))
})
test('a mismatched PR audit URL cannot bind evidence to another pull request', () => {
 assert.throws(() => bundle([{ ...pr, url: 'https://github.com/example-owner/real-sohee/pull/1722' }]))
})
test('credential-shaped command arguments are excluded, not copied into audit output', () => {
 const result = bundle([pr], [{ ...run, command: ['node', 'scripts/test.mjs', 'sk-sensitivevalue123456789'] }])
 assert.equal(result.pullRequests[0].runs.length, 0)
 assert.equal(JSON.stringify(result).includes('sk-sensitivevalue123456789'), false)
})
test('an issue with no matching PR remains visible as uncovered', () => {
 const result = buildBundle({ prs: [pr], linear: [{ id: 'ANI-1638', status: 'Backlog' }], now })
 const issue = result.issueIndex.find(item => item.id === 'ANI-1638')
 assert.deepEqual(issue.pullRequests, [])
 assert.equal(issue.coverage, 'NO_PR_MENTION')
})
test('arbitrary command arguments such as phone numbers are not audit-safe', () => {
 const result = bundle([pr], [{ ...run, command: ['node', 'scripts/test.mjs', '01012345678'] }])
 assert.equal(result.pullRequests[0].runs.length, 0)
})
test('PR command/exit claims are extracted but do not become bound execution records', () => {
 const row = bundle([{ ...pr, body: 'npm run lint: exit 0\nnpm run typecheck exit137' }]).pullRequests[0]
 assert.deepEqual(row.commandClaims.find(item => item.command[2] === 'lint').exitCode, 0)
 assert.deepEqual(row.commandClaims.find(item => item.command[2] === 'typecheck').exitCode, 137)
 assert.equal(row.runsState, 'MISSING_OR_STALE')
 assert.equal(row.commandClaims[0].source, 'PR_BODY_CLAIM_UNBOUND_TO_RUN')
})
test('collection errors are not converted into observed zero work', () => {
 const result = bundle([{ number: 1722, collectionError: true }])
 assert.equal(result.pullRequests[0].collectionState, 'ERROR')
 assert.equal(result.pullRequests[0].liveState, 'NOT_LIVE_VERIFIED')
 assert.equal(result.issueIndex[0].coverage, 'UNKNOWN_DUE_TO_COLLECTION_ERROR')
})
