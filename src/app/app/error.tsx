'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

const automaticRecoveryWindowMs = 15_000

export default function AppError({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  useEffect(() => {
    console.error('[SoheeAppError Boundary caught]:', error)
    const recoveryKey = `sohee-app-recovery:${error.digest ?? window.location.pathname}`
    const previousAttempt = Number(window.sessionStorage.getItem(recoveryKey) ?? '0')
    const now = Date.now()
    if (Number.isFinite(previousAttempt) && now - previousAttempt < automaticRecoveryWindowMs) return
    window.sessionStorage.setItem(recoveryKey, String(now))
    const timer = window.setTimeout(() => {
      try {
        reset()
      } catch {
        window.location.reload()
      }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [error, reset])

  const handleManualReset = () => {
    try {
      reset()
    } catch {
      window.location.replace('/app')
    }
  }

  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center p-6 text-center space-y-4 font-sans">
      <div className="p-4 rounded-2xl bg-primary/10 border border-primary/30 text-primary">
        <p className="text-sm font-bold">게시 결과와 대화는 안전하게 보존되어 있어요. 화면을 다시 연결하고 있어요.</p>
      </div>
      <div className="flex gap-3">
        <Button onClick={handleManualReset} className="bg-primary hover:bg-primary/90 text-white font-bold cursor-pointer">
          화면 다시 연결
        </Button>
        <Button 
          variant="outline" 
          onClick={() => {
            window.sessionStorage.clear()
            window.location.replace('/app')
          }}
          className="border-zinc-300 dark:border-zinc-700 cursor-pointer"
        >
          대시보드로 새로고침
        </Button>
      </div>
    </div>
  )
}

