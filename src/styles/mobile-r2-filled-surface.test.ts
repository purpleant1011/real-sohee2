import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * 채움 상태 배지의 대비 회귀 방지.
 *
 * `bg-state-*` (진한 상태색) 위에는 `--state-*-bg` 계열 전경(`text-state-*-soft`)을 얹는다.
 * 이 쌍은 mobile-r2.css 에서 테마별로 ≥6.5:1 로 설계되어 있어, 테마와 무관하게 읽힌다.
 * 이 파일은 다음을 고정한다.
 *  1) 상태 채움 표면의 전경/바탕 대비 ≥ 4.5:1 (라이트·다크)
 *  2) 사진 위 배지(항상 어두운 표면)는 테마 잉크를 쓰지 않는다 — 라이트에서 1.02:1 로 무너지므로
 *  3) warn 채움 버튼은 흰 글씨(text-white)를 쓰지 않는다 — 다크에서 1.60:1 로 무너지므로
 */

type Rgb = [number, number, number]

const root = process.cwd()
const css = fs.readFileSync(path.resolve(root, 'src/styles/mobile-r2.css'), 'utf-8')
const approvalModal = fs.readFileSync(
  path.resolve(root, 'src/components/publishing/exact-approval-modal.tsx'),
  'utf-8'
)
const commentCard = fs.readFileSync(
  path.resolve(root, 'src/features/engagement/engagement-comment-card.tsx'),
  'utf-8'
)

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

/** 반투명 오버레이를 불투명 바탕 위에 합성한다. */
function over(overlay: Rgb, alpha: number, under: Rgb): Rgb {
  return overlay.map((c, i) => c * alpha + under[i] * (1 - alpha)) as Rgb
}

const themes = {
  light: declarations(blockOf(/:root,\s*html:not\(\.dark\)\s*\{/)),
  dark: declarations(blockOf(/html\.dark,\s*:root\.dark/)),
} as const

const filledPairs: Array<[string, string, string]> = [
  ['확인됨 배지', '--state-ok-fg', '--state-ok-bg'],
  ['주의 버튼', '--state-warn-fg', '--state-warn-bg'],
]

describe.each(Object.entries(themes))('상태 채움 표면 대비 4.5:1 (%s)', (_name, tokens) => {
  const color = (token: string) => {
    const value = tokens[token]
    if (!value) throw new Error(`토큰이 없습니다: ${token}`)
    return parseColor(value)
  }

  it.each(filledPairs)('%s: bg + 전경 ≥ 4.5:1', (_label, bgToken, fgToken) => {
    expect(contrast(color(bgToken), color(fgToken))).toBeGreaterThanOrEqual(4.5)
  })
})

describe('사진 위 배지 — 항상 어두운 표면', () => {
  it('라이트 테마 잉크를 그대로 얹으면 4.5:1 미달이므로 사용하지 않는다', () => {
    // bg-black/70 을 흰 사진 위에 합성한 최악(가장 밝은) 표면
    const scrim = over([0, 0, 0], 0.7, [1, 1, 1])
    expect(contrast(parseColor(themes.light['--state-ok-fg']), scrim)).toBeLessThan(4.5)
  })

  it('채움 표면 + 대응 전경으로 고정한다', () => {
    const line = approvalModal
      .split('\n')
      .find((l) => l.includes('absolute bottom-2 left-2') && l.includes('className='))
    expect(line, 'exact-approval-modal.tsx 의 사진 위 배지 className 을 찾지 못했습니다.').toBeTruthy()
    expect(line).toContain('bg-state-ok')
    expect(line).toContain('text-state-ok-soft')
    expect(line).not.toContain('text-white')
    expect(line).not.toMatch(/text-state-ok(?!-soft)/)
    expect(line).not.toContain('bg-black/70')
  })
})

describe('warn 채움 버튼 — 흰 글씨 금지', () => {
  it('다크 테마에서 흰 글씨는 4.5:1 미달이다', () => {
    expect(contrast(parseColor(themes.dark['--state-warn-fg']), [1, 1, 1])).toBeLessThan(4.5)
  })

  it('재시도 버튼은 대응 전경(text-state-warn-soft)을 쓴다', () => {
    const line = commentCard.split('\n').find((l) => l.includes('bg-state-warn hover:bg-state-warn/90'))
    expect(line, 'engagement-comment-card.tsx 의 재시도 버튼 className 을 찾지 못했습니다.').toBeTruthy()
    expect(line).toContain('text-state-warn-soft')
    expect(line).not.toContain('text-white')
  })
})
