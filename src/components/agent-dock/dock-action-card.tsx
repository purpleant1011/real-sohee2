'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { parseDockActions } from '@/features/agent-intent/dock-actions'

interface DockActionCardProps {
  workspaceId: string
  actions: unknown
  onOpenReservation?: (data: { customerName: string; customerPhone?: string; suggestedTime?: string; serviceName?: string }) => void
}

export function DockActionCard({ workspaceId, actions, onOpenReservation }: DockActionCardProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const safeActions = parseDockActions(actions)
  if (!safeActions.length) return null

  async function createPost(topic: string) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/quick-post`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : '초안을 만들지 못했어요. 잠시 후 다시 시도해 주세요.')
      // Content hub currently selects its first (newest) item; explicit selection requires a hub follow-up.
      router.push('/app/content?post=' + encodeURIComponent(data.item.missionId))
    } catch (err) {
      setError(err instanceof Error ? err.message : '초안을 만들지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  async function pauseMission(missionId: string) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/missions/${encodeURIComponent(missionId)}/pause`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: '사용자 채팅 요청에 따른 일시정지' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : '작업을 일시 정지하지 못했습니다.')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '작업을 일시 정지하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-border bg-muted/40 p-2.5" aria-label="소희가 제안한 다음 단계">
      {safeActions.map((action, index) => {
        let label: string
        let hint: string
        let onClick: () => void
        switch (action.type) {
          case 'navigate':
            label = action.path === '/app/content' ? '콘텐츠로 이동' : '화면으로 이동'
            hint = '버튼을 누르면 해당 화면으로 이동해요.'
            onClick = () => router.push(action.path)
            break
          case 'create_post':
            label = '이 주제로 초안 만들기'
            hint = `주제: ${action.topic} · 글과 사진 초안을 생성해요. 발행은 하지 않아요.`
            onClick = () => { void createPost(action.topic) }
            break
          case 'open_content':
            label = '콘텐츠에서 확인하기'
            hint = '발행은 콘텐츠 화면에서 미리보기를 본 뒤 사장님이 직접 승인해요.'
            onClick = () => router.push(action.missionId ? `/app/content?post=${encodeURIComponent(action.missionId)}` : '/app/content')
            break
          case 'connect_channel':
            label = `${action.channel === 'instagram' ? '인스타그램' : '스레드'} 연결 화면 열기`
            hint = '계정 연결은 사장님이 직접 진행해요.'
            onClick = () => router.push('/start?step=channels')
            break
          case 'show_results':
            label = '성과 보러 가기'
            hint = '성과 화면으로 이동해요.'
            onClick = () => router.push('/app/results')
            break
          case 'register_reservation':
            label = `📅 ${action.customerName} 고객 예약 등록하기`
            hint = `${action.customerName} 고객님의 문의를 예약으로 등록해요.`
            onClick = () => {
              if (onOpenReservation) {
                onOpenReservation({
                  customerName: action.customerName,
                  customerPhone: action.customerPhone,
                  suggestedTime: action.suggestedTime,
                  serviceName: action.serviceName,
                })
              } else {
                router.push('/app/customers')
              }
            }
            break
          case 'pause_mission':
            label = '작업 일시 정지하기'
            hint = '작업을 일시 정지해요. 언제든 다시 시작할 수 있어요.'
            onClick = () => { void pauseMission(action.missionId) }
            break
          case 'propose_plan_diff': {
            label = '계획 변경안 검토하기'
            const prompt = action.rawQuery || action.description
            hint = prompt ? `"${prompt}" 내용으로 계획 변경안을 검토해요.` : '계획 변경안을 확인하고 직접 승인해요.'
            const targetUrl = prompt
              ? `/app/missions/${encodeURIComponent(action.missionId)}?planPrompt=${encodeURIComponent(prompt)}`
              : `/app/missions/${encodeURIComponent(action.missionId)}`
            onClick = () => { router.push(targetUrl) }
            break
          }
        }
        return (
          <div key={`${action.type}-${index}`} className="space-y-1">
            <p className="text-[11px] text-muted-foreground">{hint}</p>
            <Button type="button" variant="outline" size="sm" className="w-full justify-start text-xs" disabled={busy} onClick={onClick}>
              {busy && action.type === 'create_post'
                ? '초안 만드는 중…'
                : busy && action.type === 'pause_mission'
                  ? '일시 정지 처리 중…'
                  : label}
            </Button>
          </div>
        )
      })}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
