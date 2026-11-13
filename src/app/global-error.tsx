'use client'

import React from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 p-6">
        <div className="max-w-md w-full p-8 rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl text-center space-y-4">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-state-danger-soft flex items-center justify-center text-state-danger font-bold text-xl">
            !
          </div>
          <h2 className="text-lg font-extrabold tracking-tight">일시적인 시스템 오류가 발생했습니다</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {error?.message || '페이지를 불러오는 중 문제가 발생했습니다. 다시 시도해 주세요.'}
          </p>
          <button
            onClick={() => reset()}
            className="w-full py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-bold shadow-md cursor-pointer transition-all"
          >
            다시 시도하기
          </button>
        </div>
      </body>
    </html>
  )
}
