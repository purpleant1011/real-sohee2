'use client'

import React, { useState, useRef, useEffect } from 'react'
import { MoreVertical, Pause, Play, ShieldAlert, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface SafetyControlMenuProps {
  isPaused: boolean
  onTogglePause: () => void
  className?: string
}

export function SafetyControlMenu({
  isPaused,
  onTogglePause,
  className,
}: SafetyControlMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [menuOpen])

  return (
    <div className={`space-y-3 ${className ?? ''}`} ref={menuRef}>
      {/* 1. 정말 멈춰 있을 때만 사장님 친화적 말로 안내하는 배너 */}
      {isPaused && (
        <div
          role="alert"
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/80 dark:bg-amber-950/30 text-amber-950 dark:text-amber-200"
        >
          <div className="flex items-center gap-2.5">
            <Pause className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-bold">소희의 업무가 잠시 멈춰 있어요.</p>
              <p className="text-xs text-amber-800 dark:text-amber-300">
                사장님이 원하실 때 언제든 다시 시작할 수 있어요.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={onTogglePause}
            className="w-full sm:w-auto bg-amber-600 hover:bg-amber-700 text-white font-medium shrink-0"
          >
            <Play className="w-4 h-4 mr-1.5" aria-hidden="true" />
            소희 업무 다시 시작하기
          </Button>
        </div>
      )}

      {/* 2. 긴급 정지 메뉴 (2클릭 이내 접근 유지) */}
      <div className="flex justify-end relative">
        <Button
          variant="outline"
          size="sm"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="소희 업무 제어 메뉴"
          onClick={() => setMenuOpen((prev) => !prev)}
          className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
          <span>소희 업무 제어</span>
          <MoreVertical className="w-3.5 h-3.5" aria-hidden="true" />
        </Button>

        {menuOpen && (
          <div
            role="menu"
            aria-label="소희 업무 제어 메뉴"
            className="absolute right-0 top-full mt-1.5 w-56 rounded-xl border border-border bg-popover p-1.5 shadow-lg z-50 animate-in fade-in-50 zoom-in-95"
          >
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                onTogglePause()
                setMenuOpen(false)
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-left text-foreground hover:bg-muted transition-colors cursor-pointer"
            >
              {isPaused ? (
                <>
                  <Play className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
                  <span>소희 업무 다시 시작하기</span>
                </>
              ) : (
                <>
                  <Pause className="w-4 h-4 text-rose-600 shrink-0" aria-hidden="true" />
                  <span>소희 업무 잠시 멈추기 (긴급 정지)</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
