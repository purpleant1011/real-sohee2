import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from './skeleton'

export type DataState<T> =
  | { kind: 'loading' }
  | { kind: 'empty'; title: string; description: string }
  | { kind: 'error'; message: string; requestId?: string; retryable: boolean }
  | { kind: 'ready'; data: T; checkedAt: string }

type DataBoundaryProps<T> = {
  state: DataState<T>
  children?: (data: T) => ReactNode
  onRetry?: () => void
}

export function DataBoundary<T>({ children, onRetry, state }: Readonly<DataBoundaryProps<T>>) {
  switch (state.kind) {
    case 'loading':
      return (
        <section aria-live="polite" aria-label="데이터 로딩 상태">
          <p>데이터 확인 중</p>
          <Skeleton />
        </section>
      )
    case 'empty':
      return (
        <section aria-labelledby="empty-data-title">
          <h2 id="empty-data-title">{state.title}</h2>
          <p>{state.description}</p>
        </section>
      )
    case 'error':
      return (
        <section aria-live="assertive" aria-label="데이터 오류 상태" role="alert">
          <p>{state.message}</p>
          {state.retryable ? (
            <Button onClick={onRetry}>
              다시 시도
            </Button>
          ) : null}
        </section>
      )
    case 'ready':
      return (
        <section aria-label="데이터 준비 상태">
          {children?.(state.data)}
          <p>확인 시각: {state.checkedAt}</p>
        </section>
      )
  }
}
