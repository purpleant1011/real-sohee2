/**
 * 승인 카드 '승인 및 실행' 가드 검수용 fetch 고정 응답 (개발 전용, ego 증거 수집용).
 *
 * 고정 응답이며 실제 서버·provider 호출 없음.
 * - `/api/` 아래 요청과 연결 확인 probe(`manifest.webmanifest`)는 이 파일의 고정 응답으로 끝난다.
 * - 그 밖의 URL(정적 리소스 등)은 원래 fetch 로 넘긴다. 승인 흐름이 쓰는 URL 은 모두 고정 응답이다.
 * - 모든 요청은 `target.__approvalFixtureCalls` 에 method·url·body·at 으로 쌓인다.
 * 운영에서는 설치되지 않는다(harness.tsx 가드, page.tsx 404).
 */

export const FIXTURE_WORKSPACE_ID = 'ws-fixture-approval'
export const FIXTURE_DECISION_ID = 'dec-fixture-1'

export type ApprovalFixtureCall = {
  method: string
  url: string
  body: unknown
  at: string
}

export type ApprovalFixtureTarget = {
  fetch?: typeof fetch
  __approvalFixture?: boolean
  __approvalFixtureCalls?: ApprovalFixtureCall[]
}

type FixtureRoute = { body: unknown }

/** 순수 라우팅. 메서드와 경로로 고정 응답 본문을 고른다. 해당 없으면 null. */
export function resolveFixtureRoute(method: string, url: string): FixtureRoute | null {
  let pathname: string
  try {
    pathname = new URL(url, 'http://fixture.local').pathname
  } catch {
    return null
  }

  if (pathname.endsWith('/agent/session') && method === 'POST') {
    return { body: { session: { sessionId: 'sess-fixture', threadId: 'thread-fixture', snapshotVersion: 1 } } }
  }
  if (pathname.endsWith('/agent/chat')) {
    if (method === 'GET') return { body: { messages: [] } }
    if (method === 'POST') {
      return {
        body: {
          reply: '신메뉴 글 초안을 준비했어요. 발행을 승인해 주세요.',
          approvalCard: {
            decisionId: FIXTURE_DECISION_ID,
            title: '신메뉴 글 발행 승인',
            options: [{ id: 'opt-now', label: '지금 발행' }],
          },
        },
      }
    }
  }
  if (pathname.endsWith('/booking-recovery/cases')) return { body: { cases: [] } }
  if (pathname.endsWith('/agent/approvals') && method === 'POST') {
    return { body: { approval: { actionRunId: 'run-fixture' }, executionResult: {} } }
  }
  if (pathname.endsWith('/manifest.webmanifest')) return { body: {} }
  if (pathname.startsWith('/api/')) return { body: {} }
  return null
}

function readBody(body: BodyInit | null | undefined): unknown {
  if (body == null) return null
  if (typeof body === 'string') {
    try {
      return JSON.parse(body)
    } catch {
      return body
    }
  }
  return String(body)
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * `target.fetch` 를 고정 응답 스텁으로 바꾼다. 두 번 호출해도 한 번만 감싼다(멱등).
 * 호출 기록은 `target.__approvalFixtureCalls` 에 쌓인다.
 */
export function installFixtureFetch(target: ApprovalFixtureTarget): void {
  if (target.__approvalFixture === true) return

  const passthrough = typeof target.fetch === 'function' ? target.fetch : null
  const calls: ApprovalFixtureCall[] = []
  target.__approvalFixtureCalls = calls

  const fixtureFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const defaultMethod = typeof input === 'string' || input instanceof URL ? 'GET' : input.method
    const method = (init?.method ?? defaultMethod).toUpperCase()
    calls.push({ method, url, body: readBody(init?.body), at: new Date().toISOString() })

    const route = resolveFixtureRoute(method, url)
    if (route) return jsonResponse(route.body)
    if (passthrough) return passthrough.call(target, input, init)
    return new Response('', { status: 404 })
  }

  target.fetch = fixtureFetch
  target.__approvalFixture = true
}
