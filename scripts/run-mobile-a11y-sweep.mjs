#!/usr/bin/env node
// ANI-1737 모바일 접근성 순회 실행기.
//
// ego-browser 는 스크립트를 eval 로 돌리기 때문에 `process.cwd()` 가 "/" 이고 환경변수도
// 상속하지 않는다. 그래서 순회 스크립트가 저장소 위치를 스스로 알 수 없다.
// 예전 판본은 다른 worktree 의 절대 경로를 박아 두어, 다른 체크아웃에서 돌리면 증거가
// 저장소 밖에 쓰이거나 실패했다. 여기서 저장소 루트를 계산해 주입한다.
//
// 사용: npm run a11y:mobile-r2:sweep
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SWEEP_RELATIVE_PATH = 'tests/ego/mobile-r2-a11y-sweep.mjs'

/**
 * ego-browser 표준입력으로 넘길 실행 본문을 만든다.
 * 저장소 루트를 전역으로 먼저 정의해야 순회 스크립트가 axe-core·규칙 모듈·증거 폴더를
 * 모두 저장소 기준으로 계산할 수 있다.
 */
export function buildSweepEntry(repoRoot, sweepSource) {
  if (!repoRoot || !path.isAbsolute(repoRoot)) {
    throw new Error(`저장소 루트는 절대 경로여야 합니다: ${repoRoot}`)
  }
  if (typeof sweepSource !== 'string' || sweepSource.trim() === '') {
    throw new Error('순회 스크립트 본문이 비어 있습니다.')
  }
  return `globalThis.__REPO_ROOT__ = ${JSON.stringify(repoRoot)}\n${sweepSource}`
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const sweepSource = await readFile(path.join(repoRoot, SWEEP_RELATIVE_PATH), 'utf8')
  const entry = buildSweepEntry(repoRoot, sweepSource)

  const child = spawn('ego-browser', ['nodejs'], { cwd: repoRoot, stdio: ['pipe', 'inherit', 'inherit'] })
  child.on('error', (error) => {
    console.error('ego-browser 를 실행하지 못했습니다. ego-browser 가 PATH 에 있는지 확인하세요.', error.message)
    process.exitCode = 1
  })
  child.on('exit', (code) => {
    process.exitCode = code ?? 1
  })
  child.stdin.end(entry)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
