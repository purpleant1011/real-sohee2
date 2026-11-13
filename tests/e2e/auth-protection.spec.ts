import { expect, test } from '@playwright/test'

test('redirects an unauthenticated protected route to login with its internal next path', async ({
  page,
}) => {
  await page.goto('/app/work')

  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fwork$/)
  await expect(page.getByRole('heading', { name: '로그인' })).toBeVisible()
})

test('preserves a normal encoded query in the protected return path', async ({ page }) => {
  await page.setExtraHTTPHeaders({
    'x-sohee-pathname': '/app/forged',
  })
  await page.goto('/app/work?sort=latest&search=%EC%86%8C%ED%9D%AC')

  await expect(page).toHaveURL(
    /\/login\?next=%2Fapp%2Fwork%3Fsort%3Dlatest%26search%3D%25EC%2586%258C%25ED%259D%25AC$/,
  )
})
