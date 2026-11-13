'use client'

import { LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { signOutAction } from '@/features/auth/actions'
import { clearPwaCaches } from '@/features/pwa/sw-client'
import styles from './app-shell.module.css'

export function LogoutButton({ className }: { className?: string } = {}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  function signOut() {
    setMessage(null)
    startTransition(async () => {
      try {
        const result = await signOutAction()
        if (result.error) {
          setMessage(result.error.message)
          return
        }

        // 이전 사용자의 셸·정적 자산 캐시를 비운 뒤 이동한다. 실패해도 로그아웃은 계속 진행한다.
        await clearPwaCaches()
        router.replace('/')
        router.refresh()
      } catch {
        setMessage('로그아웃을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.')
      }
    })
  }

  return (
    <>
      <button
        aria-label="로그아웃"
        className={className ?? styles.accountLogout}
        disabled={isPending}
        onClick={signOut}
        type="button"
      >
        <LogOut aria-hidden="true" strokeWidth={1.8} />
        <span>{isPending ? '로그아웃 중' : '로그아웃'}</span>
      </button>
      {message ? <p className="mt-2 text-sm leading-relaxed text-destructive" role="status">{message}</p> : null}
    </>
  )
}
