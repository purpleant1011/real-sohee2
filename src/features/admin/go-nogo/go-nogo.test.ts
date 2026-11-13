import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { CHECKLIST } from './checklist'
import { evaluateAll, evaluateItem, verdict } from './evaluate'
import { readAllRecords } from './store'

const item = CHECKLIST[0]
const base = {
  itemId: item.id, command: 'x', exitCode: 0, summary: 's',
  startedAt: '2026-10-07T00:00:00.000Z', finishedAt: '2026-10-07T00:00:01.000Z',
  gitSha: 'abc123', logPath: 'evidence/runs/logs/x.log',
}
const script = path.resolve(process.cwd(), 'scripts/record-evidence.mjs')

describe('go/no-go evaluate', () => {
  it('기록 없음 = NOT_RUN', () => {
    expect(evaluateItem(item, { kind: 'MISSING' }).status).toBe('NOT_RUN')
  })
  it('저장소 읽기 실패 = 확인 불가(UNKNOWN), 빈 값이 아님', () => {
    const r = evaluateItem(item, { kind: 'ERROR' })
    expect(r.status).toBe('UNKNOWN')
    expect(r.reason.length).toBeGreaterThan(0)
  })
  it('종료코드 비0 = FAIL', () => {
    expect(evaluateItem(item, { kind: 'RECORD', record: { ...base, exitCode: 1 }, logExists: true }).status).toBe('FAIL')
  })
  it('종료코드 0 + 증거 완비 = PASS', () => {
    expect(evaluateItem(item, { kind: 'RECORD', record: base, logExists: true }).status).toBe('PASS')
  })
  it('종료코드 0이어도 로그/버전 없으면 NOT_VERIFIED (초록 금지)', () => {
    expect(evaluateItem(item, { kind: 'RECORD', record: base, logExists: false }).status).toBe('NOT_VERIFIED')
    expect(evaluateItem(item, { kind: 'RECORD', record: { ...base, gitSha: '' }, logExists: true }).status).toBe('NOT_VERIFIED')
  })
  it('blocked 기록 = BLOCKED, 형식 오류/다른 항목 기록 = UNKNOWN', () => {
    expect(evaluateItem(item, { kind: 'RECORD', record: { ...base, exitCode: null, blocked: '환경 없음' }, logExists: true }).status).toBe('BLOCKED')
    expect(evaluateItem(item, { kind: 'RECORD', record: { foo: 1 }, logExists: true }).status).toBe('UNKNOWN')
    expect(evaluateItem(item, { kind: 'RECORD', record: { ...base, itemId: 'other' }, logExists: true }).status).toBe('UNKNOWN')
  })
  it('전부 미실행이면 보류, FAIL 하나면 NO_GO', () => {
    const missing = evaluateAll(Object.fromEntries(CHECKLIST.map((c) => [c.id, { kind: 'MISSING' as const }])))
    expect(verdict(missing)).toBe('UNDECIDED')
    const withFail = evaluateAll({ [item.id]: { kind: 'RECORD', record: { ...base, exitCode: 2 }, logExists: true } })
    expect(verdict(withFail)).toBe('NO_GO')
  })
})

describe('go/no-go store + record-evidence 통합', () => {
  it('실패 명령은 FAIL, 실행 안 한 항목은 NOT_RUN, 깨진 JSON은 확인 불가', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gonogo-'))
    const run = spawnSync('node', [script, 'typecheck', '--', 'node', '-e', 'console.error("boom");process.exit(3)'], { cwd: root, encoding: 'utf8' })
    expect(run.status).toBe(3)
    await fs.writeFile(path.join(root, 'evidence/runs/user-copy.json'), '{broken')
    const by = Object.fromEntries(evaluateAll(await readAllRecords(root)).map((r) => [r.item.id, r.status]))
    expect(by['typecheck']).toBe('FAIL')
    expect(by['user-copy']).toBe('UNKNOWN')
    expect(by['golden-e2e']).toBe('NOT_RUN')
  })
  it('성공 명령은 시각·로그와 함께 기록(저장소가 아니면 버전 없어 NOT_VERIFIED)', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gonogo-'))
    const run = spawnSync('node', [script, 'user-copy', '--', 'node', '-e', 'console.log("ok")'], { cwd: root, encoding: 'utf8' })
    expect(run.status).toBe(0)
    const r = evaluateAll(await readAllRecords(root)).find((x) => x.item.id === 'user-copy')!
    expect(r.status).toBe('NOT_VERIFIED')
    expect(r.record?.finishedAt).toBeTruthy()
    expect(r.record?.summary).toContain('ok')
  })
  it('실행 못한 사유는 BLOCKED 로 기록', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gonogo-'))
    const run = spawnSync('node', [script, 'golden-e2e', '--blocked', '시험 계정 없음'], { cwd: root, encoding: 'utf8' })
    expect(run.status).toBe(0)
    const r = evaluateAll(await readAllRecords(root)).find((x) => x.item.id === 'golden-e2e')!
    expect(r.status).toBe('BLOCKED')
  })
  it('알 수 없는 항목 id는 거부', () => {
    expect(spawnSync('node', [script, 'nope', '--', 'node', '-e', '0'], { encoding: 'utf8' }).status).not.toBe(0)
  })
})

describe('상수 PASS 금지 (grep)', () => {
  it('go-nogo 코드/페이지에 하드코딩된 PASS 판정은 evaluate.ts 단일 지점뿐', async () => {
    const dir = __dirname
    const files = [
      ...(await fs.readdir(dir)).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => path.join(dir, f)),
      path.resolve(process.cwd(), 'src/app/admin/go-nogo/page.tsx'),
    ]
    for (const f of files) {
      const src = await fs.readFile(f, 'utf8')
      const hits = src.match(/(status\s*:\s*|return\s+)['"]PASS['"]/g) ?? []
      expect(hits.length, `${path.basename(f)} 에 상수 PASS`).toBeLessThanOrEqual(f.endsWith('evaluate.ts') ? 1 : 0)
    }
  })
  it('PASS 판정은 종료코드 검사 뒤에만 도달', async () => {
    const src = await fs.readFile(path.join(__dirname, 'evaluate.ts'), 'utf8')
    const pass = src.indexOf("status: 'PASS', reason")
    const exit = src.indexOf('record.exitCode !== 0')
    expect(exit).toBeGreaterThan(-1)
    expect(exit).toBeLessThan(pass)
  })
})
