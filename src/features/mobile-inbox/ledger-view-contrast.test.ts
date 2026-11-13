import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * M15 예약 장부 충돌 경고의 색 대비 계약 (ANI-1691 · ANI-1737 W9 후속).
 *
 * W9 axe 전수에서 `bg-destructive/10 text-destructive` 조합이 390·320·360·430 폭 모두
 * 4.4:1 로 4.5:1 에 못 미쳤다. 원인은 경고가 페이지 바탕(--muted 계열) 위에 얹혀
 * 10% 틴트가 배경·카드 위보다 진해진 것. 이 화면만 R2 상태 토큰
 * (`bg-state-danger-soft text-state-danger`, 불투명 바탕)으로 바꿨다 — 상위 표면이
 * 무엇이든 계산 대비가 고정된다. 전역 18곳의 같은 조합은 R1 화면 색이 바뀔 수 있어
 * 이 PR 에서 건드리지 않는다.
 *
 * RED 신호 원칙: 파일 읽기·토큰 해석은 테스트 본문에서 지연 평가해, 깨진 계약이
 * 자기 이름으로 실패하게 한다. 실측(axe)은 W9 재측정이 담당한다.
 */

type Rgb = [number, number, number]

const VIEW_FILE = 'src/features/mobile-inbox/ledger-view.tsx'
const TOKENS_FILE = 'src/styles/mobile-r2.css'

function readRepoFile(relativePath: string): string {
  const fullPath = path.resolve(process.cwd(), relativePath)
  if (!fs.existsSync(fullPath)) throw new Error(`파일을 찾지 못했습니다: ${relativePath}`)
  return fs.readFileSync(fullPath, 'utf-8')
}

function blockOf(css: string, selectorPattern: RegExp): string {
  const match = selectorPattern.exec(css)
  if (!match) throw new Error(`선택자 블록을 찾지 못했습니다: ${selectorPattern}`)
  const start = css.indexOf('{', match.index)
  let depth = 0
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}' && --depth === 0) return css.slice(start + 1, i)
  }
  throw new Error('블록이 닫히지 않았습니다.')
}

function declarations(block: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) result[m[1]] = m[2].trim()
  return result
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const encode = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
const decode = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

function oklchToRgb(L: number, C: number, hueDeg: number): Rgb {
  const h = (hueDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.round(encode(clamp01(v)) * 255) / 255) as Rgb
}

function parseColor(value: string): Rgb {
  const oklch = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value)
  if (oklch) return oklchToRgb(Number(oklch[1]), Number(oklch[2]), Number(oklch[3]))
  throw new Error(`지원하지 않는 색상 값: ${value}`)
}

const luminance = ([r, g, b]: Rgb) => 0.2126 * decode(r) + 0.7152 * decode(g) + 0.0722 * decode(b)

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const THEME_SELECTORS = {
  light: /:root,\s*html:not\(\.dark\)\s*\{/,
  dark: /html\.dark,\s*:root\.dark/,
} as const

type ThemeName = keyof typeof THEME_SELECTORS

function alertClassName(): string {
  const match = /role="alert"\s+className="([^"]+)"/.exec(readRepoFile(VIEW_FILE))
  if (!match) throw new Error('ledger-view.tsx 에서 role="alert" 요소를 찾지 못했습니다.')
  return match[1]
}

function tokensOf(theme: ThemeName): Record<string, string> {
  return declarations(blockOf(readRepoFile(TOKENS_FILE), THEME_SELECTORS[theme]))
}

describe('M15 충돌 경고 클래스 계약', () => {
  it('경고는 R2 상태 danger 토큰 쌍을 쓰고 destructive 틴트로 돌아가지 않는다', () => {
    const className = alertClassName()
    expect(className).toContain('text-state-danger')
    expect(className).toContain('bg-state-danger-soft')
    expect(className).not.toContain('bg-destructive/10')
  })
})

describe.each(Object.keys(THEME_SELECTORS) as ThemeName[])(
  'M15 충돌 경고 대비 4.5:1 (%s)',
  (theme) => {
    it('text-state-danger 가 bg-state-danger-soft 위에서 4.5:1 이상이다', () => {
      const tokens = tokensOf(theme)
      const ink = parseColor(tokens['--state-danger-fg'])
      const back = parseColor(tokens['--state-danger-bg'])
      const ratio = contrast(ink, back)
      expect(
        ratio,
        `text-state-danger on bg-state-danger-soft (${theme}) = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5)
    })
  },
)
