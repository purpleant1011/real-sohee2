import { expect, test, type Locator, type Page } from '@playwright/test'

const email = process.env.E2E_AUTH_EMAIL
const password = process.env.E2E_AUTH_PASSWORD
const liveFlowEnabled = process.env.E2E_V071_LIVE_FLOW === '1'

const viewports = [
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-820', width: 820, height: 1180 },
  { name: 'desktop-1440', width: 1440, height: 900 },
] as const

function parseCount(value: string | null) {
  const match = value?.match(/\d+/u)
  if (!match) throw new Error('work_count_unavailable')
  return Number(match[0])
}

async function signIn(page: Page) {
  await page.goto('/login?next=%2Fapp')
  await page.getByLabel('이메일').fill(email!)
  await page.getByLabel('비밀번호').fill(password!)
  await page.getByRole('button', { name: '이메일로 로그인' }).click()
  await expect(page).toHaveURL(/\/app(?:\/onboarding)?$/, { timeout: 30_000 })

  if (new URL(page.url()).pathname === '/app/onboarding') {
    await page.getByLabel('내 이름').fill('소희 V0.7.1 검증 운영자')
    await page.getByLabel('작업공간 이름').fill('소희 V0.7.1 검증')
    await page.getByRole('button', { name: '작업공간 시작하기' }).click()
    await expect(page).toHaveURL(/\/app$/, { timeout: 30_000 })
  }

  await expect(page.getByText('실제 대화 연결됨')).toBeVisible()
}

async function expectSafeResponsivePage(page: Page) {
  const metrics = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    visibleText: document.body.innerText,
  }))
  expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth)
  expect(metrics.visibleText).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu)
}

async function expectImagesLoaded(images: Locator, count: number) {
  await expect(images).toHaveCount(count)
  for (let index = 0; index < count; index += 1) {
    await images.nth(index).scrollIntoViewIfNeeded()
  }
  await expect.poll(async () => await images.evaluateAll((elements) => elements.every((element) =>
    element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0,
  )), { timeout: 30_000 }).toBe(true)
}

test.describe.configure({ mode: 'serial' })
test.use({ trace: 'off' })

for (const viewport of viewports) {
  test(`V0.7.1 actual review flow at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    test.skip(
      !email || !password || !liveFlowEnabled,
      '명시적으로 허용된 V0.7.1 실제 사용자 흐름 검증에서만 실행합니다.',
    )
    test.setTimeout(900_000)
    await page.setViewportSize({ width: viewport.width, height: viewport.height })

    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => consoleErrors.push(error.message))

    await signIn(page)
    await page.goto('/app/work')
    const countBefore = parseCount(
      await page.getByRole('link', { name: /^전체 \d+$/u }).textContent(),
    )

    await page.goto('/app')
    const resultCards = page.locator('article[aria-labelledby^="artifact-title-"]')
    const resultCountBefore = await resultCards.count()
    const verificationId = `V071-${viewport.width}-${Date.now()}`
    const request = [
      `검증 번호 ${verificationId}.`,
      '서울의 자연스러운 눈썹 상담을 안내하는 인스타그램 문안과 세로 이미지 두 장을 만들어 주세요.',
      '첫 장은 차분한 표지, 둘째 장은 상담 전 확인할 점을 떠올릴 수 있는 다른 구도이며 이미지 안에는 글자·가격·로고를 넣지 마세요.',
    ].join(' ')
    await page.getByLabel('소희에게 메시지 보내기').fill(request)
    await page.getByRole('button', { name: '메시지 보내기' }).click()

    await expect(page.getByLabel('내 메시지').getByText(request, { exact: true })).toBeVisible()
    const result = resultCards.nth(resultCountBefore)
    const providerFailure = page.getByRole('alert').filter({
      hasText: '응답을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    })
    const outcome = await Promise.race([
      expect(resultCards).toHaveCount(resultCountBefore + 1, { timeout: 600_000 })
        .then(() => 'result' as const),
      providerFailure.waitFor({ state: 'visible', timeout: 600_000 }).then(() => 'failure' as const),
    ])
    expect(outcome).toBe('result')
    await expectImagesLoaded(result.getByRole('img'), 2)
    await expect(result.getByText(/1번 · 표지/u)).toBeVisible()
    await expect(result.getByText(/2번 · 행동 유도/u)).toBeVisible()
    await expect(result.getByRole('heading', { name: '관찰' })).toBeVisible()
    await expect(result.getByRole('heading', { name: '해석의 한계' })).toBeVisible()
    await expect(result.getByRole('heading', { name: '사용한 근거' })).toBeVisible()
    await expect(result.getByRole('heading', { name: '확인이 필요한 항목' })).toBeVisible()
    await expectSafeResponsivePage(page)
    await page.screenshot({
      fullPage: true,
      path: `docs/verification/v0.7.1/screenshots/live-${viewport.name}-conversation.png`,
    })

    await result.getByRole('button', { name: '작업함에 저장' }).click()
    await expect(result.getByText('작업함 v1에 저장했어요.')).toBeVisible({ timeout: 30_000 })
    await result.getByRole('link', { name: '작업함에서 열기' }).click()

    await expect(page.getByText('현재 v1')).toBeVisible({ timeout: 30_000 })
    const versionHistory = page.locator('section[aria-labelledby="version-history-title"]')
    await expectImagesLoaded(versionHistory.getByRole('img'), 2)
    await expect(versionHistory.getByText(/1번 · 표지/u)).toBeVisible()
    await expect(versionHistory.getByText(/2번 · 행동 유도/u)).toBeVisible()
    await expect(versionHistory.getByText('사용권 확인됨').first()).toBeVisible()
    await expect(versionHistory.getByText('생성 근거 확인됨').first()).toBeVisible()

    const approval = page.locator('section[aria-labelledby="approval-title"]')
    await expect(approval.getByRole('heading', { name: '최종 승인' })).toBeVisible()
    await expect(approval.getByText('v1', { exact: true })).toBeVisible()
    await approval.getByLabel('본문·해시태그·고지를 최종 확인했습니다.').check()
    await approval.getByLabel('실제 이미지와 순서를 최종 확인했습니다.').check()
    await approval.getByLabel('대체 텍스트를 최종 확인했습니다.').check()
    await approval.getByLabel('사용권과 생성 근거를 최종 확인했습니다.').check()
    await approval.getByLabel('확인이 필요한 항목을 검토했습니다.').check()
    await approval.getByLabel('검토 사유').fill(`출시 게이트 확인 ${verificationId}`)
    await expect(approval.getByRole('button', { name: 'v1 최종 승인' })).toBeEnabled()
    await expectSafeResponsivePage(page)
    await page.screenshot({
      fullPage: true,
      path: `docs/verification/v0.7.1/screenshots/live-${viewport.name}-work-v1.png`,
    })

    await page.reload()
    await expect(page.getByText('현재 v1')).toBeVisible({ timeout: 30_000 })
    await expectImagesLoaded(
      page.locator('section[aria-labelledby="version-history-title"]').getByRole('img'),
      2,
    )

    await page.goto('/app/work')
    const countAfter = parseCount(
      await page.getByRole('link', { name: /^전체 \d+$/u }).textContent(),
    )
    expect(countAfter).toBe(countBefore + 1)

    await page.goto('/app/settings/business')
    const businessName = page.getByLabel('사업명')
    const originalBusinessName = await businessName.inputValue()
    await businessName.fill(`${originalBusinessName} 임시 변경`)
    await page.getByRole('button', { name: '변경 취소' }).click()
    await expect(businessName).toHaveValue(originalBusinessName)
    if (originalBusinessName.length === 0) {
      await businessName.fill('바이름 검증 작업공간')
    }
    await page.getByRole('button', { name: '사업 정보 저장' }).click()
    await expect(page.getByRole('status')).toHaveText('사업 정보를 저장했어요.')

    await page.goto('/app/settings/brand')
    await page.getByRole('button', { name: '브랜드 기준 저장' }).click()
    await expect(page.getByRole('status')).toHaveText('브랜드 기준을 저장했어요.')

    await page.goto('/app/settings/channels')
    await page.getByRole('button', { name: '채널 상태 저장' }).first().click()
    await expect(page.getByRole('status').first()).toHaveText('채널 상태를 저장했어요.')

    await page.goto('/app/settings/members')
    await page.getByRole('button', { name: '멤버 권한 저장' }).first().click()
    await expect(page.getByRole('status').first()).toHaveText('멤버 권한을 저장했어요.')

    await page.goto('/app/notifications')
    await expect(page.getByRole('heading', { name: '알림', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '알림 설정 저장' }).click()
    await expect(page.getByRole('status')).toHaveText('알림 설정을 저장했습니다.')
    await expectSafeResponsivePage(page)

    expect(consoleErrors).toEqual([])
  })
}
