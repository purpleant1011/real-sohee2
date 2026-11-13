import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

/** 상태 토큰 fg/bg 대비 4.5:1 (light/dark). token-contrast.test.ts 와 동일 수식. */
const css = fs.readFileSync(path.resolve(process.cwd(), 'src/styles/mobile-r2.css'), 'utf-8')
const enc = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
const dec = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const cl = (v: number) => Math.min(1, Math.max(0, v))
function rgb(L: number, C: number, H: number) {
  const h = (H * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map((v) => dec(enc(cl(v))))
}
const lum = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
function block(re: RegExp) { const i = css.search(re); const s = css.indexOf('{', i); return css.slice(s, css.indexOf('}', s)) }
function tokens(b: string) { const o: Record<string, number[]> = {}; for (const m of b.matchAll(/(--state-[\w-]+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/g)) o[m[1]] = rgb(+m[2], +m[3], +m[4]); return o }

const themes = { light: tokens(block(/:root,\s*html:not\(\.dark\)/)), dark: tokens(block(/html\.dark,\s*:root\.dark/)) }
describe.each(Object.entries(themes))('%s 상태 토큰', (_n, t) => {
  it.each(['ok', 'wait', 'warn', 'danger', 'quiet'])('%s fg/bg ≥ 4.5', (k) => {
    expect(t[`--state-${k}-fg`]).toBeTruthy()
    expect(ratio(t[`--state-${k}-fg`], t[`--state-${k}-bg`])).toBeGreaterThanOrEqual(4.5)
  })
})
