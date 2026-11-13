import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const PORT = 3009;
const BASE_URL = `http://localhost:${PORT}`;
const OUTPUT_DIR = path.resolve('docs/evidence/v091-first-revision/visual');

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'laptop-1024', width: 1024, height: 768 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'mobile-375', width: 375, height: 812 },
];

const TARGET_ROUTES = [
  { path: '/login', label: 'login' },
  { path: '/signup', label: 'signup' },
  { path: '/onboarding', label: 'onboarding-root' },
  { path: '/onboarding/business', label: 'onboarding-business' },
  { path: '/onboarding/channels', label: 'onboarding-channels' },
  { path: '/onboarding/knowledge', label: 'onboarding-knowledge' },
  { path: '/onboarding/text-harness', label: 'onboarding-text-harness' },
  { path: '/onboarding/image-harness', label: 'onboarding-image-harness' },
  { path: '/onboarding/policy', label: 'onboarding-policy' },
];

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404 || res.status === 307 || res.status === 302) {
        return true;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server failed to start at ${url} within ${timeoutMs}ms`);
}

async function run() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  console.log(`Starting Next.js server on port ${PORT}...`);
  const server = spawn('npx', ['next', 'dev', '-p', String(PORT)], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });

  try {
    await waitForServer(`${BASE_URL}/login`);
    console.log(`Server is ready at ${BASE_URL}`);

    const browser = await chromium.launch({ headless: true });
    const auditResults = [];

    for (const vp of VIEWPORTS) {
      console.log(`\n📸 Capturing viewport: ${vp.name} (${vp.width}x${vp.height})...`);
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();

      for (const route of TARGET_ROUTES) {
        const targetUrl = `${BASE_URL}${route.path}`;
        try {
          const res = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await page.waitForTimeout(500);

          const metrics = await page.evaluate(() => {
            const doc = document.documentElement;
            const body = document.body;
            const scrollWidth = Math.max(doc.scrollWidth, body.scrollWidth);
            const clientWidth = window.innerWidth;
            const hasHorizontalOverflow = scrollWidth > clientWidth;
            return {
              scrollWidth,
              clientWidth,
              hasHorizontalOverflow,
              overflowPixels: hasHorizontalOverflow ? scrollWidth - clientWidth : 0,
            };
          });

          const filename = `${route.label}-${vp.name}.png`;
          const filePath = path.join(OUTPUT_DIR, filename);
          await page.screenshot({ path: filePath, fullPage: false });

          auditResults.push({
            route: route.path,
            label: route.label,
            viewport: vp.name,
            width: vp.width,
            height: vp.height,
            httpStatus: res ? res.status() : 200,
            hasHorizontalOverflow: metrics.hasHorizontalOverflow,
            overflowPixels: metrics.overflowPixels,
            screenshot: filename,
            status: metrics.hasHorizontalOverflow ? 'FAIL_OVERFLOW' : 'PASS',
          });

          console.log(`  [${vp.name}] ${route.path} -> ${metrics.hasHorizontalOverflow ? '❌ OVERFLOW' : '✅ PASS'} (${filename})`);
        } catch (err) {
          console.warn(`  [${vp.name}] ${route.path} -> ⚠️ Navigation error: ${err.message}`);
          auditResults.push({
            route: route.path,
            label: route.label,
            viewport: vp.name,
            width: vp.width,
            height: vp.height,
            httpStatus: 500,
            hasHorizontalOverflow: false,
            overflowPixels: 0,
            screenshot: null,
            status: 'ERROR',
            error: err.message,
          });
        }
      }
      await context.close();
    }

    await browser.close();

    const reportPath = path.resolve('docs/evidence/v091-first-revision/responsive-audit-report.json');
    const summary = {
      evaluatedAt: new Date().toISOString(),
      totalChecks: auditResults.length,
      passedChecks: auditResults.filter((r) => r.status === 'PASS').length,
      overflowFailures: auditResults.filter((r) => r.status === 'FAIL_OVERFLOW').length,
      errorFailures: auditResults.filter((r) => r.status === 'ERROR').length,
      viewports: VIEWPORTS.map((v) => `${v.name} (${v.width}x${v.height})`),
      results: auditResults,
    };

    await fs.writeFile(reportPath, JSON.stringify(summary, null, 2), 'utf-8');
    console.log(`\nAudit Report saved to: ${reportPath}`);
    console.log(`Summary: ${summary.passedChecks}/${summary.totalChecks} PASSED, ${summary.overflowFailures} Overflows.`);
  } finally {
    server.kill('SIGTERM');
  }
}

run().catch((err) => {
  console.error('Fatal audit error:', err);
  process.exit(1);
});
