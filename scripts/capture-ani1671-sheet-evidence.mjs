// ANI-1671 content-hub Sheet 접근성 계약 증거 캡처.
// 사용: dev 서버를 :3111에 띄운 뒤
//   EVIDENCE_BASE_URL=http://127.0.0.1:3111 node scripts/capture-ani1671-sheet-evidence.mjs
// 결과: evidence/mobile-r2/ANI-1671/sheet-flow-*.png + sheet-flow-verification.json
import { chromium } from 'playwright'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const BASE_URL = process.env.EVIDENCE_BASE_URL ?? 'http://127.0.0.1:3111'
const ROUTE = '/dev/content-hub-stability'
const OUT_DIR = path.resolve('evidence/mobile-r2/ANI-1671')
const VIEWPORTS = [
  { width: 320, height: 812 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]

const results = []

function log(step, detail) {
  console.log(`[evidence] ${step}: ${JSON.stringify(detail)}`)
}

async function waitForServer(url, timeoutMs = 180000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.status < 500) return
    } catch {}
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error(`server not ready: ${url}`)
}

async function snapshotState(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[data-slot="sheet-content"]')
    const body = document.body
    return {
      dialogPresent: Boolean(dialog),
      dialogRole: dialog?.getAttribute('role') ?? null,
      dialogLabel: dialog?.getAttribute('aria-labelledby') ? document.getElementById(dialog.getAttribute('aria-labelledby'))?.textContent ?? null : null,
      focusInsideDialog: dialog ? dialog.contains(document.activeElement) : false,
      activeElement: document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.slice(0, 40) || document.activeElement?.tagName,
      bodyInlineOverflow: body.style.overflow || '(unset)',
      bodyComputedOverflow: getComputedStyle(body).overflow,
      bodyInlinePointerEvents: body.style.pointerEvents || '(unset)',
      htmlOverflow: getComputedStyle(document.documentElement).overflow,
      scrollY: window.scrollY,
    }
  })
}

const browser = await chromium.launch()
try {
  await waitForServer(BASE_URL + ROUTE)
  await fs.mkdir(OUT_DIR, { recursive: true })

  for (const viewport of VIEWPORTS) {
    const page = await browser.newPage({ viewport })
    try {
      await page.goto(BASE_URL + ROUTE, { waitUntil: 'domcontentloaded', timeout: 120000 })
      const trigger = page.getByRole('button', { name: /1:1 맞춤 공간/ })
      await trigger.waitFor({ state: 'visible', timeout: 120000 })
      // let the client bundle hydrate and list fetch settle
      await page.waitForTimeout(1500)

      const before = await snapshotState(page)

      // --- open ---
      await trigger.click()
      const dialog = page.locator('[data-slot="sheet-content"]')
      await dialog.waitFor({ state: 'visible', timeout: 15000 })
      await page.waitForTimeout(400)
      const opened = await snapshotState(page)
      await page.screenshot({ path: path.join(OUT_DIR, `sheet-flow-open-${viewport.width}.png`) })

      // --- focus trap: Tab three times must stay inside ---
      const tabTrace = []
      for (let i = 0; i < 3; i += 1) {
        await page.keyboard.press('Tab')
        const state = await page.evaluate(() => {
          const d = document.querySelector('[data-slot="sheet-content"]')
          return {
            inside: d ? d.contains(document.activeElement) : false,
            active: document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.slice(0, 40) || document.activeElement?.tagName,
          }
        })
        tabTrace.push(state)
      }

      // --- Escape closes and returns focus ---
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached', timeout: 15000 })
      await page.waitForTimeout(400)
      const afterEscape = await snapshotState(page)
      const focusReturned = await trigger.evaluate(el => el === document.activeElement)
      await page.screenshot({ path: path.join(OUT_DIR, `sheet-flow-closed-esc-${viewport.width}.png`) })

      // --- reopen and close via panel close button ---
      await trigger.click()
      await dialog.waitFor({ state: 'visible', timeout: 15000 })
      await page.waitForTimeout(400)
      const reopened = await snapshotState(page)
      const closeButton = page.getByRole('button', { name: '패널 닫기' })
      await closeButton.click()
      await dialog.waitFor({ state: 'detached', timeout: 15000 })
      await page.waitForTimeout(400)
      const afterCloseButton = await snapshotState(page)
      const focusReturnedAfterButton = await trigger.evaluate(el => el === document.activeElement)
      await page.screenshot({ path: path.join(OUT_DIR, `sheet-flow-closed-button-${viewport.width}.png`) })

      // --- opener variant: header entry button ---
      const headerButton = page.getByRole('button', { name: '네이버 글쓰기' })
      await headerButton.click()
      await dialog.waitFor({ state: 'visible', timeout: 15000 })
      await page.waitForTimeout(400)
      const headerOpened = await snapshotState(page)
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached', timeout: 15000 })
      await page.waitForTimeout(400)
      const focusReturnedToHeaderButton = await headerButton.evaluate(el => el === document.activeElement)

      // --- opener variant: deep link (?panel=naver) uses the header button as fallback ---
      await page.goto(BASE_URL + ROUTE + '?panel=naver', { waitUntil: 'domcontentloaded', timeout: 120000 })
      await dialog.waitFor({ state: 'visible', timeout: 15000 })
      await page.waitForTimeout(400)
      const deepLinkOpened = await snapshotState(page)
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached', timeout: 15000 })
      await page.waitForTimeout(400)
      const focusReturnedAfterDeepLink = await headerButton.evaluate(el => el === document.activeElement)
      await page.screenshot({ path: path.join(OUT_DIR, `sheet-flow-closed-deeplink-${viewport.width}.png`) })

      const entry = {
        viewport,
        before,
        opened,
        tabTrace,
        afterEscape,
        focusReturnedAfterEscape: focusReturned,
        reopened,
        afterCloseButton,
        focusReturnedAfterCloseButton: focusReturnedAfterButton,
        headerButtonFlow: {
          opened: headerOpened,
          focusReturned: focusReturnedToHeaderButton,
        },
        deepLinkFlow: {
          opened: deepLinkOpened,
          focusReturnedAfterClose: focusReturnedAfterDeepLink,
        },
        checks: {
          dialogOpens: opened.dialogPresent,
          dialogHasAccessibleName: Boolean(opened.dialogLabel),
          focusMovesInside: opened.focusInsideDialog,
          scrollLockedWhileOpen: opened.bodyInlineOverflow === 'hidden' || opened.bodyComputedOverflow === 'hidden',
          tabStaysInside: tabTrace.every(t => t.inside),
          escapeCloses: !afterEscape.dialogPresent,
          focusReturnsAfterEscape: focusReturned,
          scrollUnlockedAfterClose: afterEscape.bodyInlineOverflow !== 'hidden' && afterEscape.bodyComputedOverflow !== 'hidden',
          reopenWorks: reopened.dialogPresent,
          closeButtonCloses: !afterCloseButton.dialogPresent,
          focusReturnsAfterCloseButton: focusReturnedAfterButton,
          headerButtonOpens: headerOpened.dialogPresent && headerOpened.focusInsideDialog,
          focusReturnsToHeaderButton: focusReturnedToHeaderButton,
          deepLinkOpens: deepLinkOpened.dialogPresent && deepLinkOpened.focusInsideDialog,
          deepLinkFocusReturnsToHeaderButton: focusReturnedAfterDeepLink,
        },
      }
      results.push(entry)
      log(`viewport-${viewport.width}`, entry.checks)
    } finally {
      await page.close()
    }
  }
} finally {
  await browser.close()
}

const report = {
  issue: 'ANI-1671',
  route: ROUTE,
  capturedAt: new Date().toISOString(),
  flow: 'content-hub Sheet: open → focus in → scroll lock → Tab trap → Escape close → focus return → reopen → close button → focus return → header-button opener → deep link (?panel=naver) fallback opener',
  viewports: results,
  allPassed: results.every(r => Object.values(r.checks).every(Boolean)),
}
await fs.writeFile(path.join(OUT_DIR, 'sheet-flow-verification.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ allPassed: report.allPassed, viewports: results.map(r => r.viewport.width) }))
