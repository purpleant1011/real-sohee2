'use client'

import { useState } from 'react'
import { StateView } from '@/components/mobile-ui'
import { CommonErrorView } from '@/features/mobile-common/error-state'
import { classifyCommonError, type ErrorStatus } from '@/features/mobile-common/error-model'
import { classifyServerResponse, isFailure, loadingState } from '@/features/mobile-common/state-linkage'
import { ConsentStatusView } from '@/features/mobile-common/consent-status'
import { consentViewFor } from '@/features/mobile-common/consent-model'

/** 수용 기준 6상태 표본. 응답 한 건을 그대로 넣어 판정이 갈리는지 보여 준다. */
export const SIX_STATE_EXAMPLES = [
  { title: '권한 없음', state: classifyServerResponse({ status: 403 }) },
  { title: '부분데이터', state: classifyServerResponse({ status: 200, complete: false, itemCount: 3 }) },
  { title: '만료', state: classifyServerResponse({ status: 401 }) },
  { title: '진행', state: loadingState() },
  { title: '실패', state: classifyServerResponse({ status: 200, loadState: 'error' }) },
  {
    title: '되돌아옴',
    state: classifyServerResponse({ status: 200, loadState: 'stale', itemCount: 2, checkedAt: '2026-10-23T09:05:00.000Z' }),
  },
] as const

/** 이 프로젝트 API 가 실제로 내려보내는 응답 형태를 그대로 쓴 예시. */
export const ERROR_EXAMPLES: readonly { title: string; status: ErrorStatus; body?: unknown }[] = [
  { title: '로그인 만료', status: 401, body: { error: '인증 세션이 필요합니다.' } },
  { title: '권한 없음', status: 403, body: { error: '해당 워크스페이스에 대한 접근 권한이 없습니다.' } },
  { title: '찾을 수 없음', status: 404, body: { error: '초안을 찾을 수 없습니다.', code: 'MISSION_NOT_FOUND' } },
  { title: '내용이 바뀜', status: 409 },
  { title: '요청 과다', status: 429 },
  { title: '서버 확인 실패', status: 500, body: { error: 'Failed to list evidence' } },
  { title: '네트워크 끊김', status: 'network' },
]

/**
 * 서버가 지금 만들어 내는 모양만 그린다. `granted` 는 서버 근거가 생기기 전까지 예시에도 쓰지 않는다
 * (customer-semantics.ts:15-18 — 동의를 추론해 granted 를 만들지 않는다).
 */
export const CONSENT_EXAMPLES: readonly { title: string; consent: ReturnType<typeof consentViewFor> }[] = [
  { title: '동의 철회', consent: consentViewFor({ status: 'withdrawn', checkedAt: '2026-10-20T00:00:00.000Z', source: '고객 요청' }) },
  { title: '동의 미확인(문자열 응답)', consent: consentViewFor('unknown') },
  { title: '동의 미확인(응답에 정보 없음)', consent: consentViewFor({}) },
]

export function CommonErrorDemo() {
  const [lastAction, setLastAction] = useState<string | null>(null)
  return (
    <>
      <p className="text-xs text-muted-foreground">예시 화면 · 실제 데이터가 아닙니다</p>

      <section aria-label="공통 상태 6종" className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-foreground">공통 상태 6종</h2>
        {SIX_STATE_EXAMPLES.map((example) => {
          const state = example.state
          const failure = isFailure(state)
          return (
            <section key={example.title} aria-label={example.title} className="rounded-2xl border border-border p-4">
              <p className="mb-3 text-xs text-muted-foreground">{example.title}</p>
              {failure ? (
                <CommonErrorView
                  error={state}
                  onAction={() => setLastAction(`${example.title} → ${state.actionLabel}`)}
                />
              ) : (
                <StateView
                  kind={state.kind}
                  title={state.title}
                  description={state.description}
                  checkedAt={state.checkedAt}
                  skeleton="list"
                  skeletonRows={2}
                >
                  <ul className="flex flex-col gap-2 text-sm text-foreground">
                    <li>확인된 항목 1</li>
                    <li>확인된 항목 2</li>
                  </ul>
                </StateView>
              )}
            </section>
          )
        })}
      </section>

      <section aria-label="공통 에러 상태" className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-foreground">공통 에러 상태</h2>
        {ERROR_EXAMPLES.map((example) => {
          const error = classifyCommonError(example.status, example.body)
          return (
            <section key={example.title} aria-label={example.title} className="rounded-2xl border border-border p-4">
              <p className="mb-3 text-xs text-muted-foreground">{example.title}</p>
              <CommonErrorView
                error={error}
                onAction={() => setLastAction(`${example.title} → ${error.actionLabel}`)}
              />
            </section>
          )
        })}
        <p role="status" className="text-xs text-muted-foreground">
          {lastAction ? `예시 화면이라 실제 동작은 하지 않아요 · ${lastAction}` : '버튼을 누르면 고른 행동을 여기에만 보여 줘요'}
        </p>
      </section>

      <section aria-label="고객 수신 동의" className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-foreground">고객 수신 동의</h2>
        {CONSENT_EXAMPLES.map((example) => (
          <section key={example.title} aria-label={example.title} className="rounded-2xl border border-border p-4">
            <p className="mb-3 text-xs text-muted-foreground">{example.title}</p>
            <ConsentStatusView consent={example.consent} />
          </section>
        ))}
      </section>
    </>
  )
}
