'use client'

import { LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { operatorSignOutAction } from '@/features/operator-auth/actions'

type Props = Readonly<{
  variant?: 'outline' | 'ghost' | 'default' | 'destructive'
  size?: 'sm' | 'default'
  className?: string
  showLabel?: boolean
}>

export function OperatorLogoutButton({
  variant = 'outline',
  size = 'sm',
  className = '',
  showLabel = true,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  function handleLogout() {
    startTransition(async () => {
      setErrorMsg(null)
      const res = await operatorSignOutAction()
      if (!res.success) {
        setErrorMsg(res.error || '로그아웃 실패')
        return
      }
      router.replace('/admin-login')
      router.refresh()
    })
  }

  return (
    <Button
      aria-label="관리자 로그아웃"
      className={`text-xs gap-1.5 font-medium transition-all ${className}`}
      disabled={isPending}
      onClick={handleLogout}
      size={size}
      type="button"
      variant={variant}
    >
      <LogOut aria-hidden="true" className="size-3.5" />
      {showLabel ? <span>{isPending ? '로그아웃 중...' : '로그아웃'}</span> : null}
      {errorMsg ? <span className="sr-only" role="alert">{errorMsg}</span> : null}
    </Button>
  )
}
