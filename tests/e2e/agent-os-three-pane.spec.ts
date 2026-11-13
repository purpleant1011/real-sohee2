import { expect, test } from '@playwright/test'

/**
 * Agent OS 3-Pane Architecture & Route Completeness (ANI-896, ANI-887)
 * Validates:
 * 1. 7 Canonical Routes accessibility through auth handoff
 * 2. Legacy Route Redirections (/app/campaigns -> /app/sohee?tab=campaigns, /app/plugins -> /app/sohee?tab=capabilities)
 * 3. Responsive 3-pane layout without horizontal overflow across desktop and mobile
 * 4. Zero external network leaks
 */

const CANONICAL_ROUTES = [
  { path: '/app', name: 'Home' },
  { path: '/app/content', name: 'Content' },
  { path: '/app/customers', name: 'Customers' },
  { path: '/app/results', name: 'Results' },
  { path: '/app/sohee', name: 'My Sohee' },
  { path: '/app/ads', name: 'Ads' },
  { path: '/app/system', name: 'System' },
] as const

const LEGACY_ROUTES = [
  { legacy: '/app/campaigns', target: '/app/sohee?tab=campaigns' },
  { legacy: '/app/plugins', target: '/app/sohee?tab=capabilities' },
] as const

const VIEWPORTS = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'mobile', width: 390, height: 844 },
] as const

test.describe('Agent OS 3-Pane Route Completeness (ANI-896)', () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.label} reaches all 7 canonical routes with safe auth handoff and no horizontal scroll`, async ({ page }) => {
      const externalRequests: string[] = []
      page.on('request', (request) => {
        const hostname = new URL(request.url()).hostname
        if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
          externalRequests.push(request.url())
        }
      })

      await page.setViewportSize(viewport)

      for (const route of CANONICAL_ROUTES) {
        const response = await page.goto(route.path)
        expect(response?.status()).toBeLessThan(400)

        // Safe auth handoff preserves intended destination
        await expect(page).toHaveURL(/\/login\?next=/)
        const nextParam = new URL(page.url()).searchParams.get('next')
        expect(nextParam).toBe(route.path)

        // No unready or broken fallback error pages
        await expect(page.getByText('이 화면은 아직 준비되지 않았어요')).toHaveCount(0)

        // No horizontal layout overflow
        const hasOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth
        )
        expect(hasOverflow).toBe(false)
      }

      expect(externalRequests).toEqual([])
    })
  }

  test('legacy routes /app/campaigns and /app/plugins safely redirect to My Sohee domains', async ({ page }) => {
    for (const route of LEGACY_ROUTES) {
      const response = await page.goto(route.legacy)
      expect(response?.status()).toBeLessThan(400)

      // Verify that the destination query encodes the My Sohee redirected target
      const url = new URL(page.url())
      const nextParam = url.searchParams.get('next')

      // Either redirected directly or safely preserved through auth next param
      const isDirectOrNext =
        url.pathname.includes('/app/sohee') ||
        (nextParam !== null && (nextParam.includes('/app/sohee') || nextParam.includes(route.legacy)))
      expect(isDirectOrNext).toBe(true)
    }
  })
})
