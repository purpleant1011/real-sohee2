import { expect, test } from '@playwright/test'
import {
  attachRuntimeProbe,
  blockExternalOrigins,
  expectAxeClean,
  expectNoHorizontalOverflow,
  expectNoInternalLeak,
  expectTouchTargets,
  expectViewportMeta,
} from './support/gates'
import { saveJson, saveScreenshot } from './support/evidence'
import { mobileGateRoutes } from './support/routes'

/**
 * 레지스트리의 모든 모바일 화면에 공통 게이트를 적용한다.
 * 320/360/375/390/430 × iOS(WebKit)/Android(Chromium) 10개 프로젝트에서 실행된다.
 * (tablet/desktop 폭 프로젝트는 .desktop.spec.ts 전용이라 이 파일은 실행되지 않는다.)
 * 인증 필요 화면은 MOBILE_R2_STORAGE_STATE 가 있을 때만 실행(없으면 skip, "미검증"으로 보고).
 */
const storageState = process.env.MOBILE_R2_STORAGE_STATE

interface GateOutcome {
  gate: string
  status: 'pass' | 'fail'
  detail?: string
}

for (const route of mobileGateRoutes()) {
  test.describe(`${route.id} (${route.mode})`, () => {
    if (route.auth && storageState) test.use({ storageState })

    test(`공통 게이트: ${route.path}`, async ({ page, baseURL }, info) => {
      test.skip(route.status === 'planned', `${route.id}: 구현 전 (planned) — ${route.issue}`)
      test.skip(route.auth && !storageState, `${route.id}: 인증 세션 없음 — MOBILE_R2_STORAGE_STATE 필요`)

      const probe = attachRuntimeProbe(page)
      const blocked = await blockExternalOrigins(page, new URL(baseURL!).origin)

      // 진입 자체(HTTP/메인 렌더)는 게이트가 아니라 전제 조건이므로 즉시 실패시킨다.
      const res = await page.goto(route.path, { waitUntil: 'networkidle' })
      if (route.devOnly && res?.status() === 404) {
        // 운영 빌드에는 없는 개발 전용 라우트. 404 를 통과로 치환하지 않고 "미검증"으로 남긴다.
        test.skip(true, `${route.id}: 개발 서버 필요 (운영 빌드 404, 미검증) — ${route.issue}`)
      }
      expect(res?.status(), `${route.path} HTTP 상태`).toBeLessThan(400)
      await expect(page.locator('main, [role=main]').first()).toBeVisible()

      // 게이트는 서로 독립적으로 실행해 한 화면의 결함을 한 번에 전부 드러낸다.
      // (첫 실패에서 멈추면 나머지 게이트 결과가 사라져 QA 증거로 쓸 수 없다.)
      const outcomes: GateOutcome[] = []
      const gate = async (name: string, fn: () => void | Promise<void>): Promise<void> => {
        try {
          await fn()
          outcomes.push({ gate: name, status: 'pass' })
        } catch (error) {
          outcomes.push({ gate: name, status: 'fail', detail: (error as Error).message })
        }
      }

      await gate('viewport-meta', () => expectViewportMeta(page, { requireCover: route.mode !== 'PUBLIC' }))
      await gate('horizontal-overflow', () => expectNoHorizontalOverflow(page))
      await gate('touch-targets', () => expectTouchTargets(page))
      await gate('internal-leak', () => expectNoInternalLeak(page))
      await gate('axe-wcag22aa', () => expectAxeClean(page))

      const nav = page.getByRole('navigation', { name: /소희 업무 메뉴|하단/u })
      if (route.bottomNav === 'required') await gate('bottom-nav-required', () => expect(nav).toBeVisible())
      if (route.bottomNav === 'forbidden') await gate('bottom-nav-forbidden', () => expect(nav).toHaveCount(0))

      // 진입만으로 쓰기·페이지 오류·콘솔 오류·외부 호출이 없어야 한다.
      await gate('no-writes', () => expect(probe.writes, '조회 화면 진입 시 쓰기 요청').toEqual([]))
      await gate('no-pageerror', () => expect(probe.pageErrors, 'pageerror').toEqual([]))
      await gate('no-console-error', () => expect(probe.consoleErrors, 'console.error').toEqual([]))
      await gate('no-external-calls', () => expect(blocked, '앱 오리진 밖 호출').toEqual([]))

      const metrics = {
        route: route.path,
        mode: route.mode,
        failedRequests: probe.failedRequests,
        scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth),
        outcomes,
      }
      // 실행마다 게이트 전체 결과를 리포트에 첨부한다 (실패 시에도 보존).
      await info.attach('gate-results', {
        body: JSON.stringify({ project: info.project.name, ...metrics }, null, 2),
        contentType: 'application/json',
      })
      await saveScreenshot(page, info, route.issue, route.id)
      saveJson(info, route.issue, `${route.id}-metrics`, metrics)

      const failures = outcomes.filter((o) => o.status === 'fail')
      expect(
        failures.map((f) => `${f.gate}: ${f.detail}`),
        `게이트 실패 ${failures.length}/${outcomes.length}건 (${route.path})`,
      ).toEqual([])
    })
  })
}
