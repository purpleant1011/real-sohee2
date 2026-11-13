'use client'

import { useSyncExternalStore } from 'react'
import { Sun, Moon, Laptop } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/components/theme-provider'

type Props = Readonly<{
  className?: string
}>

function subscribe() {
  return () => {}
}

export function OperatorThemeToggle({ className = '' }: Props) {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const mounted = useSyncExternalStore(subscribe, () => true, () => false)

  if (!mounted) {
    return (
      <Button
        aria-label="테마 전환"
        className={`size-8 p-0 text-muted-foreground ${className}`}
        size="sm"
        type="button"
        variant="ghost"
      >
        <Sun className="size-4 opacity-50" />
      </Button>
    )
  }

  function handleToggle() {
    if (theme === 'light') {
      setTheme('dark')
    } else if (theme === 'dark') {
      setTheme('system')
    } else {
      setTheme('light')
    }
  }

  const icon =
    theme === 'system' ? (
      <Laptop className="size-3.5 text-purple-600 dark:text-purple-400" />
    ) : resolvedTheme === 'dark' ? (
      <Moon className="size-3.5 text-blue-400" />
    ) : (
      <Sun className="size-3.5 text-amber-500" />
    )

  const label =
    theme === 'system'
      ? '시스템 테마 (클릭하여 라이트로 변경)'
      : theme === 'dark'
      ? '다크 모드 (클릭하여 시스템으로 변경)'
      : '라이트 모드 (클릭하여 다크로 변경)'

  return (
    <Button
      aria-label={label}
      className={`size-8 p-0 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors ${className}`}
      onClick={handleToggle}
      size="sm"
      title={label}
      type="button"
      variant="ghost"
    >
      {icon}
      <span className="sr-only">{label}</span>
    </Button>
  )
}
