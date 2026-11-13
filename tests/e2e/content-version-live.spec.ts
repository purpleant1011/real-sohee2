import { expect, test } from '@playwright/test'

const email = process.env.E2E_AUTH_EMAIL
const password = process.env.E2E_AUTH_PASSWORD
const fixtureContentId = '80000000-0000-4000-8000-000000000001'

test('creates v1 and v2 without overwriting the first actual database version', async ({ page }) => {
  test.skip(!email || !password, '실제 Supabase Auth 테스트 계정이 설정된 환경에서 실행합니다.')

  await page.goto(`/login?next=${encodeURIComponent(`/app/work/${fixtureContentId}/edit`)}`)
  await page.getByLabel('이메일').fill(email!)
  await page.getByLabel('비밀번호').fill(password!)
  await page.getByRole('button', { name: '이메일로 로그인' }).click()
  await expect(page).toHaveURL(new RegExp(`/app/work/${fixtureContentId}/edit$`))

  await expect(page.getByRole('heading', { name: '첫 버전 만들기' })).toBeVisible()
  await page.getByLabel('본문 문구').fill('첫 번째 실제 보존 문구')
  await page.getByLabel('해시태그').fill('#실제검증 #첫버전')
  await page.getByLabel('필수 고지').fill('모의 생성 콘텐츠를 사용한 실제 DB 검증입니다.')
  await page.getByLabel('수정 이유').fill('첫 버전으로 내용을 기록했어요.')
  await page.getByLabel(/PNG · 8 B/).check()
  await page.getByLabel('미디어 사용권을 확인했습니다.').check()
  await page.getByLabel('생성 과정과 근거를 확인했습니다.').check()
  await page.getByRole('button', { name: '새 버전으로 저장' }).click()

  await expect(page).toHaveURL(new RegExp(`/app/work/${fixtureContentId}$`))
  await expect(page.getByRole('heading', { name: '현재 v1' })).toBeVisible()
  await expect(page.getByText('첫 번째 실제 보존 문구')).toBeVisible()

  await page.getByRole('link', { name: '새 버전 만들기' }).click()
  await expect(page.getByRole('heading', { name: '현재 v1에서 새 버전 만들기' })).toBeVisible()
  await page.getByLabel('본문 문구').fill('두 번째 실제 최신 문구')
  await page.getByLabel('수정 이유').fill('문구를 더 명확하게 다듬었어요.')
  await page.getByLabel(/PNG · 8 B/).check()
  await page.getByLabel('미디어 사용권을 확인했습니다.').check()
  await page.getByLabel('생성 과정과 근거를 확인했습니다.').check()
  await page.getByRole('button', { name: '새 버전으로 저장' }).click()

  await expect(page.getByRole('heading', { name: '현재 v2' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '이전 v1' })).toBeVisible()
  await expect(page.getByText('두 번째 실제 최신 문구')).toBeVisible()
  await expect(page.getByText('첫 번째 실제 보존 문구')).toBeVisible()
  await expect(page.getByText('변경 이유: 문구를 더 명확하게 다듬었어요.')).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  const decisionArea = page.getByRole('region', { name: '콘텐츠 결정 영역' })
  const mobileNav = page.locator('[data-mobile-nav]')
  await expect(decisionArea).toBeVisible()
  await expect(mobileNav).toBeVisible()
  const decisionBox = await decisionArea.boundingBox()
  const navigationBox = await mobileNav.boundingBox()
  expect(decisionBox).not.toBeNull()
  expect(navigationBox).not.toBeNull()
  expect(decisionBox!.y + decisionBox!.height).toBeLessThanOrEqual(navigationBox!.y + 1)
})
