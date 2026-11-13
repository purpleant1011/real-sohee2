import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * SegmentedControl 대비 계약 (ANI-1666 후속).
 *
 * 세그먼트 항목은 `--color-surface-muted` 바탕 위에 얹히고, 선택 항목만
 * `--color-surface-raised` 바탕을 갖는다. 비활성 항목은 오래도록 `opacity` 로 흐리게
 * 처리해 왔는데, opacity 는 글씨를 바탕 쪽으로 섞어 실제 렌더 대비를 1.9:1 수준까지
 * 끌어내린다(WCAG 1.4.3 위반). 그래서 이 계약은
 *   1) 비활성 규칙이 opacity 를 쓰지 않는다
 *   2) 비활성 항목이 자기 글씨색을 명시한다
 *   3) 활성/비활성 항목 글씨가 어느 바탕 위에서든 4.5:1 이상이다
 * 를 토큰 값만으로 고정한다. 실측(axe)은 e2e 증거가 담당한다.
 *
 * RED 신호 원칙: 파일/선택자/토큰 해석은 전부 테스트 본문 안에서 지연 평가한다.
 * 수집(collect) 단계에서 던지면 어떤 계약이 깨졌는지 이름 없이 스위트 전체가
 * 실패하므로, 위반한 계약마다 자기 이름으로 실패해야 한다.
 */

type Rgb = [number, number, number]

const TOKENS_FILE = 'src/styles/v07-tokens.css'
const MODULE_FILE = 'src/components/ui/segmented-control.module.css'

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

/** CSS 모듈의 특정 규칙 본문(선언만)을 꺼낸다. */
function ruleBody(css: string, selectorPattern: RegExp): string {
  const match = selectorPattern.exec(css)
  if (!match) throw new Error(`규칙을 찾지 못했습니다: ${selectorPattern}`)
  const start = css.indexOf('{', match.index)
  const end = css.indexOf('}', start)
  if (end === -1) throw new Error('규칙이 닫히지 않았습니다.')
  return css.slice(start + 1, end)
}

const decode = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

function hexToRgb(value: string): Rgb {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim())
  if (!hex) throw new Error(`지원하지 않는 색상 값: ${value}`)
  return [0, 2, 4].map((i) => parseInt(hex![1].slice(i, i + 2), 16) / 255) as Rgb
}

/** `var(--a)` 사슬을 따라가 실제 hex 값을 얻는다. */
function resolveToken(tokens: Record<string, string>, name: string): Rgb {
  let current = name
  for (let depth = 0; depth < 10; depth++) {
    const value = tokens[current]
    if (value === undefined) throw new Error(`토큰을 찾지 못했습니다: ${current}`)
    const alias = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value)
    if (!alias) return hexToRgb(value)
    current = alias[1]
  }
  throw new Error(`토큰 참조가 순환합니다: ${name}`)
}

const luminance = ([r, g, b]: Rgb) => 0.2126 * decode(r) + 0.7152 * decode(g) + 0.0722 * decode(b)

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const THEME_SELECTORS = {
  light: /^:root\s*\{/m,
  dark: /^:root\[data-theme='dark'\]\s*\{/m,
} as const

type ThemeName = keyof typeof THEME_SELECTORS

/** 테스트 본문에서만 호출한다 — 토큰 해석 실패가 수집 단계로 새지 않게. */
function tokensOf(theme: ThemeName): Record<string, string> {
  return declarations(blockOf(readRepoFile(TOKENS_FILE), THEME_SELECTORS[theme]))
}

const RULES = {
  item: /^\.item\s*\{/m,
  disabled: /^\.item\[data-disabled\]\s*\{/m,
} as const

type RuleName = keyof typeof RULES

function bodyOf(rule: RuleName): string {
  return ruleBody(readRepoFile(MODULE_FILE), RULES[rule])
}

/** 규칙이 쓰는 글씨 토큰 이름을 꺼낸다. */
function inkTokenOf(body: string, rule: RuleName): string {
  const match = /color:\s*var\((--[\w-]+)\)/.exec(body)
  if (!match) {
    throw new Error(
      `.${rule === 'disabled' ? 'item[data-disabled]' : 'item'} 규칙에 color: var(--token) 선언이 없습니다.`,
    )
  }
  return match[1]
}

describe('SegmentedControl 비활성 표시 방식', () => {
  it('비활성 항목을 opacity 로 흐리게 만들지 않는다', () => {
    expect(bodyOf('disabled')).not.toMatch(/opacity\s*:/)
  })

  it('비활성 항목은 커서로도 상태를 알린다', () => {
    expect(bodyOf('disabled')).toMatch(/cursor:\s*not-allowed/)
  })

  it('비활성 항목은 자기 글씨색을 명시한다', () => {
    expect(inkTokenOf(bodyOf('disabled'), 'disabled')).toMatch(/^--color-/)
  })
})

const CONTRAST_CASES = [
  { label: '활성 항목', rule: 'item', surface: '--color-surface-muted' },
  { label: '비활성 항목', rule: 'disabled', surface: '--color-surface-muted' },
  { label: '비활성 항목(선택 상태 바탕)', rule: 'disabled', surface: '--color-surface-raised' },
  { label: '비활성 개수 배지', rule: 'disabled', surface: '--color-surface-emphasis' },
] as const satisfies ReadonlyArray<{ label: string; rule: RuleName; surface: string }>

describe.each(Object.keys(THEME_SELECTORS) as ThemeName[])(
  'SegmentedControl 항목 대비 4.5:1 (%s)',
  (theme) => {
    it.each(CONTRAST_CASES)('$label on $surface', ({ label, rule, surface }) => {
      const tokens = tokensOf(theme)
      const ink = inkTokenOf(bodyOf(rule), rule)
      const ratio = contrast(resolveToken(tokens, ink), resolveToken(tokens, surface))
      expect(
        ratio,
        `${label}: ${ink} on ${surface} (${theme}) = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5)
    })
  },
)
