import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/**
 * W2 모바일 비주얼 A/B 검수 (ANI-1671).
 *
 * 대상: /dev/mobile-r2-ab — 개발 환경 전용. 운영에서는 404이므로 dev 서버로 검수한다.
 * 범위: 320/360/375/390/430 5개 해상도, 8개 정보 상태 axe, 200% 글자 확대, 가로 넘침 없음.
 */

const VARIANTS = ['a', 'b'] as const
const WIDTHS = [320, 360, 375, 390, 430] as const
const STATES = [
  'ready',
  'loading',
  'empty',
  'partial',
  'stale',
  'error',
  'offline',
  'unauthorized',
] as const

const EVIDENCE_DIR = path.join(process.cwd(), 'evidence', 'mobile-r2', 'ANI-1671')

const abUrl = (variant: string, state: string, nav = true) =>
  `/dev/mobile-r2-ab?variant=${variant}&state=${state}${nav ? '&nav=1' : ''}`

/**
 * 화면 진입 애니메이션(m-state-in, 180ms)이 끝난 뒤 측정한다.
 *
 * 애니메이션 도중에는 opacity가 1 미만이라 실제 색이 섞여 보이고, axe가 그 중간값을
 * 측정해 거짓 대비 위반을 낸다(같은 노드가 정지 후에는 위반 0). 사용자에게 보이는
 * 최종 렌더를 측정해야 하므로 유한 애니메이션의 finished를 기다린다. 무한 애니메이션
 * (스켈레톤 pulse 등)은 끝나지 않으므로 제외하고, 최대 1초까지만 기다린다.
 */
async function settleMotion(page: Page) {
  await page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
    await Promise.race([
      Promise.all(finite.map((animation) => animation.finished.catch(() => undefined))),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ])
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
  })
}

/**
 * 증거 캡처 옵션.
 *
 * 스켈레톤 호흡(m-breathe)은 무한 애니메이션이라 캡처 시점마다 opacity가 달라진다.
 * Playwright의 `animations: 'disabled'`는 무한 애니메이션을 초기 상태로 고정하고
 * 유한 애니메이션을 끝까지 진행시켜, 같은 코드에서 항상 같은 PNG가 나오게 한다.
 * (axe 측정은 위 settleMotion이 최종 렌더를 보장하므로 별개다.)
 */
const CAPTURE = { fullPage: true, animations: 'disabled' } as const

/**
 * Next.js dev 오버레이를 숨긴다.
 *
 * `devIndicators: false`는 개발 도구 버튼만 없애고, 컴파일 이슈 카운트 배지
 * (`[data-next-badge-root]`, 화면 좌하단 "1 Issue")는 이슈가 생길 때만 스스로
 * 나타난다. 개발 중 편집으로 이슈가 한 번 잡히면 그 뒤 캡처에 배지가 섞여
 * 증거 해시가 흔들리므로, 캡처 전에 포털 자체를 숨긴다. 운영 빌드에는
 * `nextjs-portal`이 존재하지 않아 이 규칙은 아무 효과가 없다.
 */
async function hideDevOverlay(page: Page) {
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
}

async function openAb(page: Page, variant: string, state: string) {
  const response = await page.goto(abUrl(variant, state), { waitUntil: 'domcontentloaded' })
  expect(response?.status(), `${variant}/${state} 응답`).toBe(200)
  await expect(page.locator(`[data-variant="${variant}"][data-state="${state}"]`)).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText('예시 화면 · 실제 데이터 아님').first()).toBeVisible()
  await hideDevOverlay(page)
  await settleMotion(page)
  // 웹폰트 교체(FOUT)가 끝나기 전에 캡처하면 실행마다 글자 폭이 달라져 증거 해시가 흔들린다.
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(overflow.scrollWidth, `${label} 가로 넘침`).toBeLessThanOrEqual(overflow.innerWidth + 1)
}

test.beforeAll(async () => {
  await mkdir(EVIDENCE_DIR, { recursive: true })
})

test.describe('A/B 검수 페이지', () => {
  for (const variant of VARIANTS) {
    test(`${variant.toUpperCase()}안 — 5개 해상도 렌더·가로 넘침·캡처`, async ({ page }) => {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 })
        await openAb(page, variant, 'ready')
        await expectNoHorizontalOverflow(page, `${variant}/${width}`)

        // 주 행동 버튼은 44px 이상 터치 영역을 유지한다.
        const cta = page
          .getByRole('button', { name: variant === 'a' ? '문안 확인하기' : '문안 보기' })
          .first()
        await expect(cta).toBeVisible()
        const box = await cta.boundingBox()
        expect(box?.height ?? 0, `${variant}/${width} CTA 높이`).toBeGreaterThanOrEqual(44)

        await page.screenshot({
          path: path.join(EVIDENCE_DIR, `${variant}-ready-${width}.png`),
          ...CAPTURE,
        })
      }
    })

    test(`${variant.toUpperCase()}안 — 8개 정보 상태 axe (390px)`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 900 })

      for (const state of STATES) {
        await openAb(page, variant, state)
        await expectNoHorizontalOverflow(page, `${variant}/${state}`)

        const { violations } = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()

        expect(
          violations.map((violation) => `${violation.id} (${violation.nodes.length})`),
          `${variant}/${state} 접근성 위반`,
        ).toEqual([])

        if (state !== 'ready') {
          await page.screenshot({
            path: path.join(EVIDENCE_DIR, `${variant}-${state}-390.png`),
            ...CAPTURE,
          })
        }
      }
    })

    test(`${variant.toUpperCase()}안 — 200% 글자 확대 (390px)`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 900 })
      await openAb(page, variant, 'ready')
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%'
      })
      await settleMotion(page)
      await expectNoHorizontalOverflow(page, `${variant}/200%`)
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, `${variant}-ready-390-text200.png`),
        ...CAPTURE,
      })
    })
  }

  test('오류 상태를 빈 목록으로 표현하지 않는다', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    await openAb(page, 'b', 'error')
    await expect(page.getByText('불러오지 못했어요').first()).toBeVisible()
    await expect(page.getByText('아직 아무것도 없어요')).toHaveCount(0)
  })
})
