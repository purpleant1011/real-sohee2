#!/usr/bin/env node

/**
 * 소희 4채널 스튜디오(ANI-1538) Ego Lite 기반 화면 실측 스크립트
 *
 * 이미 떠 있는 개발 서버(--base-url, 기본 http://127.0.0.1:3414)의
 * /dev/channel-studio/studio 경로를 ego-browser(Ego Lite)로 접속하여 다음을 실측한다:
 * 1. 뷰포트 1280x800 및 390x844 가로 스크롤 0 여부
 * 2. 탭 4개(role=tab) 존재 및 ArrowRight 3회 순환 키보드 이동 여부
 * 3. 각 탭 패널의 '예상 화면' 면책 문구, '이 채널 글 보관하기' 버튼(비활성 시 사유), 발행/예약 버튼 부재
 * 4. 모바일 390 뷰포트 터치 타깃(높이 44px 미만 요소 목록)
 * 5. 콘솔 에러 발생 여부 (CDP)
 * 6. axe-core 접근성 (프로젝트에 존재 시 측정, 미설치 시 정직하게 '미측정')
 *
 * 측정 데이터와 평가 결과는 evidence/v092/channel-studio/metrics.json 과
 * studio-1280.png, studio-390.png 스크린샷으로 저장된다.
 *
 * 서버가 없으면 서버를 직접 띄우지 않고 한국어 오류로 즉시 종료한다(통과 위장 금지).
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const DEFAULT_BASE_URL = 'http://127.0.0.1:3414'
export const TARGET_ROUTE = '/dev/channel-studio/studio'
export const DRIVER_MARKER = '__CHANNEL_STUDIO_MEASURE__'

const REPO_ROOT = path.resolve(import.meta.dirname, '../..')
export const DEFAULT_OUT_DIR = path.resolve(REPO_ROOT, 'evidence/v092/channel-studio')

/**
 * 개발 서버가 연결 가능한지 확인한다.
 */
export async function isServerReachable(url, timeoutMs = 3000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return res.status === 200
  } catch {
    return false
  }
}

/**
 * ego-browser 바이너리 경로를 탐색한다.
 */
export function findEgoBrowser() {
  const candidates = [
    process.env.EGO_BROWSER_BIN,
    'ego-browser',
    path.join(os.homedir(), '.local/bin/ego-browser'),
  ].filter(Boolean)

  for (const cand of candidates) {
    const probe = spawnSync(cand, ['--help'], { encoding: 'utf8', timeout: 10000 })
    if (!probe.error) return cand
  }
  return null
}

/**
 * 프로젝트 package.json 에 axe-core 가 설치되어 있는지 확인한다.
 */
export function checkAxeCoreInstalled(repoRoot = REPO_ROOT) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    if (deps['axe-core']) return true
    // @axe-core/playwright(이미 설치됨)가 가져오는 axe-core 빌드를 사용한다. 새 의존성은 설치하지 않는다.
    return fs.existsSync(path.join(repoRoot, 'node_modules', 'axe-core', 'axe.min.js'))
  } catch {
    return false
  }
}

/**
 * 드라이버 stdout/stderr 에서 마커 줄(JSON)을 파싱한다 (순수 함수).
 */
export function parseDriverOutput(stdout = '', stderr = '') {
  for (const line of `${stdout}\n${stderr}`.split('\n')) {
    const idx = line.indexOf(DRIVER_MARKER)
    if (idx === -1) continue
    const json = line.slice(idx + DRIVER_MARKER.length).trim()
    try {
      return JSON.parse(json)
    } catch {
      throw new Error(`드라이버 출력 JSON 파싱 실패: ${json.slice(0, 120)}`)
    }
  }
  return null
}

/**
 * 측정 결과 객체를 평가하여 항목별 상태 및 종합 결과를 산출한다 (순수 함수).
 * 측정하지 못한 항목은 절대 PASS 로 두지 않는다.
 *
 * @param {any} raw
 * @returns {{
 *   overall: 'PASS' | 'FAIL' | 'NOT_MEASURED',
 *   items: Record<string, { status: 'PASS' | 'FAIL' | 'NOT_MEASURED', message: string, details?: any }>
 * }}
 */
export function evaluateMeasurements(raw) {
  const items = {}

  // 1. 1280 뷰포트 가로 스크롤 없음 (scrollWidth <= clientWidth)
  const dim1280 = raw?.['1280']?.dimensions || raw?.desktop1280?.dimensions
  if (!dim1280) {
    items.viewport1280Scroll = {
      status: 'NOT_MEASURED',
      message: '1280 뷰포트 치수가 측정되지 않았습니다.',
    }
  } else if (dim1280.scrollWidth <= dim1280.clientWidth && !dim1280.overflowsX) {
    items.viewport1280Scroll = {
      status: 'PASS',
      message: `1280 뷰포트 가로 스크롤 없음 (scrollWidth: ${dim1280.scrollWidth}px, clientWidth: ${dim1280.clientWidth}px)`,
      details: dim1280,
    }
  } else {
    items.viewport1280Scroll = {
      status: 'FAIL',
      message: `1280 뷰포트 가로 스크롤 발생 (scrollWidth: ${dim1280.scrollWidth}px > clientWidth: ${dim1280.clientWidth}px)`,
      details: dim1280,
    }
  }

  // 2. 390 뷰포트 가로 스크롤 없음 (scrollWidth <= clientWidth)
  const dim390 = raw?.['390']?.dimensions || raw?.mobile390?.dimensions
  if (!dim390) {
    items.viewport390Scroll = {
      status: 'NOT_MEASURED',
      message: '390 뷰포트 치수가 측정되지 않았습니다.',
    }
  } else if (dim390.scrollWidth <= dim390.clientWidth && !dim390.overflowsX) {
    items.viewport390Scroll = {
      status: 'PASS',
      message: `390 뷰포트 가로 스크롤 없음 (scrollWidth: ${dim390.scrollWidth}px, clientWidth: ${dim390.clientWidth}px)`,
      details: dim390,
    }
  } else {
    items.viewport390Scroll = {
      status: 'FAIL',
      message: `390 뷰포트 가로 스크롤 발생 (scrollWidth: ${dim390.scrollWidth}px > clientWidth: ${dim390.clientWidth}px)`,
      details: dim390,
    }
  }

  // 3. 탭 4개(role=tab) 보이고 ArrowRight 3회 순환 이동
  const tabs = raw?.channelStudio?.tabs || raw?.tabs
  if (!tabs) {
    items.tabKeyboardNav = {
      status: 'NOT_MEASURED',
      message: '탭 키보드 네비게이션이 측정되지 않았습니다.',
    }
  } else {
    const count = tabs.count ?? tabs.items?.length ?? 0
    const cycleSuccess = Boolean(tabs.arrowRightCycles?.success)
    if (count === 4 && cycleSuccess) {
      items.tabKeyboardNav = {
        status: 'PASS',
        message: '탭 4개 확인 및 ArrowRight 3회 순환 탐색 정상 동작',
        details: tabs.arrowRightCycles,
      }
    } else {
      items.tabKeyboardNav = {
        status: 'FAIL',
        message: `탭 네비게이션 검증 실패 (탭 개수: ${count}/4, 순환 탐색 성공: ${cycleSuccess})`,
        details: tabs,
      }
    }
  }

  // 4. 각 탭 패널에 '예상 화면' 면책 문구
  const panels = raw?.channelStudio?.panels || raw?.panels
  if (!panels || !Array.isArray(panels) || panels.length === 0) {
    items.panelsDisclaimer = {
      status: 'NOT_MEASURED',
      message: '탭 패널 내용이 측정되지 않았습니다.',
    }
  } else {
    const missing = panels.filter(p => !p.hasDisclaimer)
    if (missing.length === 0) {
      items.panelsDisclaimer = {
        status: 'PASS',
        message: `4개 채널 전체 패널에 '예상 화면' 면책 문구 확인 (${panels.length}개 패널)`,
      }
    } else {
      items.panelsDisclaimer = {
        status: 'FAIL',
        message: `'예상 화면' 면책 문구 누락: ${missing.map(p => p.channel).join(', ')}`,
        details: missing,
      }
    }
  }

  // 5. 각 탭 패널에 '이 채널 글 보관하기' 버튼 (비활성이면 사유 텍스트)
  if (!panels || !Array.isArray(panels) || panels.length === 0) {
    items.panelsArchiveButton = {
      status: 'NOT_MEASURED',
      message: '탭 패널 보관 버튼이 측정되지 않았습니다.',
    }
  } else {
    const missingBtn = panels.filter(p => !p.hasArchiveButton)
    const disabledWithoutReason = panels.filter(p => p.archiveButtonDisabled && !p.hasBlockedReason)
    if (missingBtn.length > 0) {
      items.panelsArchiveButton = {
        status: 'FAIL',
        message: `'이 채널 글 보관하기' 버튼 누락: ${missingBtn.map(p => p.channel).join(', ')}`,
        details: missingBtn,
      }
    } else if (disabledWithoutReason.length > 0) {
      items.panelsArchiveButton = {
        status: 'FAIL',
        message: `보관 버튼 비활성화 상태에서 사유 문구 누락: ${disabledWithoutReason.map(p => p.channel).join(', ')}`,
        details: disabledWithoutReason,
      }
    } else {
      items.panelsArchiveButton = {
        status: 'PASS',
        message: '전체 채널 패널에 "이 채널 글 보관하기" 버튼 확인 (비활성 사유 안내 포함)',
      }
    }
  }

  // 6. 발행/예약 버튼('승인하고 발행' 등) 부재
  if (!panels || !Array.isArray(panels) || panels.length === 0) {
    items.noPublishButtons = {
      status: 'NOT_MEASURED',
      message: '발행/예약 버튼 여부가 측정되지 않았습니다.',
    }
  } else {
    const forbidden = panels.filter(p => p.hasForbiddenPublishButton)
    if (forbidden.length > 0) {
      items.noPublishButtons = {
        status: 'FAIL',
        message: `금지된 발행/예약 관련 버튼 발견: ${forbidden.map(p => `${p.channel}(${(p.forbiddenButtonTexts || []).join(', ')})`).join(', ')}`,
        details: forbidden,
      }
    } else {
      items.noPublishButtons = {
        status: 'PASS',
        message: '발행/예약 관련 버튼("승인하고 발행" 등) 없음 확인',
      }
    }
  }

  // 7. 모바일 390 터치 타깃 (높이 44px 미만 대화형 요소)
  const touchTargets = raw?.['390']?.touchTargets || raw?.mobile390?.touchTargets || raw?.touchTargets
  if (!touchTargets) {
    items.mobileTouchTargets = {
      status: 'NOT_MEASURED',
      message: '모바일 터치 타깃이 측정되지 않았습니다.',
    }
  } else {
    const count = touchTargets.smallTargetsCount ?? 0
    if (count === 0) {
      items.mobileTouchTargets = {
        status: 'PASS',
        message: `모바일 대화형 요소 높이 44px 미만 0개 확인 (전체 ${touchTargets.checkedCount ?? 0}개 검사)`,
      }
    } else {
      items.mobileTouchTargets = {
        status: 'FAIL',
        message: `모바일 대화형 요소 중 높이 44px 미만 ${count}개 발견`,
        details: touchTargets.smallTargets,
      }
    }
  }

  // 8. 브라우저 콘솔 error 개수
  const consoleErrors = raw?.channelStudio?.consoleErrors || raw?.consoleErrors
  if (!consoleErrors || consoleErrors.status === 'NOT_MEASURED') {
    items.consoleErrors = {
      status: 'NOT_MEASURED',
      message: consoleErrors?.reason || '콘솔 에러 측정 불가',
    }
  } else {
    const count = consoleErrors.count ?? 0
    if (count === 0) {
      items.consoleErrors = {
        status: 'PASS',
        message: '브라우저 콘솔 에러 0건',
      }
    } else {
      items.consoleErrors = {
        status: 'FAIL',
        message: `브라우저 콘솔 에러 ${count}건 발생`,
        details: consoleErrors.errors,
      }
    }
  }

  // 9. 접근성 axe-core
  const axe = raw?.axe || raw?.['1280']?.axe || raw?.['390']?.axe
  if (!axe || axe.status === 'NOT_MEASURED') {
    items.accessibilityAxe = {
      status: 'NOT_MEASURED',
      message: axe?.reason || 'axe-core 미설치로 접근성 미측정',
    }
  } else {
    const criticalSerious = (axe.violations || []).filter(v => v.impact === 'critical' || v.impact === 'serious')
    if (criticalSerious.length === 0) {
      items.accessibilityAxe = {
        status: 'PASS',
        message: 'axe-core 접근성 critical/serious 위반 0건',
      }
    } else {
      items.accessibilityAxe = {
        status: 'FAIL',
        message: `axe-core 접근성 critical/serious 위반 ${criticalSerious.length}건 발견`,
        details: criticalSerious,
      }
    }
  }

  // 전체 판정 종합
  const itemStatuses = Object.values(items).map(i => i.status)
  let overall = 'PASS'
  if (itemStatuses.includes('FAIL')) {
    overall = 'FAIL'
  } else if (itemStatuses.includes('NOT_MEASURED')) {
    overall = 'NOT_MEASURED'
  }

  return { overall, items }
}

/**
 * ego-browser nodejs 로 전달할 드라이버 인라인 스크립트를 생성한다.
 */
export function buildDriverScript({ baseUrl, targetRoute, outDir, hasAxeCore }) {
  const marker = DRIVER_MARKER
  const shot1280Path = path.resolve(outDir, 'studio-1280.png')
  const shot390Path = path.resolve(outDir, 'studio-390.png')
  const payload = JSON.stringify({
    baseUrl,
    targetRoute,
    marker,
    shot1280Path,
    shot390Path,
    hasAxeCore,
    axeSource: hasAxeCore ? fs.readFileSync(path.join(REPO_ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8') : null,
  })

  return `
const cfg = ${payload};
const task = await taskSpace("channel-studio measure");
const page = task.page("p1");

try {
  await page.cdp("Runtime.enable");
  await page.cdp("Log.enable");
} catch (err) {
  // CDP 초기화 실패 시 이벤트 수집에서 처리
}

const targetUrl = cfg.baseUrl + cfg.targetRoute;

// 1. 데스크톱 1280x800 설정
await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 1280,
  height: 800,
  deviceScaleFactor: 1,
  mobile: false,
});

await page.goto(targetUrl, { waitUntil: "load", timeout: 60000 });
await page.waitForSelector("main", { state: "attached", timeout: 30000 });
await page.waitForTimeout(500);

// 1280 치수 측정
const dim1280 = await page.evaluate(() => {
  const de = document.documentElement;
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollWidth: de.scrollWidth,
    scrollHeight: de.scrollHeight,
    clientWidth: de.clientWidth,
    clientHeight: de.clientHeight,
    overflowsX: de.scrollWidth > de.clientWidth,
  };
});

// 1280 스크린샷
await page.screenshot({ path: cfg.shot1280Path });

// 탭 4개 및 키보드 네비게이션(ArrowRight 3회 순환) 측정
const tabInit = await page.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  return {
    count: tabs.length,
    tabs: tabs.map((t, idx) => ({
      index: idx,
      id: t.id,
      text: (t.textContent || "").trim().replace(/\\s+/g, " "),
      selected: t.getAttribute("aria-selected") === "true",
    })),
  };
});

// 첫 번째 탭 포커스
const firstTab = '#studio-tab-instagram';
await page.focus(firstTab);

const arrowRightSteps = [];
for (let step = 1; step <= 3; step++) {
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(150);
  const activeTabInfo = await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
    const idx = tabs.findIndex(t => t.getAttribute("aria-selected") === "true");
    return {
      selectedIdx: idx,
      selectedId: idx >= 0 ? tabs[idx].id : null,
      selectedText: idx >= 0 ? (tabs[idx].textContent || "").trim().replace(/\\s+/g, " ") : null,
    };
  });
  arrowRightSteps.push(activeTabInfo);
}

// 4회째도 눌러서 첫 탭으로 다시 순환되는지 확인
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(150);
const wrapStep = await page.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  return tabs.findIndex(t => t.getAttribute("aria-selected") === "true");
});

const arrowRightCyclesValid =
  tabInit.count === 4 &&
  arrowRightSteps[0]?.selectedIdx === 1 &&
  arrowRightSteps[1]?.selectedIdx === 2 &&
  arrowRightSteps[2]?.selectedIdx === 3 &&
  wrapStep === 0;

// 각 탭 패널 내용 측정 (면책 문구, 보관 버튼, 사유, 발행/예약 버튼 부재)
const channels = ["instagram", "threads", "naver_blog", "daangn_business"];
const panels = [];

for (const ch of channels) {
  const tabSelector = "#studio-tab-" + ch;
  await page.click(tabSelector);
  await page.waitForTimeout(200);

  const panelInfo = await page.evaluate((chName) => {
    const panel = document.querySelector("#studio-panel-" + chName) || document.querySelector('[role="tabpanel"]');
    if (!panel) {
      return {
        channel: chName,
        found: false,
        hasDisclaimer: false,
        hasArchiveButton: false,
        archiveButtonDisabled: false,
        hasBlockedReason: false,
        blockedReason: null,
        hasForbiddenPublishButton: false,
        forbiddenButtonTexts: [],
      };
    }

    const text = panel.textContent || "";
    const hasDisclaimer = text.includes("예상 화면");

    const clickables = Array.from(panel.querySelectorAll('button, a, [role="button"]'));
    const archiveBtn = clickables.find(el => (el.textContent || "").includes("이 채널 글 보관하기"));
    const hasArchiveButton = Boolean(archiveBtn);
    const archiveButtonDisabled = archiveBtn ? (archiveBtn.disabled || archiveBtn.getAttribute("aria-disabled") === "true") : false;

    let hasBlockedReason = false;
    let blockedReason = null;
    if (archiveButtonDisabled) {
      const reasonEl = archiveBtn.parentElement?.querySelector("p.text-muted-foreground") ||
                       panel.querySelector("aside p.text-muted-foreground");
      if (reasonEl && reasonEl.textContent && reasonEl.textContent.trim()) {
        hasBlockedReason = true;
        blockedReason = reasonEl.textContent.trim();
      }
    }

    const forbiddenRegex = /승인하고\\s*발행|즉시\\s*발행|예약\\s*발행|^발행$|^예약$|예약하기|발행하기/;
    const forbiddenButtons = clickables.filter(el => {
      const t = (el.textContent || "").trim().replace(/\\s+/g, " ");
      return forbiddenRegex.test(t);
    });

    return {
      channel: chName,
      found: true,
      hasDisclaimer,
      hasArchiveButton,
      archiveButtonDisabled,
      hasBlockedReason,
      blockedReason,
      hasForbiddenPublishButton: forbiddenButtons.length > 0,
      forbiddenButtonTexts: forbiddenButtons.map(b => (b.textContent || "").trim()),
    };
  }, ch);

  panels.push(panelInfo);
}

// 2. 모바일 390x844 설정
await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 390,
  height: 844,
  deviceScaleFactor: 3,
  mobile: true,
});
await page.waitForTimeout(500);

// 390 치수 측정
const dim390 = await page.evaluate(() => {
  const de = document.documentElement;
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollWidth: de.scrollWidth,
    scrollHeight: de.scrollHeight,
    clientWidth: de.clientWidth,
    clientHeight: de.clientHeight,
    overflowsX: de.scrollWidth > de.clientWidth,
  };
});

// 390 스크린샷
await page.screenshot({ path: cfg.shot390Path });

// 모바일 390 터치 타깃 검사 (높이 44px 미만 대화형 요소)
const touchTargets = await page.evaluate(() => {
  const elements = Array.from(document.querySelectorAll('button, [role="tab"], a'));
  const small = [];
  for (const el of elements) {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const isVisible = rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    if (!isVisible) continue;
    if (rect.height < 44) {
      small.push({
        tagName: el.tagName.toLowerCase(),
        text: (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 50),
        role: el.getAttribute("role") || undefined,
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
        id: el.id || undefined,
      });
    }
  }
  return {
    checkedCount: elements.length,
    smallTargetsCount: small.length,
    smallTargets: small,
  };
});

// 콘솔 에러 수집
let consoleResult = { status: "PASS", count: 0, errors: [] };
try {
  const events = await page.events();
  const errorEvents = events.filter(e => {
    if (e.method === "Log.entryAdded" && e.params?.entry?.level === "error") return true;
    if (e.method === "Runtime.exceptionThrown") return true;
    if (e.method === "Runtime.consoleAPICalled" && e.params?.type === "error") return true;
    return false;
  });
  consoleResult = {
    status: errorEvents.length === 0 ? "PASS" : "FAIL",
    count: errorEvents.length,
    errors: errorEvents.map(e => JSON.stringify(e.params)),
  };
} catch (e) {
  consoleResult = {
    status: "NOT_MEASURED",
    reason: "CDP 이벤트 수집 불가 (" + (e?.message || String(e)) + ")",
    count: 0,
    errors: [],
  };
}

// 접근성 axe 측정
let axeResult = {
  status: "NOT_MEASURED",
  reason: "axe-core 패키지가 프로젝트에 설치되어 있지 않음 (새 의존성 설치 금지 원칙)",
};
if (cfg.axeSource) {
  try {
    await page.evaluate(cfg.axeSource);
    const violations = await page.evaluate(async () => {
      const res = await window.axe.run(document, { resultTypes: ["violations"] });
      return res.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, targets: v.nodes.slice(0, 5).map((n) => ({ target: n.target, summary: (n.failureSummary || '').slice(0, 220) })) }));
    });
    axeResult = { status: "MEASURED", viewport: "390", violations };
  } catch (e) {
    axeResult = { status: "NOT_MEASURED", reason: "axe 실행 실패: " + (e?.message || String(e)) };
  }
}

await task.finish({ keep: [] });

const measuredData = {
  1280: {
    viewport: { width: 1280, height: 800, isMobile: false },
    dimensions: dim1280,
    axe: axeResult,
    screenshot: cfg.shot1280Path,
    measuredAt: new Date().toISOString(),
  },
  390: {
    viewport: { width: 390, height: 844, isMobile: true },
    dimensions: dim390,
    touchTargets,
    axe: axeResult,
    screenshot: cfg.shot390Path,
    measuredAt: new Date().toISOString(),
  },
  channelStudio: {
    tabs: {
      count: tabInit.count,
      items: tabInit.tabs,
      arrowRightCycles: {
        success: arrowRightCyclesValid,
        steps: arrowRightSteps,
        wrapIdx: wrapStep,
      },
    },
    panels,
    consoleErrors: consoleResult,
  },
  axe: axeResult,
};

console.log(cfg.marker + " " + JSON.stringify(measuredData));
`
}

/**
 * 실측 전체 파이프라인을 실행한다.
 */
export async function runChannelStudioMeasure(options = {}) {
  const baseUrl = options.baseUrl || DEFAULT_BASE_URL
  const targetRoute = options.targetRoute || TARGET_ROUTE
  const outDir = options.outDir || DEFAULT_OUT_DIR
  const fullUrl = baseUrl + targetRoute

  // 1. 개발 서버 연결성 확인 (직접 서버를 띄우지 않음)
  const reachable = await isServerReachable(fullUrl, 3000)
  if (!reachable) {
    throw new Error(
      `개발 서버에 연결할 수 없습니다: ${fullUrl}\n` +
      `측정을 실행하려면 먼저 개발 서버(npm run dev, 기본 ${DEFAULT_BASE_URL})를 실행해 주세요.\n` +
      `(스크립트 규칙에 따라 개발 서버를 임의로 직접 띄우지 않습니다.)`
    )
  }

  // 2. ego-browser 바이너리 확인
  const egoBin = findEgoBrowser()
  if (!egoBin) {
    throw new Error(
      'ego-browser CLI 를 찾을 수 없습니다. (PATH 또는 ~/.local/bin/ego-browser 확인 필요)\n' +
      'Ego Lite 설치 후 다시 시도해 주세요.'
    )
  }

  // 3. axe-core 패키지 설치 여부 확인
  const hasAxeCore = checkAxeCoreInstalled(REPO_ROOT)

  // 4. 출력 디렉터리 생성
  fs.mkdirSync(outDir, { recursive: true })

  // 5. 드라이버 스크립트 실행
  const driverScript = buildDriverScript({ baseUrl, targetRoute, outDir, hasAxeCore })
  const run = spawnSync(egoBin, ['nodejs'], {
    input: driverScript,
    encoding: 'utf8',
    timeout: 300000,
    maxBuffer: 64 * 1024 * 1024,
  })

  if (run.error || run.status !== 0) {
    const errMsg = run.error?.message || run.stderr || run.stdout || ''
    throw new Error(`ego-browser 실행 실패 (exit code: ${run.status ?? 'n/a'}): ${errMsg.slice(-600)}`)
  }

  // 6. 결과 파싱
  const raw = parseDriverOutput(run.stdout, run.stderr)
  if (!raw) {
    throw new Error(`드라이버 실행은 완료되었으나 유효한 측정 마커(${DRIVER_MARKER}) 결과를 찾을 수 없습니다.`)
  }

  // 7. 결과 평가 (순수 함수)
  const evaluation = evaluateMeasurements(raw)

  // 8. metrics.json 저장
  const finalMetrics = {
    ...raw,
    evaluation,
  }
  const metricsPath = path.resolve(outDir, 'metrics.json')
  fs.writeFileSync(metricsPath, JSON.stringify(finalMetrics, null, 2), 'utf8')

  return {
    raw,
    evaluation,
    metricsPath,
    shot1280Path: path.resolve(outDir, 'studio-1280.png'),
    shot390Path: path.resolve(outDir, 'studio-390.png'),
  }
}

function parseCliArgs(argv) {
  const args = { baseUrl: undefined, outDir: undefined, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--base-url') args.baseUrl = argv[++i]
    else if (a === '--out-dir') args.outDir = argv[++i]
    else if (a === '--json') args.json = true
  }
  return args
}

function printReport(result) {
  console.log('='.repeat(70))
  console.log('  📊  4채널 스튜디오(ANI-1538) 화면 실측 보고서')
  console.log('='.repeat(70))

  const { overall, items } = result.evaluation
  console.log(`  종합 판정: ${overall === 'PASS' ? '✅ PASS' : overall === 'FAIL' ? '❌ FAIL' : '⚠️ NOT_MEASURED'}\n`)

  for (const [key, item] of Object.entries(items)) {
    const icon = item.status === 'PASS' ? '✅' : item.status === 'FAIL' ? '❌' : '⚠️'
    console.log(`  ${icon} [${key}] (${item.status}) - ${item.message}`)
  }

  console.log('\n  저장된 산출물:')
  console.log(`  - metrics:    ${result.metricsPath}`)
  console.log(`  - 1280 스샷:  ${result.shot1280Path}`)
  console.log(`  - 390 스샷:   ${result.shot390Path}`)
  console.log('='.repeat(70))
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const args = parseCliArgs(process.argv.slice(2))
  runChannelStudioMeasure(args)
    .then(result => {
      if (args.json) {
        console.log(JSON.stringify(result, null, 2))
      } else {
        printReport(result)
      }
      process.exit(result.evaluation.overall === 'FAIL' ? 1 : 0)
    })
    .catch(err => {
      console.error('❌ [ERROR]', err.message || err)
      process.exit(2)
    })
}
