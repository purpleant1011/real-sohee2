'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, PauseCircle, ShieldAlert } from 'lucide-react'
import type { WorkboardSnapshot } from '@/features/agent-os/workboard-types'

interface Props {
  workspaceId: string
}

type WorkboardLite = Pick<WorkboardSnapshot, 'runtimeState' | 'ownerActionRequiredCount'>

/** 평소에는 비어 있고, 멈춤·차단·승인 대기가 있을 때만 한 줄로 알려준다. */
export function StatusLine({ workspaceId }: Props) {
  const [data, setData] = useState<WorkboardLite | null>(null)

  useEffect(() => {
    if (!workspaceId) return
    let alive = true
    fetch(`/api/workspaces/${workspaceId}/agent/workboard?_t=${Date.now()}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (alive) setData((json?.data ?? json ?? null) as WorkboardLite | null)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [workspaceId])

  if (!data) return null

  const lines: Array<{ key: string; icon: React.ReactNode; text: string; tone: string }> = []
  if (data.runtimeState === 'BLOCKED') {
    lines.push({
      key: 'blocked',
      icon: <ShieldAlert className="size-4" aria-hidden />,
      text: '안전 규칙에 따라 업무가 멈췄어요. 멈춘 이유를 소희와 대화해서 확인해 주세요.',
      tone: 'border-destructive/30 bg-destructive/5 text-destructive',
    })
  } else if (data.runtimeState === 'PAUSED') {
    lines.push({
      key: 'paused',
      icon: <PauseCircle className="size-4" aria-hidden />,
      text: '소희의 업무가 잠시 멈췄어요.',
      tone: 'border-border bg-muted text-muted-foreground',
    })
  }
  if ((data.ownerActionRequiredCount ?? 0) > 0) {
    lines.push({
      key: 'approvals',
      icon: <AlertTriangle className="size-4" aria-hidden />,
      text: `사장님의 승인이 필요한 일이 ${data.ownerActionRequiredCount}건 있어요.`,
      tone: 'border-state-warn/30 bg-state-warn/10 text-state-warn',
    })
  }
  if (lines.length === 0) return null

  return (
    <div className="space-y-2" role="status" aria-live="polite">
      {lines.map((line) => (
        <p key={line.key} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${line.tone}`}>
          {line.icon}
          <span>{line.text}</span>
        </p>
      ))}
    </div>
  )
}
