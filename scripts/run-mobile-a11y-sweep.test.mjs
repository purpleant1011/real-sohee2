import { describe, expect, it } from 'vitest'
import { buildSweepEntry, SWEEP_RELATIVE_PATH } from './run-mobile-a11y-sweep.mjs'

describe('buildSweepEntry — 순회 실행 본문', () => {
  it('저장소 루트를 전역으로 먼저 주입한다', () => {
    // ego-browser 는 eval 로 실행되어 cwd 가 "/" 이고 환경변수도 없다.
    // 스크립트가 스스로 저장소를 찾을 수 있도록 본문 맨 앞에 루트를 넣어야 한다.
    const entry = buildSweepEntry('/Users/dev/real-sohee', 'console.log(1)')
    const firstLine = entry.split('\n')[0]
    expect(firstLine).toBe('globalThis.__REPO_ROOT__ = "/Users/dev/real-sohee"')
    expect(entry).toContain('console.log(1)')
  })

  it('경로에 공백이나 따옴표가 있어도 안전하게 직렬화한다', () => {
    const repoRoot = '/Users/dev/My "Sohee" Repo'
    const entry = buildSweepEntry(repoRoot, 'x')
    expect(entry.split('\n')[0]).toBe(`globalThis.__REPO_ROOT__ = ${JSON.stringify(repoRoot)}`)
    // 주입한 리터럴이 실제로 그 값을 복원하는지 확인한다(문자열 깨짐 방지).
    expect(JSON.parse(entry.split('\n')[0].replace('globalThis.__REPO_ROOT__ = ', ''))).toBe(repoRoot)
  })

  it('절대 경로가 아니면 실행을 거부한다', () => {
    // 상대 경로를 그대로 쓰면 ego 런타임(cwd="/")에서 엉뚱한 곳을 가리킨다.
    expect(() => buildSweepEntry('tests/ego', 'x')).toThrow(/절대 경로/u)
    expect(() => buildSweepEntry('', 'x')).toThrow(/절대 경로/u)
  })

  it('본문이 비면 거부한다', () => {
    expect(() => buildSweepEntry('/Users/dev/real-sohee', '   ')).toThrow(/비어 있습니다/u)
    expect(() => buildSweepEntry('/Users/dev/real-sohee', undefined)).toThrow(/비어 있습니다/u)
  })

  it('순회 스크립트 경로는 저장소 기준 상대 경로로 고정한다', () => {
    expect(SWEEP_RELATIVE_PATH).toBe('tests/ego/mobile-r2-a11y-sweep.mjs')
  })
})
