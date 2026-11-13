'use client'

import { StateView } from '@/components/mobile-ui'
import type { CommonError, ErrorAction } from './error-model'

/**
 * 공통 에러 화면 — `StateView` 의 에러 계열을 그대로 쓴다.
 * 서버 응답 원문·코드는 그리지 않는다. 판정은 `error-model.ts` 가 맡는다.
 * `onAction` 이 없으면 눌러도 아무 일이 없는 버튼을 만들지 않는다.
 */
export function CommonErrorView({ error, onAction, checkedAt, className }: Readonly<{
  error: CommonError
  onAction?: (action: ErrorAction) => void
  checkedAt?: string | null
  className?: string
}>) {
  return (
    <StateView
      kind={error.kind}
      title={error.title}
      description={error.description}
      checkedAt={checkedAt}
      className={className}
      action={
        onAction ? (
          <button
            type="button"
            onClick={() => onAction(error.action)}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            {error.actionLabel}
          </button>
        ) : undefined
      }
    />
  )
}
