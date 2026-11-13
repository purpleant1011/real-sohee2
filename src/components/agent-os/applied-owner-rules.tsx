import React from 'react'
import type { AppliedRule } from '@/features/agent-os/workboard-types'
import { cn } from '@/lib/utils'
import { BookOpen, ShieldCheck, FileCheck, Sliders } from 'lucide-react'

interface AppliedOwnerRulesProps {
  rules: AppliedRule[]
  className?: string
}

export function AppliedOwnerRules({ rules, className }: AppliedOwnerRulesProps) {
  if (!rules || rules.length === 0) {
    return (
      <div className={cn('text-xs text-zinc-400 dark:text-zinc-500 italic', className)}>
        적용 중인 특화 지시사항 없음 (기본 안전 가이드 준수)
      </div>
    )
  }

  const getSourceIcon = (sourceType: AppliedRule['sourceType']) => {
    switch (sourceType) {
      case 'HARNESS':
        return <BookOpen className="w-3.5 h-3.5 text-primary" />
      case 'CHARTER':
        return <ShieldCheck className="w-3.5 h-3.5 text-state-ok" />
      case 'POLICY':
        return <Sliders className="w-3.5 h-3.5 text-state-warn" />
      case 'BUSINESS_TRUTH':
      default:
        return <FileCheck className="w-3.5 h-3.5 text-state-wait" />
    }
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {rules.map((rule) => (
        <div
          key={rule.id}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-white dark:bg-zinc-800/80 border border-zinc-200/80 dark:border-zinc-700/70 text-zinc-800 dark:text-zinc-200 shadow-2xs group"
          title="소희에게 알려주신 업무 기준"
        >
          {getSourceIcon(rule.sourceType)}
          <span>{rule.label}</span>
        </div>
      ))}
    </div>
  )
}
