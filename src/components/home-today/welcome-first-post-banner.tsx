'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'

const STORAGE_KEY = 'sohee_welcome_first_post_dismissed'

export function WelcomeFirstPostBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      const url = new URL(window.location.href)
      const isWelcome = url.searchParams.get('welcome') === 'first-post'
      const isDismissed = localStorage.getItem(STORAGE_KEY) === 'true'

      if (isWelcome && !isDismissed) {
        setVisible(true)
        url.searchParams.delete('welcome')
        const newUrl = url.pathname + (url.search ? url.search : '')
        window.history.replaceState({}, '', newUrl)
      }
    } catch {
      // ignore in environments without localStorage or URL parsing
    }
  }, [])

  function handleDismiss() {
    setVisible(false)
    try {
      localStorage.setItem(STORAGE_KEY, 'true')
    } catch {
      // ignore
    }
  }

  if (!visible) return null

  return (
    <aside
      role="status"
      aria-live="polite"
      className="relative rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-background p-4 sm:p-5 shadow-sm transition-all"
    >
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-primary/10 p-2 text-primary shrink-0 mt-0.5 sm:mt-0">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">
              첫 글이 완성됐어요. 이제 이번 주 글도 소희와 함께 만들어 볼까요?
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              사장님 매장에 맞는 다음 마케팅 글을 이어갈 수 있어요.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0 w-full sm:w-auto">
          <Button size="sm" className="w-full sm:w-auto min-h-10 font-medium" asChild>
            <Link href="/app/content" onClick={handleDismiss}>
              다음 글 만들기
            </Link>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="w-full sm:w-auto min-h-10 text-muted-foreground hover:text-foreground"
            onClick={handleDismiss}
          >
            둘러보기
          </Button>
        </div>
      </div>
    </aside>
  )
}
