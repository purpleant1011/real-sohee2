'use client'

import React, { useState, useEffect, useRef } from 'react'
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  ChevronDown,
} from 'lucide-react'
import type { DependencyHealthReport, DependencyItem } from '@/features/agent-os/dependency-health-service'

interface SyncHealthBadgeProps {
  workspaceId?: string
  initialReport?: DependencyHealthReport
}

export function SyncHealthBadge({ workspaceId = 'ws-default', initialReport }: SyncHealthBadgeProps) {
  const [report, setReport] = useState<DependencyHealthReport | null>(initialReport ?? null)
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  const fetchHealth = async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/agent/health`, {
        cache: 'no-store',
      })
      if (res.ok) {
        const data = (await res.json()) as DependencyHealthReport
        setReport(data)
      }
    } catch {
      // Keep existing report or fallback
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!initialReport) {
      void fetchHealth()
    }
    // Poll every 30 seconds for live freshness
    const timer = setInterval(() => {
      void fetchHealth()
    }, 30000)
    return () => clearInterval(timer)
  }, [workspaceId])

  // Close popover on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const overall = report?.overallStatus ?? 'UNKNOWN'

  const dotClasses =
    overall === 'HEALTHY'
      ? 'bg-state-ok'
      : overall === 'DEGRADED'
      ? 'bg-state-warn animate-pulse'
      : overall === 'UNKNOWN' ? 'bg-zinc-400' : 'bg-state-danger animate-pulse'

  const labelText =
    overall === 'HEALTHY'
      ? '서비스 연결 정상'
      : overall === 'DEGRADED'
      ? '서비스 연결 지연'
      : overall === 'UNKNOWN' ? '서비스 연결 확인 중' : '서비스 연결에 문제가 있어요'

  return (
    <div className="relative inline-block" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-[var(--v088-muted)] hover:text-[var(--v088-ink)] hover:bg-[var(--v088-surface-subtle)] border border-transparent hover:border-[var(--v088-border)] transition-all cursor-pointer whitespace-nowrap shrink-0"
        title="서비스 연결 상태 확인"
        aria-label={labelText}
        aria-expanded={isOpen}
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${dotClasses}`} />
        <span className="hidden lg:inline whitespace-nowrap">{labelText}</span>
        <ChevronDown className="w-3 h-3 opacity-60 ml-0.5 shrink-0" />
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="서비스 연결 상태"
          className="absolute right-0 mt-2 w-80 sm:w-96 p-4 rounded-2xl bg-[var(--v088-surface)] border border-[var(--v088-border)] shadow-xl z-50 animate-in fade-in zoom-in-95 duration-150 backdrop-blur-md"
        >
          {/* Popover Header */}
          <div className="flex items-center justify-between pb-3 border-b border-[var(--v088-border)]">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-[var(--v088-ink)]">
                서비스 연결 상태
              </span>
            </div>
            <button
              onClick={() => void fetchHealth()}
              disabled={isLoading}
              className="p-1 rounded-lg text-[var(--v088-muted)] hover:text-[var(--v088-ink)] hover:bg-[var(--v088-surface-subtle)] transition-colors"
              title="지금 상태 새로고침"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Overall Summary */}
          <div className="py-3">
            <div className="flex items-start gap-2.5">
              {overall === 'HEALTHY' ? (
                <CheckCircle2 className="w-4 h-4 text-state-ok mt-0.5 shrink-0" />
              ) : overall === 'DEGRADED' ? (
                <AlertTriangle className="w-4 h-4 text-state-warn mt-0.5 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-state-danger mt-0.5 shrink-0" />
              )}
              <div>
                <p className="text-xs font-bold text-[var(--v088-ink)]">
                  {overall === 'HEALTHY' ? '서비스가 정상적으로 연결되어 있어요.' : overall === 'DEGRADED' ? '연결이 잠시 지연되고 있어요.' : overall === 'UNKNOWN' ? '서비스 연결을 확인하고 있어요.' : '서비스 연결을 확인해 주세요.'}
                </p>
                <p className="text-[11px] text-[var(--v088-muted)] mt-0.5 leading-relaxed">
                  {report ? '연결된 서비스별 상태를 아래에서 확인할 수 있어요.' : '서비스 연결 상태를 확인하고 있어요.'}
                </p>
              </div>
            </div>
          </div>

          {/* Dependencies Breakdown */}
          <div className="mt-2 space-y-1.5 max-h-60 overflow-y-auto pr-1">
            {report?.dependencies && report.dependencies.length > 0 ? (
              report.dependencies.map((dep: DependencyItem) => {
                const statusColor =
                  dep.status === 'HEALTHY'
                    ? 'text-state-ok bg-state-ok-soft border-state-ok/30'
                    : dep.status === 'DEGRADED'
                    ? 'text-state-warn bg-state-warn-soft border-state-warn/30'
                    : 'text-state-danger bg-state-danger-soft border-state-danger/30'

                const statusText =
                  dep.status === 'HEALTHY' ? '정상' : dep.status === 'DEGRADED' ? '지연' : '차단'

                return (
                  <div
                    key={dep.key}
                    className="flex items-center justify-between p-2 rounded-xl bg-[var(--v088-surface-subtle)] border border-[var(--v088-border)] text-xs"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="font-semibold text-[var(--v088-ink)]">{dep.name}</span>
                      <span className="text-[10px] text-[var(--v088-muted)]">{dep.status === 'HEALTHY' ? '정상적으로 연결되어 있어요.' : dep.status === 'DEGRADED' ? '응답이 잠시 느려요.' : '연결 상태를 확인해 주세요.'}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] text-[var(--v088-muted)]">{dep.latencyMs}ms</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${statusColor}`}
                      >
                        {statusText}
                      </span>
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="text-center py-4 text-xs text-[var(--v088-muted)]">
                연결 정보를 불러오고 있어요.
              </div>
            )}
          </div>

          {/* Footer Note */}
          <div className="mt-3 pt-2 border-t border-[var(--v088-border)] flex items-center justify-between text-[10px] text-[var(--v088-muted)]">
            <span>마지막 확인 결과</span>
            {report?.checkedAt && (
              <span>확인: {new Date(report.checkedAt).toLocaleTimeString('ko-KR')}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
