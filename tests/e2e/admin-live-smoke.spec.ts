import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

const storageState = process.env.SOHEE_LIVE_STORAGE_STATE
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 1024, height: 900 },
  { name: 'compact-tablet', width: 820, height: 1180 },
  { name: 'mobile', width: 390, height: 844 },
] as const

const protectedRoutes = [
  { path: '/admin', heading: '운영 현황' },
  { path: '/admin/admins', heading: '관리자 계정' },
  { path: '/admin/audit', heading: '감사 기록' },
  { path: '/admin/billing', heading: '결제·크레딧' },
  { path: '/admin/channels', heading: '채널' },
  { path: '/admin/onboarding', heading: '가입·계약' },
  { path: '/admin/publishing', heading: '게시' },
  { path: '/admin/system', heading: '시스템' },
  { path: '/admin/workspaces', heading: '고객사' },
] as const

const mutationWords = /초대|권한 변경|승인 요청|복구 실행|재시도|세션 종료|삭제|연결|해제|내보내기|적용/u
const secretShapedValue = /(?:\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b|\bsbp_[a-zA-Z0-9_-]{16,}\b|\bservice_role(?:=|:)\s*[a-zA-Z0-9._-]{16,}\b|\bsk-[a-zA-Z0-9_-]{16,}\b|\bBearer\s+[a-zA-Z0-9._-]{16,}\b|\b(?:access_token|refresh_token)\s*=\s*[^\s"']+|\bpassword\s*=\s*[^\s"']+)/iu
const loadErrorText = /불러오지 못|불러오지 못했어요|페이지 오류|internal server error|서버 오류/iu
const guardText = /승인|사유|2인|두 번째|적용|분리|재확인|추가 인증/iu

function routeLoadFailurePattern(path: string): RegExp {
  if (path === '/admin/admins') return /관리자 목록을 안전하게 불러오지 못했습니다|관리자 선택 자료를 불러오지 못했습니다|승인 목록을 불러오지 못했습니다/iu
  if (path === '/admin/audit') return /감사 기록을 불러오지 못했습니다/iu
  if (path === '/admin/system') return /시스템 관측 자료를 안전하게 불러오지 못했습니다|사고 원장을 안전하게 불러오지 못했습니다/iu
  if (path === '/admin/billing') return /결제 읽기 모델을 안전하게 불러오지 못했습니다/iu
  if (path === '/admin/channels') return /채널 운영 자료를 불러오지 못했습니다/iu
  if (path === '/admin/workspaces') return /고객사 목록을 안전하게 불러오지 못했습니다|검색 조건을 안전하게 처리하지 못했습니다/iu
  if (path.startsWith('/admin/workspaces/')) return /고객사 상세를 안전하게 불러오지 못했습니다|자료를 (?:안전하게 )?불러오지 못했습니다|자료를 확인할 수 없습니다/iu
  return loadErrorText
}

async function assertReadOnlySurface(page: Page, path: string, heading: string, failedResponses: string[]) {
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' })
  expect(response?.status(), `${path} HTTP status`).toBeLessThan(500)
  await expect(page.getByRole('heading', { name: new RegExp(heading, 'u') }).first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${path} horizontal overflow`).toBe(true)
  const body = await page.locator('body').innerText()
  expect(body).not.toMatch(secretShapedValue)
  expect(await page.locator('input[type="password"]').evaluateAll((inputs) => inputs.some((input) => (input as HTMLInputElement).value.length > 0))).toBe(false)
  expect(body, `${path} safe load failure`).not.toMatch(routeLoadFailurePattern(path))
  for (const button of await page.getByRole('button').all()) {
    const label = (await button.innerText()).trim()
    if (!mutationWords.test(label)) continue
    if (await button.isDisabled()) continue
    const context = await button.locator('xpath=ancestor::*[self::form or self::section or @role="group"][1]').innerText().catch(() => label)
    expect(context, `${path} enabled mutation guard: ${label}`).toMatch(guardText)
  }
  expect(failedResponses, `${path} failed responses`).toEqual([])
}

async function createReadOnlyContext(browser: Browser) {
  return browser.newContext({ storageState })
}

test.describe('LIVE_READ_ONLY — ANI-72 authenticated admin smoke gate', () => {
  test.skip(!storageState, 'SOHEE_LIVE_STORAGE_STATE가 제공된 읽기 전용 환경에서만 실행합니다.')

  for (const viewport of viewports) {
    test(`${viewport.name} renders all canonical admin read routes without mutation`, async ({ browser }) => {
      const context: BrowserContext = await createReadOnlyContext(browser)
      const page = await context.newPage()
      const pageErrors: string[] = []
      const consoleErrors: string[] = []
      const failedResponses: string[] = []
      page.on('pageerror', (error) => pageErrors.push(error.message))
      page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
      page.on('response', (response) => { if (response.status() >= 500) failedResponses.push(`${response.status()} ${new URL(response.url()).pathname}`) })
      await page.setViewportSize({ width: viewport.width, height: viewport.height })

      for (const route of protectedRoutes) await assertReadOnlySurface(page, route.path, route.heading, failedResponses)

      const workspaceLinks = await page.locator('a[href^="/admin/workspaces/"]').evaluateAll((links) => links.map((link) => link.getAttribute('href')).filter((href): href is string => Boolean(href)))
      if (workspaceLinks.length > 0) await assertReadOnlySurface(page, workspaceLinks[0], '고객사', failedResponses)
      else await expect(page.getByText(/고객사 자료가 없습니다|확인 전|불러오지 못했습니다/u).first()).toBeVisible()

      expect(pageErrors).toEqual([])
      expect(consoleErrors).toEqual([])
      expect(failedResponses).toEqual([])
      await context.close()
    })
  }
})
