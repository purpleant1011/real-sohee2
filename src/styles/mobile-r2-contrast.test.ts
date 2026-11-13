import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * mobile-r2.css 상태 시맨틱 토큰의 WCAG 대비(일반 텍스트 4.5:1) 회귀 방지.
 * StateView / StatusPill 은 `text-state-*` 를 `bg-state-*-soft` 위에 올린다. 이 조합이 깨지면
 * 상태 문구가 읽히지 않으므로 값 변경 시 반드시 이 테스트를 함께 확인한다.
 */

type Rgb = [number, number, number]

const css = fs.readFileSync(path.resolve(process.cwd(), 'src/styles/mobile-r2.css'), 'utf-8')

function blockOf(selectorPattern: RegExp): string {
  const match = selectorPattern.exec(css)
  if (!match) throw new Error('토큰 블록을 찾지 못했습니다.')
  const start = css.indexOf('{', match.index)
  let depth = 0
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}' && --depth === 0) return css.slice(start + 1, i)
  }
  throw new Error('토큰 블록이 닫히지 않았습니다.')
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

const themes = {
  light: declarations(blockOf(/:root,\s*html:not\(\.dark\)\s*\{/)),
  dark: declarations(blockOf(/html\.dark,\s*:root\.dark/)),
} as const

const pairs: Array<[string, string, string]> = [
  ['확인됨', '--state-ok-fg', '--state-ok-bg'],
  ['확인 중', '--state-wait-fg', '--state-wait-bg'],
  ['주의', '--state-warn-fg', '--state-warn-bg'],
  ['위험', '--state-danger-fg', '--state-danger-bg'],
  ['조용함', '--state-quiet-fg', '--state-quiet-bg'],
]

describe.each(Object.entries(themes))('mobile-r2 상태 토큰 대비 4.5:1 (%s)', (_name, tokens) => {
  const color = (token: string) => {
    const value = tokens[token]
    if (!value) throw new Error(`토큰이 없습니다: ${token}`)
    return parseColor(value)
  }

  it.each(pairs)('%s: %s on %s', (_label, fg, bg) => {
    expect(contrast(color(fg), color(bg))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(pairs)('%s: 테두리 토큰이 존재한다', (_label, _fg, bg) => {
    const line = bg.replace('-bg', '-line')
    expect(tokens[line]).toMatch(/^oklch\(/)
  })
})
