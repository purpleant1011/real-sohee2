'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { RecoveryCard } from '@/features/booking-recovery/components/recovery-card'
import type { RecoveryCommand, RecoveryView } from '@/features/booking-recovery/contracts'

export function RecoveryWorkflow({ workspaceId, view, messages, onCommand }: { workspaceId: string; view: RecoveryView; messages: Array<{ id: string; text: string }>; onCommand: (command: RecoveryCommand) => Promise<void> }) {
  const [slots, setSlots] = useState<Array<{ id: string; startsAt: string; serviceId: string }>>([])
  const [slotId, setSlotId] = useState('')
  const [messageId, setMessageId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function loadSlots() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/booking-recovery/availability`, { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok || !Array.isArray(body.slots) || body.slots.some((s: any) => s.workspaceId !== workspaceId || typeof s.id !== 'string' || typeof s.startsAt !== 'string')) throw new Error('예약 가능한 시간을 확인하지 못했어요.')
      setSlots(body.slots); setSlotId('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '시간 조회 실패') }
    finally { setBusy(false) }
  }
  async function run(command: RecoveryCommand) {
    if (busy) return
    setBusy(true); setError(null)
    try { await onCommand(command) } catch (reason) { setError(reason instanceof Error ? reason.message : '처리 상태를 확인하지 못했어요.') }
    finally { setBusy(false) }
  }
  const confirmedSlot = view.offer?.slotId ?? view.proposal?.slotId
  return <section className="min-w-0 space-y-4" aria-label="예약 문의 처리">
    <RecoveryCard view={view} onCommand={command => run(command)} isLoading={busy} />
    {view.nextAction === 'prepare_reply' ? <div className="space-y-3 rounded-xl border border-border p-4">
      <Button className="min-h-11 w-full" disabled={busy} onClick={() => void loadSlots()}>예약 가능한 시간 불러오기</Button>
      {slots.length ? <><label className="block text-sm" htmlFor="recovery-slot">서버에서 확인한 예약 시간</label><select id="recovery-slot" className="min-h-11 w-full min-w-0 rounded-md border bg-background p-2" value={slotId} disabled={busy} onChange={e => setSlotId(e.target.value)}><option value="">시간을 골라 주세요</option>{slots.map(slot => <option key={slot.id} value={slot.id}>{slot.startsAt}</option>)}</select><Button className="min-h-11 w-full" disabled={busy || !slotId} onClick={() => void run({ kind: 'prepare_reply', expectedVersion: view.version, slotId })}>이 시간으로 답안 준비</Button></> : <p className="text-sm text-muted-foreground">등록된 유효 시간이 없으면 일정에서 가능 시간을 먼저 확인해 주세요. 없는 시간은 만들지 않아요.</p>}
    </div> : null}
    {view.nextAction === 'confirm_acceptance' ? <div className="space-y-3 rounded-xl border border-border p-4"><label className="block text-sm" htmlFor="recovery-acceptance">고객이 수락한 원문 메시지</label><select id="recovery-acceptance" className="min-h-11 w-full min-w-0 rounded-md border bg-background p-2" value={messageId} disabled={busy} onChange={e => setMessageId(e.target.value)}><option value="">실제 받은 메시지를 골라 주세요</option>{messages.map(message => <option key={message.id} value={message.id}>{message.text.slice(0, 100)}</option>)}</select><p className="text-xs text-muted-foreground">선택만으로 수락이나 예약이 확정되지 않아요. 서버가 고객·시각·제안·슬롯을 검증해요.</p><Button className="min-h-11 w-full" disabled={busy || !messageId || !confirmedSlot} onClick={() => confirmedSlot && void run({ kind: 'confirm_acceptance', expectedVersion: view.version, inboundMessageId: messageId, slotId: confirmedSlot })}>서버에서 고객 수락 확인</Button></div> : null}
    {view.booking ? <Link className="inline-flex min-h-11 items-center underline" href="/app/schedule">예약 장부에서 실제 기록 확인</Link> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </section>
}
