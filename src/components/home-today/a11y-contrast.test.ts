import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 오늘 홈 실제 화면 대비 회귀 가드 (ANI-1737).
 *
 * 2026-10-24 프로덕션 /app 실측(axe 4.12, wcag21aa)에서 15개 노드가 4.5:1 미달이었다.
 * - eyebrow `text-primary/80`  : #7e60e3 on #f9fafd = 4.31
 * - 승인 카드 긴급 라벨 `text-amber-600` : #e17100 on #fafbfd = 3.09 (11건)
 * - 가동 중 배지 `bg-emerald-600` 흰 글자 : #ffffff on #009966 = 3.65 (3건)
 * 색만 되돌려도 테스트가 깨지도록, 클래스 선택과 실제 대비값을 함께 고정한다.
 */
const SRC = join(__dirname, '..', '..')
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8')

function luminance(hex: string): number {
  const value = hex.replace('#', '')
  const channels = [0, 2, 4].map(i => Number.parseInt(value.slice(i, i + 2), 16) / 255)
  const linear = channels.map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground)
  const b = luminance(background)
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

describe('오늘 홈 색 대비', () => {
  it('eyebrow 는 투명도를 낮춘 primary 를 쓰지 않는다', () => {
    const source = read('components/home-today/legacy-today-home.tsx')
    expect(source).toContain('text-[11px] sm:text-xs font-semibold text-primary tracking-wide')
    expect(source).not.toContain('text-primary/80 tracking-wide')
  })

  it('승인 카드 긴급 라벨은 대비가 고정된 state-warn 토큰이다', () => {
    // ANI-1772: 원색 amber 대신 시맨틱 토큰으로 옮겼다. 대비 계약은 mobile-r2-contrast.test.ts 가
    // --state-warn-fg 를 6.5:1 로 고정한다. 낮은 대비의 amber-600 으로 되돌아가지 않도록 함께 잠근다.
    for (const rel of ['components/home-today/home-approval-hub.tsx', 'components/home-today/swipe-approval-deck.tsx']) {
      const source = read(rel)
      expect(source).not.toMatch(/text-amber-\d{2,3}(?:\/\d+)? flex items-center/)
      expect(source).toMatch(/text-state-warn flex items-center/)
    }
  })

  it('가동 중 배지는 emerald-700 바탕을 쓴다', () => {
    const source = read('features/empty-states/empty-state.tsx')
    expect(source).toContain('bg-emerald-700 text-white')
    expect(source).not.toContain('bg-emerald-600 text-white')
  })

  it('바꾼 색은 실제로 4.5:1 을 넘는다', () => {
    expect(contrast('#5f3add', '#f9fafd')).toBeGreaterThanOrEqual(4.5) // primary on 오늘 홈 배경
    expect(contrast('#bb4d00', '#fafbfd')).toBeGreaterThanOrEqual(4.5) // amber-700 on 카드
    expect(contrast('#ffffff', '#007a55')).toBeGreaterThanOrEqual(4.5) // 흰 글자 on emerald-700
  })
})
