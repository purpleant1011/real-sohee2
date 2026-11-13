import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractRules, mediaMatches, resolveDeclarations } from './helpers/css-media'

/**
 * ANI-1761 AC-7 · 가입 후속 화면(로그인·가입) 320/360/390/430 폭 계약.
 *
 * 가입 직후 사장님이 실제로 만나는 화면은 대부분 320~430px 폰이다. 이 폭에서
 * 카드가 뷰포트를 넘거나(가로 스크롤) 터치 타깃이 44px 아래로 줄면 가입이 거기서 끊긴다.
 * 브라우저 없이 "어느 규칙이 실제로 이기는가"로 판정한다 — 규칙을 지우면 반드시 깨져야 한다.
 *
 * 좌우 여백 기준은 모바일 토큰 `--m-inset: 1rem`(16px) 이다.
 */

const SIGNUP_CSS = readFileSync(
  join(process.cwd(), 'src/app/(auth)/signup/signup.module.css'),
  'utf8',
)
const LOGIN_CSS = readFileSync(
  join(process.cwd(), 'src/app/(auth)/login/login.module.css'),
  'utf8',
)

/** AC-7 수락 기준 폭. 목록 자체가 계약이므로 여기서 고정한다. */
const MOBILE_WIDTHS = [320, 360, 390, 430] as const

/**
 * rem·px·min() 을 px 로. 해석할 수 없으면 조용히 통과시키지 않고 실패한다.
 *
 * `min(1rem, 16px)` 은 텍스트 확대에서 rem 이 커져도 16px 을 넘지 않는다는 뜻이므로
 * "넘지 않는다" 계약에는 최솟값으로 계산해 넣는다(기본 루트 16px 기준).
 */
function px(value: string | undefined, label: string): number {
  const text = (value ?? '').trim()

  const min = /^min\((.+)\)$/u.exec(text)
  if (min) {
    const parts = min[1].split(',').map((part) => px(part, label))
    return Math.min(...parts)
  }

  const rem = /^(-?[\d.]+)rem$/u.exec(text)
  if (rem) return Number(rem[1]) * 16
  const pixels = /^(-?[\d.]+)px$/u.exec(text)
  if (pixels) return Number(pixels[1])
  throw new Error(`${label}: px/rem 값이 아닙니다 → ${text}`)
}

/**
 * 선택자 문자열이 정확히 같은 규칙만 모아, 그 폭에서 최종 값을 계산한다.
 * `.form input:not([type="checkbox"])` 처럼 조합 선택자는 resolveDeclarations 의
 * 단일 마디 대상으로 표현할 수 없어 이 경로를 쓴다(캐스케이드는 파일 뒤쪽이 이긴다).
 */
function effectiveDeclarations(
  css: string,
  selector: string,
  width: number,
): Record<string, string> {
  const winners: Record<string, string> = {}
  let matched = 0
  for (const rule of extractRules(css)) {
    if (!mediaMatches(rule.media, width)) continue
    if (!rule.selectors.includes(selector)) continue
    matched += 1
    Object.assign(winners, rule.declarations)
  }
  if (matched === 0) throw new Error(`규칙을 찾지 못했습니다: ${selector}`)
  return winners
}

describe('ANI-1761 AC-7 가입 화면 폭 계약', () => {
  it.each(MOBILE_WIDTHS)('%ipx: 가입 화면은 한 단으로 쌓인다', (width) => {
    const layout = resolveDeclarations(SIGNUP_CSS, ['.layout'], width)

    expect(layout['grid-template-columns']).toBe('minmax(0, 1fr)')
  })

  it.each(MOBILE_WIDTHS)('%ipx: 좌우 여백이 16px 을 넘지 않는다', (width) => {
    const page = resolveDeclarations(SIGNUP_CSS, ['.page'], width)

    expect(px(page.padding, `${width}px 좌우 여백`)).toBeLessThanOrEqual(16)
  })

  it.each(MOBILE_WIDTHS)('%ipx: 카드 안쪽 여백이 24px 을 넘지 않는다', (width) => {
    const card = resolveDeclarations(SIGNUP_CSS, ['.card'], width)

    expect(px(card.padding, `${width}px 카드 여백`)).toBeLessThanOrEqual(24)
  })

  it.each(MOBILE_WIDTHS)('%ipx: 입력칸이 그리드 트랙보다 좁아질 수 있다', (width) => {
    // WebKit 의 input 기본 min-content(약 305px)를 풀지 않으면 320px 에서 카드가 넘친다.
    const input = effectiveDeclarations(SIGNUP_CSS, '.form input:not([type="checkbox"])', width)

    expect(input.width).toBe('100%')
    expect(input['min-width']).toBe('0')
    expect(input['box-sizing']).toBe('border-box')
  })

  it.each(MOBILE_WIDTHS)('%ipx: 약관 보기 링크가 44px 터치 타깃을 지킨다', (width) => {
    const link = effectiveDeclarations(SIGNUP_CSS, '.legalLink', width)

    expect(px(link['min-width'], `${width}px 링크 폭`)).toBeGreaterThanOrEqual(44)
    expect(px(link['min-height'], `${width}px 링크 높이`)).toBeGreaterThanOrEqual(44)
  })

  it.each(MOBILE_WIDTHS)('%ipx: 제출 버튼이 48px 높이를 지킨다', (width) => {
    const button = effectiveDeclarations(SIGNUP_CSS, '.form button', width)

    expect(px(button['min-height'], `${width}px 버튼 높이`)).toBeGreaterThanOrEqual(48)
  })

  it.each(MOBILE_WIDTHS)('%ipx: 제목이 좁은 화면용 크기로 줄어든다', (width) => {
    const heading = resolveDeclarations(SIGNUP_CSS, ['.introTitle'], width)

    // 2.8rem(44.8px) 은 320px 에서 폼을 화면 밖으로 밀어낸다.
    expect(px(heading['font-size'], `${width}px 제목 크기`)).toBeLessThanOrEqual(36)
  })
})

describe('ANI-1761 AC-7 로그인 화면 폭 계약', () => {
  it.each(MOBILE_WIDTHS)('%ipx: 로그인 화면은 한 단으로 쌓인다', (width) => {
    const page = resolveDeclarations(LOGIN_CSS, ['.loginPage'], width)

    expect(page['grid-template-columns']).toBe('1fr')
  })

  it.each(MOBILE_WIDTHS)('%ipx: 셸 폭이 고정 px 가 아니라 뷰포트에 붙는다', (width) => {
    const page = resolveDeclarations(LOGIN_CSS, ['.loginPage'], width)
    const brand = resolveDeclarations(LOGIN_CSS, ['.authBrand'], width)

    expect(page.width, `${width}px 본문 폭`).toMatch(/^min\(100% - [\d.]+rem, 72rem\)$/u)
    expect(brand.width, `${width}px 브랜드 폭`).toMatch(/^min\(100% - [\d.]+rem, 72rem\)$/u)
  })

  it.each(MOBILE_WIDTHS)('%ipx: 로그인 카드 여백이 데스크톱 값이 아니다', (width) => {
    const card = resolveDeclarations(LOGIN_CSS, ['.card'], width)

    // 기본 규칙은 clamp(1.5rem, 4vw, 2.5rem) 이다. 430px 규칙이 이를 이겨야 한다.
    expect(card.padding, `${width}px 카드 여백`).not.toContain('clamp')
  })

  it.each(MOBILE_WIDTHS)('%ipx: 구글 로그인 버튼이 폭을 꽉 채운다', (width) => {
    const button = resolveDeclarations(LOGIN_CSS, ['.googleButton'], width)

    expect(button.width).toBe('100%')
    expect(px(button['min-height'], `${width}px 버튼 높이`)).toBeGreaterThanOrEqual(44)
  })
})

describe('ANI-1761 AC-7 검사기 자기검증 (거짓 PASS 방지)', () => {
  it('760px 규칙을 지우면 가입 화면 한 단 계약이 실제로 깨진다', () => {
    const withoutStacking = SIGNUP_CSS.replace(
      /@media \(max-width: 760px\)/u,
      '@media (max-width: 1px)',
    )

    expect(withoutStacking).not.toBe(SIGNUP_CSS)
    expect(resolveDeclarations(withoutStacking, ['.layout'], 390)['grid-template-columns']).toBe(
      'minmax(0, 1.1fr) minmax(0, 0.9fr)',
    )
  })

  it('430px 규칙이 없으면 320px 여백 계약이 실제로 실패한다', () => {
    const withoutNarrow = SIGNUP_CSS.replace(
      /@media \(max-width: 430px\)/u,
      '@media (max-width: 1px)',
    )

    expect(withoutNarrow).not.toBe(SIGNUP_CSS)
    expect(
      px(resolveDeclarations(withoutNarrow, ['.page'], 320).padding, '320px 좌우 여백'),
    ).toBeGreaterThan(16)
  })

  it('좁은 화면 규칙은 760px 규칙보다 뒤에 있어야 이긴다', () => {
    // 명시도가 같으면 파일 뒤쪽이 이긴다. 순서가 뒤집히면 430px 보정이 조용히 죽는다.
    expect(SIGNUP_CSS.indexOf('@media (max-width: 430px)')).toBeGreaterThan(
      SIGNUP_CSS.indexOf('@media (max-width: 760px)'),
    )
  })

  it('min() 을 해석하지 못하면 조용히 통과하지 않는다', () => {
    // 확대 대응으로 여백에 min() 상한을 두면 이 헬퍼가 min() 을 알아야 한다.
    // 모르는 값을 0 이나 NaN 으로 흘리면 "넘지 않는다" 계약이 거짓 PASS 가 된다.
    expect(px('min(1rem, 16px)', '자가검증')).toBe(16)
    expect(px('min(2rem, 17.6px)', '자가검증')).toBe(17.6)
    expect(() => px('calc(1rem + 2px)', '자가검증')).toThrow(/px\/rem 값이 아닙니다/u)
  })
})
