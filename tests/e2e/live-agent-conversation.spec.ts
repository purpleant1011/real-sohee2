import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

const workspaceId = '00000000-0000-4000-8000-0000000000a2'

// Use the already-authorized Ego session. Never export cookies or create a second browser.
async function inspect<T>(script: string): Promise<T> {
  const spaceId = Number(process.env.EGO_TASK_SPACE_ID)
  if (!Number.isSafeInteger(spaceId) || spaceId < 1) {
    throw new Error('기존 ego-browser TaskSpace의 EGO_TASK_SPACE_ID가 필요합니다. 로그인 정보는 내보내지 않습니다.')
  }
  const canaryVersion = process.env.H03_CANARY_VERSION
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(canaryVersion ?? '')) {
    throw new Error('원격 배포에서 확인한 H03_CANARY_VERSION이 필요합니다.')
  }
  const output = await new Promise<string>((resolve, reject) => {
    const child = execFile('ego-browser', ['nodejs', '-e', `
      const task = await taskSpace(${spaceId});
      const page = task.page("p1");
      await page.cdp("Network.enable", {});
      await page.cdp("Network.setExtraHTTPHeaders", { headers: {
        "Cloudflare-Workers-Version-Overrides": ${JSON.stringify(`real-sohee="${canaryVersion}"`)},
      } });
      await page.events();
      try {
        ${script}
        const documents = (await page.events()).filter(event =>
          event.method === "Network.responseReceived" && event.params.type === "Document" &&
          new URL(event.params.response.url).origin === "https://example.com"
        );
        for (const event of documents) {
          const response = event.params.response;
          if (response.status !== 200 || !Object.entries(response.headers).some(
            ([key, value]) => key.toLowerCase() === "x-sohee-canary" && value === "h03"
          )) throw new Error("화면 탐색이 인증 카나리 응답이 아닙니다.");
        }
      } finally {
        await page.cdp("Network.setExtraHTTPHeaders", { headers: {} });
      }
    `], { timeout: 60_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`ego-browser 검증 실패 (${error.code ?? 'UNKNOWN'}): ${stderr || stdout || error.message}`))
      } else {
        resolve(`${stdout}\n${stderr}`)
      }
    })
    // Ego consumes stdin as well as -e; an open pipe aborts the round.
    child.stdin?.end()
  })
  const line = output.split('\n').find(value => value.startsWith('H03_RESULT='))
  if (!line) throw new Error('브라우저 검증 결과가 없습니다. 성공으로 처리하지 않습니다.')
  return JSON.parse(line.slice('H03_RESULT='.length)) as T
}

test.describe('H03 실계정 출시 사전 게이트 · provider 발행 검증과 별개', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(90_000)

  test('인증된 활성 매장은 승인된 바이름 workspace와 일치한다', async () => {
    const result = await inspect<{ status: number; activeId: string; owner: boolean; canary: boolean; workspaceCount: number }>(`
      await page.goto("https://example.com/app");
      const response = await page.fetch("/api/workspaces");
      const body = typeof response.body === "string" ? JSON.parse(response.body) : response.body;
      const data = body?.data;
      console.log("H03_RESULT=" + JSON.stringify({
        status: response.status,
        activeId: data?.activeId,
        owner: data?.workspaces?.some(item => item.id === ${JSON.stringify(workspaceId)} && item.role === "owner") === true,
        canary: Object.entries(response.headers).some(([key, value]) => key.toLowerCase() === "x-sohee-canary" && value === "h03"),
        workspaceCount: data?.workspaces?.length,
      }));
    `)
    expect(result).toEqual({ status: 200, activeId: workspaceId, owner: true, canary: true, workspaceCount: 1 })
  })

  test('PC·390px에서 Instagram과 Threads 연결 상태를 표시한다', async () => {
    const screenshots = {
      desktop: resolve('evidence/ani-1889-channels-desktop.png'),
      mobile: resolve('evidence/ani-1889-channels-390.png'),
    }
    const result = await inspect<{ connected: boolean; mobileConnected: boolean; mobileOverflow: boolean }>(`
      try {
        await page.cdp("Emulation.setDeviceMetricsOverride", {width:1440,height:1000,deviceScaleFactor:1,mobile:false});
        await page.goto("https://example.com/app/channels");
        await page.waitForSelector('loc=role:article[name="인스타그램"]');
        await page.waitForFunction(() => [...document.querySelectorAll('[role="article"]')].filter(node => /연결됨 @sohee\\.ai/.test(node.textContent ?? "")).length === 2, undefined, {timeout:15000});
        const connected = await page.evaluate(() => [...document.querySelectorAll('[role="article"]')].filter(node => /연결됨 @sohee\\.ai/.test(node.textContent ?? "")).length === 2);
        await page.screenshot({path:${JSON.stringify(screenshots.desktop)}});
        await page.cdp("Emulation.setDeviceMetricsOverride", {width:390,height:844,deviceScaleFactor:1,mobile:true});
        await page.reload();
        await page.waitForFunction(() => ["인스타그램", "스레드"].every(name => [...document.querySelectorAll('ul[aria-label="연결 채널"] li')].some(node => node.textContent?.includes(name) && node.textContent?.includes("게시 가능 검증됨"))), undefined, {timeout:15000});
        const mobileConnected = await page.evaluate(() => ["인스타그램", "스레드"].every(name => [...document.querySelectorAll('ul[aria-label="연결 채널"] li')].some(node => node.textContent?.includes(name) && node.textContent?.includes("게시 가능 검증됨"))));
        const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        await page.screenshot({path:${JSON.stringify(screenshots.mobile)}});
        console.log("H03_RESULT=" + JSON.stringify({connected,mobileConnected,mobileOverflow}));
      } finally {
        await page.cdp("Emulation.clearDeviceMetricsOverride", {});
      }
    `)
    expect(result.connected).toBe(true)
    expect(result.mobileConnected).toBe(true)
    expect(result.mobileOverflow).toBe(false)
  })

  test('배포된 활동 API가 HTML 404 대신 인증된 cursor 검증 계약을 제공한다', async () => {
    const result = await inspect<{ status: number; json: boolean; code: string | null }>(`
      const response = await page.fetch("/api/workspaces/${workspaceId}/agent/activity");
      const json = Object.entries(response.headers).some(([key,value]) => key.toLowerCase() === "content-type" && String(value).includes("application/json"));
      const body = json ? (typeof response.body === "string" ? JSON.parse(response.body) : response.body) : null;
      console.log("H03_RESULT=" + JSON.stringify({status:response.status,json,code:body?.error ?? null}));
    `)
    // Missing runId is intentional: this cannot start a run or send a post.
    expect(result, '활동 API 미배포 상태에서는 목표 입력·승인·실게시 E2E를 진행하지 않습니다.').toEqual({
      status: 400, json: true, code: 'INVALID_ACTIVITY_CURSOR',
    })
  })
})
