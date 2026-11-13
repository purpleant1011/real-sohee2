/**
 * ANI-1666 primary 틴트 대비 시각 증거 캡처
 *
 * 목적: `src/styles/v088-tokens.css` 의 `--primary`/`--ring` L 값 변경(0.53/0.68 → 0.50/0.74)이
 * 실제 렌더에 반영되는지 390px 라이트/다크 화면으로 확인하고 axe 색대비 위반이 없는지 수치로 남긴다.
 *
 * 실행 (증거 recorder 와 무관한 독립 스크립트):
 *   MOBILE_R2_BASE_URL=http://127.0.0.1:3999 GIT_COMMIT=$(git rev-parse --short HEAD) \
 *     node scripts/capture-ani1666-primary-tint-contrast.mjs
 *
 * before 대조군:
 *   git checkout <before-sha> -- src/styles/v088-tokens.css
 *   NAME_SUFFIX=-before OUT_SUFFIX=-before TOKEN_SOURCE="<before-sha>" \
 *     node scripts/capture-ani1666-primary-tint-contrast.mjs
 *   git checkout HEAD -- src/styles/v088-tokens.css
 *
 * 대상: 기존 ab/shell 4종 + primary 틴트 표면 3종
 *       (/dev/mobile-r2-primary-tint?surface=mission|inbox|dm, data-preview-tint 실측 대비 수집)
 *
 * 출력: evidence/mobile-r2/ANI-1666/<YYYYMMDD UTC>/ios-390__<표면>__<scheme>[-before].png
 *       evidence/mobile-r2/ANI-1666/<YYYYMMDD UTC>/ios-390__token-and-axe-readout[-before].json
 * 사전조건: 개발 프리뷰 서버(기본 3999)가 이 워크트리에서 실행 중이어야 한다. 인증이 필요한 앱 라우트는
 * `.env.local` 부재로 렌더할 수 없어 프리뷰 라우트(`/dev/mobile-r2*`)만 캡처한다.
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const REPO = process.cwd()
const require = createRequire(path.join(REPO, 'package.json'))
const { chromium } = require('playwright-core')
const AxeBuilder = require('@axe-core/playwright').default

const BASE = process.env.MOBILE_R2_BASE_URL ?? 'http://127.0.0.1:3999'
const ISSUE = 'ANI-1666'
const YMD = new Date().toISOString().slice(0, 10).replace(/-/g, '')
const OUT = path.join(REPO, 'evidence', 'mobile-r2', ISSUE, YMD)
// NAME_SUFFIX / OUT_SUFFIX: before 캡처 대조군을 같은 증거 폴더에 접미사로 구분해 저장
const NAME_SUFFIX = process.env.NAME_SUFFIX ?? ''
const OUT_SUFFIX = process.env.OUT_SUFFIX ?? ''
mkdirSync(OUT, { recursive: true })

const TARGETS = [
  { file: '/dev/mobile-r2-ab?variant=a&state=ready', name: 'mobile-r2-ab-variant-a-ready' },
  { file: '/dev/mobile-r2-ab?variant=b&state=ready', name: 'mobile-r2-ab-variant-b-ready' },
  { file: '/dev/mobile-r2-ab?variant=a&state=empty', name: 'mobile-r2-ab-variant-a-empty' },
  { file: '/dev/mobile-r2', name: 'mobile-r2-shell' },
  // ANI-1666 primary 틴트 표면(업무 상세·받은 일·메시지) — 15·20% 틴트 위 primary 텍스트 계약 확인
  { file: '/dev/mobile-r2-primary-tint?surface=mission', name: 'mobile-r2-primary-tint-mission' },
  { file: '/dev/mobile-r2-primary-tint?surface=inbox', name: 'mobile-r2-primary-tint-inbox' },
  { file: '/dev/mobile-r2-primary-tint?surface=dm', name: 'mobile-r2-primary-tint-dm' },
]

const browser = await chromium.launch()
const summary = []

for (const target of TARGETS) {
  for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      colorScheme: scheme,
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
      reducedMotion: 'reduce',
    })
    // 앱의 실제 다크 전환 경로: localStorage 'sohee-theme' → layout pre-paint script 가 html.dark 부여
    await context.addInitScript((value) => {
      try { localStorage.setItem('sohee-theme', value) } catch {}
    }, scheme)
    const page = await context.newPage()
    const consoleErrors = []
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
    const url = `${BASE}${target.file}`
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
    await page.waitForTimeout(1200)

    const png = path.join(OUT, `ios-390__${target.name}${NAME_SUFFIX}__${scheme}.png`)
    await page.screenshot({ path: png, fullPage: true })

    const tokens = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement)
      const html = document.documentElement
      const grab = (sel) => Array.from(document.querySelectorAll(sel)).slice(0, 6).map((el) => {
        const s = getComputedStyle(el)
        return {
          text: (el.textContent ?? '').trim().slice(0, 40),
          color: s.color,
          backgroundColor: s.backgroundColor,
          backgroundImage: s.backgroundImage,
        }
      })

      // Tailwind v4 토큰은 lab()/oklch()로 계산되므로 rgb() 정규식만으로는 대비를 계산할 수 없다.
      // canvas fillStyle 이 최신 색 표기를 sRGB 로 변환하므로, rgb() 는 직접 파싱하고 나머지는 canvas 로 읽는다.
      const colorCanvas = document.createElement('canvas')
      colorCanvas.width = 1
      colorCanvas.height = 1
      const colorCtx = colorCanvas.getContext('2d', { willReadFrequently: true })
      const SENTINEL = '#ff00fe'
      const parse = (value) => {
        const raw = String(value ?? '').trim()
        if (!raw || raw === 'none' || raw === 'transparent') return null
        const m = /^rgba?\(([^)]+)\)$/.exec(raw)
        if (m) {
          const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
          if (parts.length < 3 || parts.slice(0, 3).some((n) => Number.isNaN(n))) return null
          return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 && !Number.isNaN(parts[3]) ? parts[3] : 1 }
        }
        // 파싱 실패 시 fillStyle 이 직전 값을 유지하므로 sentinel 로 유효성까지 확인한다.
        colorCtx.fillStyle = SENTINEL
        colorCtx.fillStyle = raw
        if (colorCtx.fillStyle === SENTINEL) return null
        colorCtx.clearRect(0, 0, 1, 1)
        colorCtx.fillRect(0, 0, 1, 1)
        const d = colorCtx.getImageData(0, 0, 1, 1).data
        return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 }
      }
      const over = (top, bottom) => ({
        r: top.r * top.a + bottom.r * (1 - top.a),
        g: top.g * top.a + bottom.g * (1 - top.a),
        b: top.b * top.a + bottom.b * (1 - top.a),
        a: 1,
      })
      // 요소의 실제 렌더 배경: html → … → 요소 순으로 반투명 배경을 알파 합성한다.
      const effectiveBackground = (el) => {
        const chain = []
        for (let node = el; node; node = node.parentElement) chain.unshift(node)
        let base = { r: 255, g: 255, b: 255, a: 1 }
        const rootBg = parse(getComputedStyle(html).backgroundColor)
        if (rootBg && rootBg.a > 0) base = over(rootBg, base)
        for (const node of chain) {
          const bg = parse(getComputedStyle(node).backgroundColor)
          if (bg && bg.a > 0) base = over(bg, base)
        }
        return base
      }
      const luminance = ({ r, g, b }) => {
        const channel = (c) => {
          const s = c / 255
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
      }
      const contrast = (fg, bg) => {
        const l1 = luminance(fg)
        const l2 = luminance(bg)
        const hi = Math.max(l1, l2)
        const lo = Math.min(l1, l2)
        return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
      }
      const fmt = (c) => `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`

      // data-preview-tint: primary 5·10·15·20% 틴트 표면 위 텍스트의 실측 대비
      const tintSamples = Array.from(document.querySelectorAll('[data-preview-tint]')).map((el) => {
        const s = getComputedStyle(el)
        const fg = parse(s.color)
        const bg = effectiveBackground(el)
        const rect = el.getBoundingClientRect()
        const section = el.closest('[data-preview-surface]')
        const container = el.closest('[data-preview-container]')
        return {
          surface: section ? section.getAttribute('data-preview-surface') : null,
          container: container ? container.getAttribute('data-preview-container') : null,
          tint: el.getAttribute('data-preview-tint'),
          text: (el.textContent ?? '').trim().slice(0, 40),
          fontSize: s.fontSize,
          fontWeight: s.fontWeight,
          color: s.color,
          backgroundColor: s.backgroundColor,
          effectiveBackground: fmt(bg),
          // 측정 불가는 PASS 가 아니라 UNKNOWN 이다. null 을 below45 에서 조용히 빼지 않는다.
          measured: Boolean(fg),
          contrastRatio: fg ? contrast(fg, bg) : null,
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        }
      })

      return {
        tintSamples,
        htmlClass: html.className,
        dataTheme: html.getAttribute('data-theme'),
        colorScheme: html.style.colorScheme,
        tokens: {
          primary: cs.getPropertyValue('--primary').trim(),
          ring: cs.getPropertyValue('--ring').trim(),
          primaryForeground: cs.getPropertyValue('--primary-foreground').trim(),
          background: cs.getPropertyValue('--background').trim(),
          card: cs.getPropertyValue('--card').trim(),
          sohee: cs.getPropertyValue('--v088-sohee').trim(),
          soheeHover: cs.getPropertyValue('--v088-sohee-hover').trim(),
        },
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        textPrimarySamples: grab('.text-primary'),
        bgPrimarySamples: grab('.bg-primary'),
      }
    })

    let axe = null
    try {
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
      axe = {
        violations: results.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })),
        violationCount: results.violations.length,
        passes: results.passes.length,
      }
    } catch (error) {
      axe = { error: String(error && error.message ? error.message : error) }
    }

    summary.push({ url, status: response ? response.status() : null, scheme, png: path.relative(REPO, png), tokens, axe, consoleErrors })
    await context.close()
  }
}

writeFileSync(path.join(OUT, `ios-390__token-and-axe-readout${OUT_SUFFIX}.json`), JSON.stringify({
  capturedAt: new Date().toISOString(),
  baseUrl: BASE,
  commit: process.env.GIT_COMMIT ?? null,
  tokenSource: process.env.TOKEN_SOURCE ?? 'worktree',
  viewport: { width: 390, height: 844, deviceScaleFactor: 2 },
  summary,
}, null, 2) + '\n')

await browser.close()
console.log(JSON.stringify(summary.map((s) => {
  const tint = s.tokens.tintSamples ?? []
  const ratios = tint.map((t) => t.contrastRatio).filter((n) => typeof n === 'number')
  return {
    url: s.url, scheme: s.scheme, status: s.status,
    htmlClass: s.tokens.htmlClass, primary: s.tokens.tokens.primary, ring: s.tokens.tokens.ring,
    tintSamples: tint.length,
    minTintContrast: ratios.length ? Math.min(...ratios) : null,
    below45: tint.filter((t) => typeof t.contrastRatio === 'number' && t.contrastRatio < 4.5)
      .map((t) => `${t.surface}/${t.container}/tint-${t.tint}:"${t.text}" ${t.contrastRatio}`),
    unmeasured: tint.filter((t) => !t.measured)
      .map((t) => `${t.surface}/${t.container}/tint-${t.tint}:"${t.text}" color=${t.color}`),
    axeViolations: s.axe?.violationCount ?? s.axe?.error, consoleErrors: s.consoleErrors.length,
  }
}), null, 2))
