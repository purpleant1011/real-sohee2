'use client'

import React, { Component, type ErrorInfo, type ReactNode } from 'react'

export type WorkflowErrorBoundaryProps = Readonly<{
  children: ReactNode
  onRetry?: () => void
}>

type WorkflowErrorBoundaryState = {
  hasError: boolean
  error: Error | null
}

export class WorkflowErrorBoundary extends Component<WorkflowErrorBoundaryProps, WorkflowErrorBoundaryState> {
  override state: WorkflowErrorBoundaryState = {
    hasError: false,
    error: null,
  }

  static getDerivedStateFromError(error: Error): WorkflowErrorBoundaryState {
    return { hasError: true, error }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[WorkflowErrorBoundary caught]:', error, errorInfo)
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null })
    this.props.onRetry?.()
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          aria-live="assertive"
          className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card p-6 text-center text-sm"
          role="alert"
        >
          <p className="text-muted-foreground">게시 검토 화면을 불러오는 중 문제가 발생했어요.</p>
          <button
            className="inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            onClick={this.handleRetry}
            type="button"
          >
            다시 시도
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
