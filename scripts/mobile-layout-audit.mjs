/**
 * scripts/mobile-layout-audit.mjs
 *
 * 모바일 전 화면 레이아웃 무결성 전수 점검 스크립트 (320 / 360 / 390 / 430px)
 *
 * 사용법:
 * 1. 로컬 개발 서버 기동:
 *    env SOHEE_LOCAL_E2E=1 NEXT_PUBLIC_SOHEE_LOCAL_E2E=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_local_fixture_only npm run dev -- --webpack --port 3197
 * 2. ego-browser 로 스크립트 실행:
 *    ego-browser nodejs < scripts/mobile-layout-audit.mjs
 *
 * 검사 항목:
 * (a) documentElement.scrollWidth > innerWidth (가로 넘침 / 불필요 가로 스크롤)
 * (b) rect.right > innerWidth + 1 인 요소 (화면 밖 삐져나옴)
 * (c) 텍스트 길이 >= 4자인데 폭 < 38px, 높이 > 40px (세로 쪼개짐 현상)
 * (d) 터치 대상(button, a, [role=button], input) 크기 < 44x44
 * (e) position:fixed 요소끼리 또는 하단 탭바와 겹침
 * (f) accessible name 이 없는 아이콘 버튼
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const PORT = process.env.PORT || 3197;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SCREENSHOT_DIR = '/tmp/sohee-audit/SWEEP';
const WIDTHS = [320, 360, 390, 430];

// 단독 하네스 URL 목록
const HARNESS_PATHS = [
  '/dev/mobile-r2/states',
  '/dev/mobile-r2/today-layout',
  '/dev/mobile-r2/work-list-wiring',
  '/dev/mobile-r2/customers-list',
  '/dev/mobile-r2/customers-detail',
  '/dev/mobile-r2/results-range',
  '/dev/mobile-r2/evidence-list',
  '/dev/mobile-r2/inbox-wiring?r2=1',
  '/dev/mobile-r2/channels-wiring',
  '/dev/mobile-r2/approval-card',
  '/dev/mobile-r2/post-approval',
  '/dev/mobile-r2/publish-status',
  '/dev/mobile-r2/memory-decisions',
  '/dev/mobile-r2/booking-timeline',
  '/dev/mobile-r2/campaigns-wiring',
  '/dev/mobile-r2/start-approve',
  '/dev/mobile-r2/work-preview',
  '/dev/mobile-r2/tab-read-wiring?tab=customers',
  '/dev/mobile-r2/common-error',
  '/dev/mobile-r2/detail-cta',
  '/dev/mobile-r2/ledger-wiring?r2=1',
  '/dev/photo-post-mobile',
];

// /dev/mobile-r2/app 내 5개 탭 및 하위 화면 목록
const APP_SCREENS = [
  { id: 'app:today', tab: 'today', screen: 'today', title: '오늘' },
  { id: 'app:work', tab: 'work', screen: 'work', title: '작업' },
  { id: 'app:work/list', tab: 'work', screen: 'work/list', title: '작업 목록' },
  { id: 'app:work/notifications', tab: 'work', screen: 'work/notifications', title: '알림함' },
  { id: 'app:work/campaigns', tab: 'work', screen: 'work/campaigns', title: '캠페인 제안' },
  { id: 'app:customers', tab: 'customers', screen: 'customers', title: '고객' },
  { id: 'app:customers/list', tab: 'customers', screen: 'customers/list', title: '고객 목록' },
  { id: 'app:customers/detail', tab: 'customers', screen: 'customers/detail', title: '고객 상세' },
  { id: 'app:customers/inbox', tab: 'customers', screen: 'customers/inbox', title: '소통함' },
  { id: 'app:customers/ledger', tab: 'customers', screen: 'customers/ledger', title: '예약표' },
  { id: 'app:results', tab: 'results', screen: 'results', title: '성과' },
  { id: 'app:more', tab: 'more', screen: 'more', title: '더보기' },
  { id: 'app:more/channels', tab: 'more', screen: 'more/channels', title: '채널' },
  { id: 'app:more/credit', tab: 'more', screen: 'more/credit', title: '크레딧' },
  { id: 'app:more/memory', tab: 'more', screen: 'more/memory', title: '가게 기억' },
  { id: 'app:more/settings', tab: 'more', screen: 'more/settings', title: '설정' },
];

/** 브라우저 내부에서 실행되는 무결성 검사 함수 */
function runIntegrityAudit() {
  const innerWidth = window.innerWidth;
  const scrollWidth = document.documentElement.scrollWidth;

  // (a) documentElement 가로 넘침 여부
  const hasDocHScroll = scrollWidth > innerWidth + 1;

  function isVisible(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isSrOnly(el) {
    if (el.classList?.contains('sr-only') || el.closest('.sr-only')) return true;
    const style = window.getComputedStyle(el);
    if (style.position === 'absolute' && (rectWidth(el) <= 1 || rectHeight(el) <= 1)) return true;
    return false;
  }

  function rectWidth(el) {
    return el.getBoundingClientRect().width;
  }
  function rectHeight(el) {
    return el.getBoundingClientRect().height;
  }

  function getSelector(el) {
    if (!el) return '';
    let sel = el.tagName.toLowerCase();
    if (el.id) return `#${el.id}`;
    if (el.getAttribute('data-screen')) return `[data-screen="${el.getAttribute('data-screen')}"]`;
    if (el.getAttribute('aria-label')) return `${sel}[aria-label="${el.getAttribute('aria-label')}"]`;
    if (el.classList?.length) {
      const cls = Array.from(el.classList).slice(0, 2).join('.');
      sel += `.${cls}`;
    }
    return sel;
  }

  // (b) 우측으로 삐져나간 요소 (수평 스크롤 컨테이너 내부 요소 제외)
  const overflowingElements = [];
  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    if (el === document.documentElement || el === document.body) continue;
    if (!isVisible(el)) continue;

    let parent = el.parentElement;
    let inHScroll = false;
    while (parent && parent !== document.body && parent !== document.documentElement) {
      const style = window.getComputedStyle(parent);
      if (style.overflowX === 'auto' || style.overflowX === 'scroll') {
        inHScroll = true;
        break;
      }
      parent = parent.parentElement;
    }
    if (inHScroll) continue;

    const rect = el.getBoundingClientRect();
    if (rect.right > innerWidth + 1) {
      overflowingElements.push({
        tag: el.tagName.toLowerCase(),
        selector: getSelector(el),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        text: (el.textContent || '').trim().slice(0, 30),
      });
    }
  }

  // (c) 텍스트 세로 쪼개짐 (글자수 >= 4인데 폭 < 38px && 높이 > 40px)
  const verticalSplitElements = [];
  for (const el of allElements) {
    if (!isVisible(el)) continue;
    const text = (el.innerText || el.textContent || '').trim();
    if (text.length >= 4) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 38 && rect.height > 40) {
        verticalSplitElements.push({
          tag: el.tagName.toLowerCase(),
          selector: getSelector(el),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          text: text.slice(0, 30),
        });
      }
    }
  }

  // (d) 터치 대상 < 44x44
  const smallTouchTargets = [];
  const touchCandidates = document.querySelectorAll('button, a[href], [role="button"], input:not([type="hidden"])');
  for (const el of touchCandidates) {
    if (!isVisible(el)) continue;
    if (isSrOnly(el)) continue;

    // 체크박스인 경우 부모 label의 크기가 44x44 이상이면 터치 영역 만족
    if (el.tagName.toLowerCase() === 'input' && el.getAttribute('type') === 'checkbox') {
      const parentLabel = el.closest('label');
      if (parentLabel && isVisible(parentLabel)) {
        const lRect = parentLabel.getBoundingClientRect();
        if (lRect.width >= 43.5 && lRect.height >= 43.5) continue;
      }
    }

    const rect = el.getBoundingClientRect();
    if (rect.width < 43.5 || rect.height < 43.5) {
      smallTouchTargets.push({
        tag: el.tagName.toLowerCase(),
        selector: getSelector(el),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        text: (el.textContent || el.getAttribute('aria-label') || el.getAttribute('value') || '').trim().slice(0, 30),
      });
    }
  }

  // (e) position:fixed 요소끼리 또는 하단 탭과 겹침
  const fixedOverlaps = [];
  const fixedElements = [];
  for (const el of allElements) {
    if (!isVisible(el)) continue;
    const style = window.getComputedStyle(el);
    if (style.position === 'fixed') {
      if (style.pointerEvents === 'none') continue;
      fixedElements.push({ el, rect: el.getBoundingClientRect() });
    }
  }

  const bottomTabbar = document.querySelector('nav[aria-label="소희 업무 메뉴"], [data-mobile-tabbar]');
  const bottomRect = bottomTabbar && isVisible(bottomTabbar) ? bottomTabbar.getBoundingClientRect() : null;

  for (let i = 0; i < fixedElements.length; i++) {
    for (let j = i + 1; j < fixedElements.length; j++) {
      const a = fixedElements[i];
      const b = fixedElements[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ox = Math.max(0, Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left));
      const oy = Math.max(0, Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top));
      if (ox > 10 && oy > 10) {
        fixedOverlaps.push({
          type: 'fixed-fixed',
          elA: getSelector(a.el),
          elB: getSelector(b.el),
          overlap: `${Math.round(ox)}x${Math.round(oy)}`,
        });
      }
    }
    if (bottomRect && !fixedElements[i].el.contains(bottomTabbar) && !bottomTabbar.contains(fixedElements[i].el)) {
      const a = fixedElements[i];
      const ox = Math.max(0, Math.min(a.rect.right, bottomRect.right) - Math.max(a.rect.left, bottomRect.left));
      const oy = Math.max(0, Math.min(a.rect.bottom, bottomRect.bottom) - Math.max(a.rect.top, bottomRect.top));
      if (ox > 20 && oy > 10) {
        fixedOverlaps.push({
          type: 'fixed-tabbar',
          el: getSelector(a.el),
          overlap: `${Math.round(ox)}x${Math.round(oy)}`,
        });
      }
    }
  }

  // (f) 이름 없는 아이콘 버튼
  const unnamedIconButtons = [];
  const iconCandidates = document.querySelectorAll('button, a[href], [role="button"]');
  for (const el of iconCandidates) {
    if (!isVisible(el)) continue;
    if (isSrOnly(el)) continue;
    const hasAria = (el.getAttribute('aria-label') || '').trim().length > 0;
    const hasLabelledby = el.hasAttribute('aria-labelledby');
    const hasTitle = (el.getAttribute('title') || '').trim().length > 0;
    const text = (el.textContent || '').trim();
    if (!hasAria && !hasLabelledby && !hasTitle && text.length === 0) {
      unnamedIconButtons.push({
        tag: el.tagName.toLowerCase(),
        selector: getSelector(el),
      });
    }
  }

  return {
    scrollWidth,
    innerWidth,
    hasDocHScroll,
    overflowCount: overflowingElements.length,
    overflowSample: overflowingElements.slice(0, 3),
    verticalSplitCount: verticalSplitElements.length,
    verticalSplitSample: verticalSplitElements.slice(0, 3),
    smallTouchCount: smallTouchTargets.length,
    smallTouchSample: smallTouchTargets.slice(0, 3),
    fixedOverlapCount: fixedOverlaps.length,
    fixedOverlapSample: fixedOverlaps.slice(0, 3),
    unnamedIconButtonCount: unnamedIconButtons.length,
    unnamedIconButtonSample: unnamedIconButtons.slice(0, 3),
    totalDefects: (hasDocHScroll ? 1 : 0) +
      overflowingElements.length +
      verticalSplitElements.length +
      smallTouchTargets.length +
      fixedOverlaps.length +
      unnamedIconButtons.length,
  };
}

async function main() {
  await mkdir(SCREENSHOT_DIR, { recursive: true });

  const task = await taskSpace('sohee ui audit');
  const existingPages = await task.pages();
  for (const p of existingPages) {
    if (p.label !== 'p1') {
      try { await p.close(); } catch {}
    }
  }
  const page = task.page('p1');

  const auditResults = [];

  console.log(`=== 모바일 레이아웃 무결성 점검 시작 (${WIDTHS.join('/')}px) ===`);

  // 1. 단독 하네스 화면 점검
  for (const path of HARNESS_PATHS) {
    const screenName = path.replace('/dev/mobile-r2/', '').replace(/[?&=]/g, '-');
    for (const width of WIDTHS) {
      await page.cdp('Emulation.setDeviceMetricsOverride', {
        width,
        height: 800,
        deviceScaleFactor: 2,
        mobile: true,
      });

      const url = `${BASE_URL}${path}`;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(400);

        const shotPath = join(SCREENSHOT_DIR, `harness-${screenName}-${width}.png`);
        await page.screenshot({ path: shotPath });

        const result = await page.evaluate(runIntegrityAudit);
        auditResults.push({
          screen: `harness:${screenName}`,
          width,
          ...result,
          shotPath,
        });
        console.log(`[Harness] ${screenName} @ ${width}px: defects=${result.totalDefects} (hScroll=${result.hasDocHScroll}, overflow=${result.overflowCount}, vSplit=${result.verticalSplitCount}, touch=${result.smallTouchCount}, fixed=${result.fixedOverlapCount}, unnamed=${result.unnamedIconButtonCount})`);
      } catch (err) {
        console.error(`[Harness] ${screenName} @ ${width}px 실패:`, err.message);
      }
    }
  }

  // 2. /dev/mobile-r2/app 내 5탭 및 하위 화면 점검
  for (const scr of APP_SCREENS) {
    for (const width of WIDTHS) {
      await page.cdp('Emulation.setDeviceMetricsOverride', {
        width,
        height: 844,
        deviceScaleFactor: 2,
        mobile: true,
      });

      try {
        await page.goto(`${BASE_URL}/dev/mobile-r2/app`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(300);

        if (scr.tab !== 'today') {
          await page.evaluate(({ targetTab }) => {
            const tabBtn = Array.from(document.querySelectorAll('nav button')).find(b => {
              const text = b.textContent || '';
              if (targetTab === 'work') return text.includes('작업');
              if (targetTab === 'customers') return text.includes('고객');
              if (targetTab === 'results') return text.includes('성과');
              if (targetTab === 'more') return text.includes('더보기');
              return text.includes('오늘');
            });
            if (tabBtn) tabBtn.click();
          }, { targetTab: scr.tab });
          await page.waitForTimeout(300);
        }

        if (scr.screen.includes('/')) {
          const subId = scr.screen;
          await page.evaluate((targetSub) => {
            const candidates = Array.from(document.querySelectorAll('main button, main a'));
            const found = candidates.find(el => {
              const t = el.textContent || '';
              if (targetSub === 'work/list') return t.includes('작업 목록');
              if (targetSub === 'work/notifications') return t.includes('알림함');
              if (targetSub === 'work/campaigns') return t.includes('캠페인 제안');
              if (targetSub === 'customers/list') return t.includes('고객 목록');
              if (targetSub === 'customers/inbox') return t.includes('소통함');
              if (targetSub === 'customers/ledger') return t.includes('예약표');
              if (targetSub === 'more/channels') return t.includes('채널');
              if (targetSub === 'more/credit') return t.includes('크레딧');
              if (targetSub === 'more/memory') return t.includes('가게 기억');
              if (targetSub === 'more/settings') return t.includes('설정');
              return false;
            });
            if (found) found.click();
          }, subId);
          await page.waitForTimeout(300);

          if (subId === 'customers/detail') {
            await page.evaluate(() => {
              const custLink = document.querySelector('main a[href^="/app/customers/"]');
              if (custLink) custLink.click();
            });
            await page.waitForTimeout(300);
          }
        }

        const safeName = scr.id.replace(/[:/]/g, '-');
        const shotPath = join(SCREENSHOT_DIR, `${safeName}-${width}.png`);
        await page.screenshot({ path: shotPath });

        const result = await page.evaluate(runIntegrityAudit);
        auditResults.push({
          screen: scr.id,
          width,
          ...result,
          shotPath,
        });
        console.log(`[App] ${scr.id} @ ${width}px: defects=${result.totalDefects} (hScroll=${result.hasDocHScroll}, overflow=${result.overflowCount}, vSplit=${result.verticalSplitCount}, touch=${result.smallTouchCount}, fixed=${result.fixedOverlapCount}, unnamed=${result.unnamedIconButtonCount})`);
      } catch (err) {
        console.error(`[App] ${scr.id} @ ${width}px 실패:`, err.message);
      }
    }
  }

  await page.close();

  // JSON 결과 저장
  await writeFile('/tmp/sohee-audit/sweep-results.json', JSON.stringify(auditResults, null, 2), 'utf8');
  console.log('\n=== 전수 점검 결과 저장 완료: /tmp/sohee-audit/sweep-results.json ===');
}

main().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
