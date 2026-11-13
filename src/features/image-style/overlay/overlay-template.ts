/**
 * 생성된 사진 위에 얹는 문구·전(BEFORE) 삽입컷 템플릿.
 * 사진 모델은 글자를 정확히 그리지 못하므로, 글자와 삽입컷은 사진이 끝난 뒤 이 레이아웃으로 따로 합성한다.
 * 이 파일은 좌표 계산만 하는 순수 함수라 서버·브라우저·테스트에서 똑같이 쓴다.
 */

export type OverlayPresetId = 'portrait-left' | 'portrait-right' | 'lash-circle' | 'review-card'

export type OverlayTexts = Readonly<{
  /** 큰 흰색 세리프 한 줄. 예: 우리 가게 이름 */
  brandLine: string
  /** 포인트 컬러 한 줄. 예: Design. Women's Combo Brow */
  designLine: string
  /** 작은 본문. 줄바꿈으로 최대 4줄 */
  quote: string
  /** 삽입컷 위 라벨. 비우면 BEFORE */
  insetLabel: string
}>

export type OverlayPreset = Readonly<{ id: OverlayPresetId; label: string; description: string }>

export const OVERLAY_PRESETS: readonly OverlayPreset[] = [
  { id: 'portrait-left', label: '포트레이트 · 왼쪽 문구', description: '왼쪽 위 BEFORE 사각 컷, 왼쪽 아래 문구 (기본)' },
  { id: 'portrait-right', label: '포트레이트 · 오른쪽 문구', description: '왼쪽 위 BEFORE 사각 컷, 오른쪽 아래 문구 (오른쪽 정렬)' },
  { id: 'lash-circle', label: '원형 BEFORE 컷', description: '오른쪽 위 원형 BEFORE 컷, 오른쪽 아래 문구 (작은 핵심 디테일)' },
  { id: 'review-card', label: '후기 카드', description: '고객 후기 문장을 카드로 (사진이 있으면 배경으로)' },
]

export type LayoutText = Readonly<{
  role: 'brand' | 'design' | 'quote-1' | 'quote-2' | 'quote-3' | 'quote-4' | 'subtitle'
  text: string
  x: number
  y: number
  size: number
  align: 'left' | 'right' | 'center'
  color: string
  font: 'serif' | 'sans'
  weight: number
}>

export type OverlayLayout = Readonly<{
  width: number
  height: number
  background: string | null
  header: Readonly<{ x: number; y: number; w: number; h: number; fill: string }> | null
  panel: Readonly<{ x: number; y: number; w: number; h: number; radius: number; fill: string }> | null
  inset: Readonly<{ x: number; y: number; w: number; h: number; shape: 'rect' | 'circle'; label: string; labelSize: number; labelX: number; labelY: number }> | null
  texts: readonly LayoutText[]
}>

const WHITE = '#ffffff'
const PURPLE = '#5421c6'
const SOFT_PURPLE = '#7356a5'

function clip(value: string, max: number) {
  return value.trim().slice(0, max)
}

export function normalizeOverlayTexts(input: OverlayTexts): OverlayTexts {
  const quote = input.quote
    .split('\n')
    .map((line) => clip(line, 80))
    .filter((line) => line.length > 0)
    .slice(0, 4)
    .join('\n')
  return {
    brandLine: clip(input.brandLine, 60),
    designLine: clip(input.designLine, 80),
    quote,
    insetLabel: clip(input.insetLabel, 20) || 'BEFORE',
  }
}

function quoteRoles(count: number): Array<'quote-1' | 'quote-2' | 'quote-3' | 'quote-4'> {
  return (['quote-1', 'quote-2', 'quote-3', 'quote-4'] as const).slice(0, count)
}

/** 한글은 넓고 라틴은 좁다. 줄바꿈 위치를 대략 잡는 용도라 근사치면 충분하다. */
function estimateWidth(text: string, size: number) {
  let total = 0
  for (const ch of text) total += /[ᄀ-ᇿ㄰-㆏가-힯一-鿿]/u.test(ch) ? size * 0.95 : size * 0.55
  return total
}

export function wrapLines(text: string, maxWidth: number, size: number): string[] {
  const lines: string[] = []
  for (const raw of text.split('\n')) {
    let current = ''
    for (const ch of raw) {
      if (estimateWidth(current + ch, size) > maxWidth && current.length > 0) {
        lines.push(current)
        current = ch
      } else {
        current += ch
      }
    }
    if (current.length > 0) lines.push(current)
  }
  return lines.slice(0, 6)
}

export function computeOverlayLayout(
  canvas: Readonly<{ width: number; height: number }>,
  preset: OverlayPresetId,
  rawTexts: OverlayTexts,
  options: Readonly<{ beforeAspect: number | null }>,
): OverlayLayout {
  const { width: W, height: H } = canvas
  const texts = normalizeOverlayTexts(rawTexts)
  const quoteLines = texts.quote ? texts.quote.split('\n') : []

  if (preset === 'review-card') {
    const headerW = W * 0.62
    const header = { x: (W - headerW) / 2, y: H * 0.13, w: headerW, h: H * 0.05, fill: '#e8c3dd' }
    const bodySize = W * 0.03
    const panelX = W * 0.1
    const panelW = W * 0.8
    const wrapped = quoteLines.flatMap((line) => wrapLines(line, panelW - W * 0.08, bodySize)).slice(0, 4)
    const lineGap = bodySize * 1.75
    const panelH = Math.max(bodySize * 4, wrapped.length * lineGap + bodySize * 2.4)
    const panelY = H * 0.24
    const out: LayoutText[] = []
    if (texts.brandLine) out.push({ role: 'brand', text: texts.brandLine, x: W / 2, y: header.y + header.h * 0.68, size: W * 0.036, align: 'center', color: '#b04b94', font: 'serif', weight: 500 })
    if (texts.designLine) out.push({ role: 'subtitle', text: texts.designLine, x: W / 2, y: header.y + header.h + W * 0.04, size: W * 0.02, align: 'center', color: '#8d8795', font: 'serif', weight: 400 })
    wrapped.forEach((line, index) => {
      out.push({ role: quoteRoles(4)[index]!, text: line, x: panelX + W * 0.04, y: panelY + bodySize * 1.9 + index * lineGap, size: bodySize, align: 'left', color: '#2a2a2a', font: 'sans', weight: 400 })
    })
    return {
      width: W, height: H, background: '#f4f2ef', header,
      panel: { x: panelX, y: panelY, w: panelW, h: panelH, radius: W * 0.015, fill: '#ffffff' },
      inset: null, texts: out,
    }
  }

  const right = preset === 'portrait-right'
  const circle = preset === 'lash-circle'
  const textX = right || circle ? W * 0.94 : W * 0.05
  const align: 'left' | 'right' = right || circle ? 'right' : 'left'
  const out: LayoutText[] = []

  // 실측 기반 글자 크기 비율
  // portrait-left: brand ~0.052W, design ~0.034W, quote ~0.024W
  // portrait-right: brand ~0.082W, design ~0.033W, quote ~0.015W
  // lash-circle: brand ~0.065W, design ~0.034W, quote ~0.026W
  const brandSize = W * (right ? 0.082 : circle ? 0.065 : 0.052)
  const designSize = W * (right ? 0.033 : 0.034)
  const quoteSize = W * (right ? 0.015 : circle ? 0.026 : 0.024)
  const quoteGap = quoteSize * (right ? 1.55 : 1.65)
  const quoteBlock = quoteLines.length * quoteGap
  const bottom = H * (right ? 0.95 : circle ? 0.91 : 0.89)
  const quoteTop = bottom - quoteBlock + quoteGap * 0.8
  const lastBaseline = quoteLines.length > 0 ? quoteTop + (quoteLines.length - 1) * quoteGap : bottom
  const firstTitleBaseline = quoteLines.length > 0 ? quoteTop - (right ? quoteSize * 2.0 : designSize * 1.6) : bottom

  if (right) {
    // 우측 정렬: 포인트 컬러 한 줄이 위, 큰 흰 글씨가 아래.
    const brandY = firstTitleBaseline
    const designY = brandY - brandSize * 0.95
    if (texts.designLine) out.push({ role: 'design', text: texts.designLine, x: textX, y: designY, size: designSize, align, color: PURPLE, font: 'serif', weight: 500 })
    if (texts.brandLine) out.push({ role: 'brand', text: texts.brandLine, x: textX, y: brandY, size: brandSize, align, color: WHITE, font: 'serif', weight: 500 })
  } else {
    const designY = firstTitleBaseline
    const brandY = designY - designSize * 1.7
    if (texts.brandLine) out.push({ role: 'brand', text: texts.brandLine, x: textX, y: brandY, size: brandSize, align, color: circle ? PURPLE : WHITE, font: 'serif', weight: 500 })
    if (texts.designLine) out.push({ role: 'design', text: texts.designLine, x: textX, y: designY, size: designSize, align, color: PURPLE, font: 'serif', weight: 500 })
  }
  quoteLines.forEach((line, index) => {
    out.push({ role: quoteRoles(4)[index]!, text: line, x: textX, y: quoteTop + index * quoteGap, size: quoteSize, align, color: right ? SOFT_PURPLE : WHITE, font: 'sans', weight: 300 })
  })
  void lastBaseline

  let inset: OverlayLayout['inset'] = null
  if (options.beforeAspect && options.beforeAspect > 0) {
    if (circle) {
      const d = W * 0.245
      const x = W - W * 0.045 - d
      const y = H * 0.02
      const labelSize = W * 0.021
      inset = { x, y, w: d, h: d, shape: 'circle', label: texts.insetLabel, labelSize, labelX: x + d / 2, labelY: y + d + labelSize * 1.0 }
    } else {
      const w = W * 0.33
      const h = w / options.beforeAspect
      const x = W * 0.03
      const y = H * 0.057
      const labelSize = W * 0.03
      inset = { x, y, w, h, shape: 'rect', label: texts.insetLabel, labelSize, labelX: x + w / 2, labelY: y + labelSize * 0.38 }
    }
  }

  return { width: W, height: H, background: null, header: null, panel: null, inset, texts: out }
}
