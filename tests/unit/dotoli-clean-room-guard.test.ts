import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// ANI-1891: 도톨이(DotoliAI) 역공학 산출물과 디컴파일 코드는 상용 코드베이스에 반입할 수 없다.
// 공개 라이선스가 있다고 가정하지 않는다. 설계 원리만 clean-room 으로 참고한다.
const SELF = 'tests/unit/dotoli-clean-room-guard.test.ts'
const FORBIDDEN_PATH = [
  /(^|\/)decompiled_src(\/|$)/u,
  /(^|\/)extracted_(pyinstaller|dmg)(\/|$)/u,
  /(^|\/)pycdc(\/|$)/u,
  /\.dis\.txt$/u,
  /\.py[co]$/u,
]
const FORBIDDEN_CONTENT = [
  /blog_ai_poc/u,
  /decompiled_src/u,
  /Decompiled (from|with)/iu,
  /Unsupported opcode/u,
  /Source Generated with Decompyle/iu,
  /DotoliAI[-_ ]?\d/iu,
]
const CODE_ROOTS = /^(src|supabase|scripts|tests|public)\//u
const TEXT_FILE = /\.(ts|tsx|mts|mjs|js|jsx|json|sql|md|py|css|html|sh|yml|yaml)$/u

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0').filter(Boolean)
}

describe('ANI-1891: clean-room boundary for decompiled third-party code', () => {
  const files = trackedFiles()

  it('tracks no decompiled, unpacked or disassembled artifacts', () => {
    expect(files.filter((file) => FORBIDDEN_PATH.some((pattern) => pattern.test(file)))).toEqual([])
  })

  it('references no decompiled module names or decompiler output in product code', () => {
    const offenders = files
      .filter((file) => file !== SELF && CODE_ROOTS.test(file) && TEXT_FILE.test(file))
      .filter((file) => {
        const text = readFileSync(file, 'utf8')
        return FORBIDDEN_CONTENT.some((pattern) => pattern.test(text))
      })
    expect(offenders).toEqual([])
  })

  it('keeps the reverse-engineering workspace out of git', () => {
    expect(files.filter((file) => file.startsWith('idea/'))).toEqual([])
  })
})
