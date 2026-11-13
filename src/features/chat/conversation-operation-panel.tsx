'use client'

import { useEffect, useRef, useState } from 'react'
import { BookOpen, X } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { ConversationOperationCatalogView } from './conversation-operation-catalog-view'
import { parseConversationOperationCatalog, type ConversationOperation, type ConversationOperationCatalog } from './conversation-operation-catalog'

export function ConversationOperationPanel({ workspaceId, onChoose, initialCatalog, readOnlyReason }: {
  workspaceId: string
  onChoose: (operation: ConversationOperation) => void
  initialCatalog?: ConversationOperationCatalog
  readOnlyReason?: string
}) {
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<ConversationOperationCatalog | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const sequence = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const chosen = useRef(false)
  useEffect(() => () => { sequence.current += 1; controller.current?.abort() }, [])
  const visible = initialCatalog?.workspaceId === workspaceId ? initialCatalog : catalog?.workspaceId === workspaceId ? catalog : null

  async function load() {
    controller.current?.abort()
    const current = ++sequence.current
    const abort = new AbortController()
    controller.current = abort
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/conversation-capabilities`, { cache: 'no-store', signal: abort.signal })
      if (!response.ok) throw new Error('CATALOG_UNAVAILABLE')
      const body = await response.json()
      const data = parseConversationOperationCatalog(body.data, workspaceId)
      if (current === sequence.current) setCatalog(data)
    } catch {
      if (current === sequence.current && !abort.signal.aborted) setError('업무 준비 상태를 조회하지 못했어요.')
    } finally {
      if (current === sequence.current) setLoading(false)
    }
  }
  function changeOpen(next: boolean) {
    setOpen(next)
    if (next) { chosen.current = false; if (!initialCatalog || initialCatalog.workspaceId !== workspaceId) void load() }
    else { sequence.current += 1; controller.current?.abort() }
  }
  function choose(operation: ConversationOperation) {
    if (!visible || readOnlyReason || visible.role === 'viewer' || !operation.canAsk) return
    chosen.current = true
    onChoose(operation)
    changeOpen(false)
  }
  return <Sheet open={open} onOpenChange={changeOpen}>
    <SheetTrigger asChild><Button variant="outline" className="min-h-11" aria-label="소희가 할 수 있는 일 열기"><BookOpen aria-hidden="true" data-icon="inline-start" />할 수 있는 일</Button></SheetTrigger>
    <SheetContent className="w-full sm:max-w-6xl overflow-y-auto" onCloseAutoFocus={event => {
      const composer = chosen.current ? document.querySelector<HTMLTextAreaElement>('[data-conversation-workspace] textarea') : null
      if (composer) { event.preventDefault(); composer.focus() }
    }}>
      <div className="flex items-start justify-between gap-4">
        <SheetHeader><SheetTitle>소희가 할 수 있는 일</SheetTitle><SheetDescription>대화를 떠나지 않고 업무와 실제 준비 상태를 확인하세요. 선택해도 아직 전송되지 않아요.</SheetDescription></SheetHeader>
        <SheetClose asChild><Button variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label="업무 탐색 닫기"><X aria-hidden="true" /></Button></SheetClose>
      </div>
      {readOnlyReason ? <Alert role="status"><AlertDescription>{readOnlyReason}</AlertDescription></Alert> : null}
      {loading ? <p role="status">현재 가게의 업무 준비 상태를 확인하고 있어요.</p> : error ? <Alert><AlertTitle>{error}</AlertTitle><AlertDescription>조회 실패를 연결 없음으로 표시하지 않았어요.<Button variant="outline" onClick={() => void load()}>다시 조회</Button></AlertDescription></Alert>
        : visible ? <ConversationOperationCatalogView embedded catalog={visible} onSelect={readOnlyReason ? undefined : choose} /> : null}
    </SheetContent>
  </Sheet>
}
