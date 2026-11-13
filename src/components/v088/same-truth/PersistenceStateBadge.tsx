'use client'

import React from 'react'

export type PersistenceState =
  | 'DIRTY'
  | 'SAVING'
  | 'PERSISTED'
  | 'READBACK_VERIFIED'
  | 'UNKNOWN_RESULT'
  | 'PERSISTENCE_FAILED'
  | 'DATA_INTEGRITY_ERROR'
  | 'REVOKED'

export interface PersistenceStateBadgeProps {
  state: PersistenceState
  className?: string
}

export function PersistenceStateBadge({ state, className = '' }: PersistenceStateBadgeProps) {
  switch (state) {
    case 'READBACK_VERIFIED':
      return (
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black bg-state-ok-soft text-state-ok border border-state-ok/40 ${className}`}>
          확인 완료
        </span>
      )
    case 'PERSISTED':
      return (
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold bg-state-wait-soft text-state-wait border border-state-wait/40 ${className}`}>
          저장 완료
        </span>
      )
    case 'SAVING':
      return (
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold bg-state-warn-soft text-state-warn animate-pulse ${className}`}>
          저장 중...
        </span>
      )
    case 'DIRTY':
      return (
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 ${className}`}>
          미저장
        </span>
      )
    case 'UNKNOWN_RESULT':
      return (
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black bg-state-warn-soft text-state-warn border border-state-warn/50 ${className}`}>
          결과 확인 대기
        </span>
      )
    case 'PERSISTENCE_FAILED':
    case 'DATA_INTEGRITY_ERROR':
      return (
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black bg-state-danger-soft text-state-danger border border-state-danger/50 ${className}`}>
          저장 오류
        </span>
      )
    case 'REVOKED':
      return (
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-200 dark:bg-zinc-800 text-zinc-500 line-through ${className}`}>
          철회됨
        </span>
      )
    default:
      return (
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono bg-zinc-100 text-zinc-600 ${className}`}>
          {state}
        </span>
      )
  }
}
