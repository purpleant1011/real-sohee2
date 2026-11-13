import { describe, expect, it } from 'vitest'
import {
  OVERLAY_PRESETS,
  computeOverlayLayout,
  normalizeOverlayTexts,
  type OverlayTexts,
} from './overlay-template'

const texts: OverlayTexts = {
  brandLine: 'BY.REUM BROW',
  designLine: "Design. Women's Combo Brow",
  quote: '자연스럽게 스며드는 또렷함,\n눈썹 하나로 달라지는 분위기.',
  insetLabel: 'BEFORE',
}

describe('presets', () => {
  it('ships the studio portrait, men, lash and review card presets with industry-neutral descriptions', () => {
    expect(OVERLAY_PRESETS.map((p) => p.id)).toEqual(['portrait-left', 'portrait-right', 'lash-circle', 'review-card'])
    for (const preset of OVERLAY_PRESETS) expect(preset.label.length).toBeGreaterThan(0)
    expect(OVERLAY_PRESETS.find((p) => p.id === 'portrait-left')!.description).toContain('(기본)')
    expect(OVERLAY_PRESETS.find((p) => p.id === 'portrait-right')!.description).toContain('(오른쪽 정렬)')
    expect(OVERLAY_PRESETS.find((p) => p.id === 'lash-circle')!.description).toContain('(작은 핵심 디테일)')
  })
})

describe('computeOverlayLayout', () => {
  it('puts a rectangular BEFORE strip in the top-left corner and the text block bottom-left (4:5 canvas)', () => {
    const layout = computeOverlayLayout({ width: 1440, height: 1800 }, 'portrait-left', texts, { beforeAspect: 3 })
    expect(layout.inset).toMatchObject({ shape: 'rect', label: 'BEFORE' })
    // 실측 기반 비율 단언 (±0.02 허용)
    expect(layout.inset!.x / layout.width).toBeCloseTo(0.03, 1)
    expect(layout.inset!.y / layout.height).toBeCloseTo(0.057, 1)
    expect(layout.inset!.w / layout.width).toBeCloseTo(0.33, 1)
    expect(layout.inset!.w / layout.inset!.h).toBeCloseTo(3, 1)

    const brand = layout.texts.find((t) => t.role === 'brand')!
    expect(brand.align).toBe('left')
    expect(brand.y / layout.height).toBeCloseTo(0.755, 1)
    expect(brand.size / layout.width).toBeCloseTo(0.052, 1)
    expect(brand.color).toBe('#ffffff')

    const design = layout.texts.find((t) => t.role === 'design')!
    expect(design.color).toBe('#5421c6')
    expect(design.size / layout.width).toBeCloseTo(0.034, 1)

    expect(layout.texts.map((t) => t.role)).toEqual(['brand', 'design', 'quote-1', 'quote-2'])
  })

  it('right-aligns the text block for the right preset and keeps everything inside the canvas', () => {
    const layout = computeOverlayLayout({ width: 1440, height: 1800 }, 'portrait-right', texts, { beforeAspect: 3 })
    for (const t of layout.texts) {
      expect(t.align).toBe('right')
      expect(t.x).toBeGreaterThan(layout.width * 0.5)
      expect(t.x).toBeLessThanOrEqual(layout.width)
    }
    expect(layout.inset!.x + layout.inset!.w).toBeLessThanOrEqual(layout.width)

    const brand = layout.texts.find((t) => t.role === 'brand')!
    const design = layout.texts.find((t) => t.role === 'design')!
    // 남성/우측 정렬: design이 위, brand가 아래
    expect(design.y).toBeLessThan(brand.y)
    expect(brand.size / layout.width).toBeCloseTo(0.082, 1)
    expect(design.size / layout.width).toBeCloseTo(0.033, 1)
  })

  it('uses a circular inset in the top-right for the lash preset', () => {
    const layout = computeOverlayLayout({ width: 1440, height: 1800 }, 'lash-circle', texts, { beforeAspect: 1 })
    expect(layout.inset).toMatchObject({ shape: 'circle' })
    expect(layout.inset!.x + layout.inset!.w).toBeGreaterThan(layout.width * 0.85)
    expect(layout.inset!.w).toBe(layout.inset!.h)
    // 원형 컷 지름 실측 약 0.245W
    expect(layout.inset!.w / layout.width).toBeCloseTo(0.245, 1)
    expect(layout.inset!.y / layout.height).toBeCloseTo(0.02, 1)
  })

  it('skips the inset when there is no before photo and skips empty lines', () => {
    const layout = computeOverlayLayout({ width: 1000, height: 1250 }, 'portrait-left', { ...texts, designLine: '', quote: '' }, { beforeAspect: null })
    expect(layout.inset).toBeNull()
    expect(layout.texts.map((t) => t.role)).toEqual(['brand'])
  })

  it('draws a review card as a panel with heading and wrapped body text', () => {
    const layout = computeOverlayLayout({ width: 1440, height: 1800 }, 'review-card', { ...texts, brandLine: 'CUSTOMER REVIEW', designLine: 'BY.REUM BROW', quote: '너무 마음에 들어요\n처음엔 걱정했는데 자연스러워요' }, { beforeAspect: null })
    expect(layout.panel).toMatchObject({ fill: expect.any(String) })
    expect(layout.texts.find((t) => t.role === 'brand')!.text).toBe('CUSTOMER REVIEW')
    expect(layout.texts.filter((t) => t.role.startsWith('quote')).length).toBe(2)
  })

  it('scales type with the canvas width', () => {
    const small = computeOverlayLayout({ width: 720, height: 900 }, 'portrait-left', texts, { beforeAspect: 3 })
    const large = computeOverlayLayout({ width: 1440, height: 1800 }, 'portrait-left', texts, { beforeAspect: 3 })
    expect(large.texts[0]!.size).toBeCloseTo(small.texts[0]!.size * 2, 0)
  })
})

describe('normalizeOverlayTexts', () => {
  it('trims, limits length and keeps at most 4 quote lines', () => {
    const result = normalizeOverlayTexts({ brandLine: ' BY.REUM BROW ', designLine: 'a'.repeat(200), quote: '1\n2\n3\n4\n5\n6', insetLabel: '' })
    expect(result.brandLine).toBe('BY.REUM BROW')
    expect(result.designLine.length).toBe(80)
    expect(result.quote.split('\n')).toHaveLength(4)
    expect(result.insetLabel).toBe('BEFORE')
  })
})
