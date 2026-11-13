import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * 테마 토큰 조합의 WCAG 대비(일반 텍스트 4.5:1) 회귀 방지.
 * 실제 화면의 axe 실측(evidence/v092/a11y)과 별개로, 토큰 값만으로 계산 가능한 조합을 고정한다.
 */

type Rgb = [number, number, number]

const css = fs.readFileSync(path.resolve(process.cwd(), 'src/styles/v088-tokens.css'), 'utf-8')

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
  const hex = /^#([0-9a-f]{6})$/i.exec(value)
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16) / 255) as Rgb
  throw new Error(`지원하지 않는 색상 값: ${value}`)
}

const luminance = ([r, g, b]: Rgb) => 0.2126 * decode(r) + 0.7152 * decode(g) + 0.0722 * decode(b)

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Button 기본/destructive 변형의 hover 는 `bg-<token>/90` 이므로 바탕과 90:10 으로 섞인 색을 검사한다. */
const mix = (top: Rgb, back: Rgb, alpha: number): Rgb =>
  top.map((v, i) => Math.round((v * alpha + back[i] * (1 - alpha)) * 255) / 255) as Rgb

const themes = {
  light: declarations(blockOf(/:root,\s*html:not\(\.dark\)\s*\{/)),
  dark: declarations(blockOf(/html\.dark,\s*:root\.dark/)),
} as const

const textPairs: Array<[string, string, string]> = [
  ['본문', '--foreground', '--background'],
  ['카드 본문', '--card-foreground', '--card'],
  ['팝오버 본문', '--popover-foreground', '--popover'],
  ['보조 버튼', '--secondary-foreground', '--secondary'],
  ['강조 영역', '--accent-foreground', '--accent'],
  ['보조 글씨/배경', '--muted-foreground', '--background'],
  ['보조 글씨/카드', '--muted-foreground', '--card'],
  ['보조 글씨/흐린 바탕', '--muted-foreground', '--muted'],
  ['보조 글씨/보조 바탕', '--muted-foreground', '--secondary'],
  ['보조 글씨/강조 바탕', '--muted-foreground', '--accent'],
  ['브랜드 글씨/카드', '--primary', '--card'],
]

describe.each(Object.entries(themes))('테마 토큰 대비 4.5:1 (%s)', (_name, tokens) => {
  const color = (token: string) => parseColor(tokens[token])

  it.each(textPairs)('%s: %s on %s', (_label, fg, bg) => {
    expect(contrast(color(fg), color(bg))).toBeGreaterThanOrEqual(4.5)
  })

  /**
   * 틴트형 primary 표면 계약: `bg-primary/20 text-primary`(미션 상세 단계 행 등)처럼
   * primary 색을 15~20% 틴트로 깔고 그 위에 primary 텍스트를 얹는 조합도 4.5:1 을 지킨다.
   * primary 의 L 을 낮추면(라이트) 채움 대비가, 높이면(다크) 틴트 위 대비가 먼저 무너지므로 두 테마 모두 검사한다.
   */
  it.each(['--background', '--card', '--popover'])(
    'primary 텍스트가 %s 위 primary 20%·15% 틴트에서 4.5:1 이상이다',
    (bg) => {
      const ink = color('--primary')
      for (const alpha of [0.2, 0.15]) {
        const tint = mix(ink, color(bg), alpha)
        expect(contrast(ink, tint)).toBeGreaterThanOrEqual(4.5)
      }
    },
  )
})

describe('라이트 테마(기본) 버튼 토큰 대비', () => {
  const color = (token: string) => parseColor(themes.light[token])

  it('기본 버튼 글씨/바탕이 4.5:1 이상이다 (axe color-contrast 위반 원인: 이전 4.49:1)', () => {
    expect(contrast(color('--primary-foreground'), color('--primary'))).toBeGreaterThanOrEqual(4.5)
  })

  it('브랜드 색 글씨가 페이지 배경 위에서 4.5:1 이상이다', () => {
    expect(contrast(color('--primary'), color('--background'))).toBeGreaterThanOrEqual(4.5)
  })

  it('기본 버튼 hover(primary/90)도 어느 바탕 위에서든 4.5:1 이상이다', () => {
    for (const back of ['--background', '--card']) {
      const hover = mix(color('--primary'), color(back), 0.9)
      expect(contrast(color('--primary-foreground'), hover)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('삭제 버튼 글씨/바탕이 4.5:1 이상이다', () => {
    expect(contrast(color('--destructive-foreground'), color('--destructive'))).toBeGreaterThanOrEqual(4.5)
  })

  it('삭제 버튼 hover(destructive/90)도 어느 바탕 위에서든 4.5:1 이상이다', () => {
    for (const back of ['--background', '--card']) {
      const hover = mix(color('--destructive'), color(back), 0.9)
      expect(contrast(color('--destructive-foreground'), hover)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('삭제 텍스트가 카드·페이지 배경 위에서 4.5:1 이상이다', () => {
    for (const back of ['--background', '--card']) {
      expect(contrast(color('--destructive'), color(back))).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('10% 삭제 틴트(bg-destructive/10) 위 삭제 텍스트가 4.5:1 이상이다', () => {
    for (const back of ['--background', '--card']) {
      const tint = mix(color('--destructive'), color(back), 0.1)
      expect(contrast(color('--destructive'), tint)).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('다크 테마 버튼 토큰 대비', () => {
  const color = (token: string) => parseColor(themes.dark[token])

  it('기본 버튼 글씨/바탕이 4.5:1 이상이다 (흰 글씨 3.25:1 위반 수정)', () => {
    expect(contrast(color('--primary-foreground'), color('--primary'))).toBeGreaterThanOrEqual(4.5)
  })

  it('기본 버튼 hover(primary/90)도 어느 바탕 위에서든 4.5:1 이상이다', () => {
    for (const back of ['--background', '--card']) {
      const hover = mix(color('--primary'), color(back), 0.9)
      expect(contrast(color('--primary-foreground'), hover)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('삭제 버튼 글씨/바탕이 4.5:1 이상이다 (흰 글씨 3.71:1 위반 수정)', () => {
    expect(contrast(color('--destructive-foreground'), color('--destructive'))).toBeGreaterThanOrEqual(4.5)
  })

  it('삭제 버튼 hover(destructive/90)도 어느 바탕 위에서든 4.5:1 이상이다', () => {
    for (const back of ['--background', '--card']) {
      const hover = mix(color('--destructive'), color(back), 0.9)
      expect(contrast(color('--destructive-foreground'), hover)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('삭제 텍스트가 카드·페이지 배경 위에서 4.5:1 이상이다', () => {
    for (const back of ['--background', '--card']) {
      expect(contrast(color('--destructive'), color(back))).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('10% 삭제 틴트(bg-destructive/10) 위 삭제 텍스트가 4.5:1 이상이다', () => {
    for (const back of ['--background', '--card']) {
      const tint = mix(color('--destructive'), color(back), 0.1)
      expect(contrast(color('--destructive'), tint)).toBeGreaterThanOrEqual(4.5)
    }
  })
})

/**
 * 틴트형 표면은 채움형 전경색을 쓰지 않는다는 계약.
 * 다크에서 --destructive-foreground 는 어두운 잉크(채움형 전용)이므로 10% 틴트 위에 얹으면 대비가 무너진다.
 */
describe('틴트형 destructive 표면 계약', () => {
  const alertSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/ui/alert.tsx'), 'utf-8')

  it('Alert destructive 변형은 destructive-foreground 가 아닌 destructive 잉크를 쓴다', () => {
    const variant = /destructive:\s*"([^"]+)"/.exec(alertSource)?.[1]
    expect(variant).toBeTruthy()
    expect(variant).toContain('text-destructive ')
    expect(variant).not.toContain('destructive-foreground')
  })
})

/**
 * 컴포넌트 변형은 시맨틱 토큰만 쓴다(§3.4 원색 유틸 금지).
 * Button 의 purple variant(bg-purple-600 text-white)는 2026-10-23 ANI-1666 에서 제거됐다.
 */
describe('Button 변형 원색 유틸 금지 계약', () => {
  const buttonSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/ui/button.tsx'), 'utf-8')

  it('Button 소스에 purple 원색 유틸이 남아 있지 않다', () => {
    expect(buttonSource).not.toContain('purple')
  })
})
