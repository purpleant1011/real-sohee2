'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { AppLink } from '@/components/navigation/app-link'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useWorkspaceId } from '@/hooks/use-workspace-context'
import { journalKinds, journalKindLabels, knowledgeJournalSchema, type KnowledgeJournal } from '../knowledge-journal'

const timeLabel = (value: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

export function KnowledgeJournalPanel({ workspaceId, initialJournal }: Readonly<{ workspaceId: string; initialJournal?: KnowledgeJournal }>) {
  const currentWorkspaceId = useWorkspaceId()
  const matchesScope = workspaceId === currentWorkspaceId
  const [data, setData] = useState<KnowledgeJournal | null>(initialJournal?.workspaceId === workspaceId ? initialJournal : null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [filter, setFilter] = useState<'all' | KnowledgeJournal['entries'][number]['kind']>('all')
  const generation = useRef(0)
  const reader = useRef<AbortController | null>(null)
  const load = useCallback(async () => {
    if (!matchesScope) return
    reader.current?.abort()
    const controller = new AbortController()
    reader.current = controller
    const current = ++generation.current
    setState('loading')
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/sohee-studio/journal`, { method: 'GET', cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw new Error('KNOWLEDGE_JOURNAL_UNAVAILABLE')
      const payload = await response.json() as { data?: unknown }
      const journal = knowledgeJournalSchema.parse(payload.data)
      if (journal.workspaceId !== workspaceId) throw new Error('KNOWLEDGE_JOURNAL_SCOPE_MISMATCH')
      if (controller.signal.aborted || current !== generation.current) return
      setData(journal); setState('ready')
    } catch {
      if (controller.signal.aborted || current !== generation.current) return
      setData(null); setState('error')
    }
  }, [workspaceId, matchesScope])
  useEffect(() => {
    setFilter('all')
    if (initialJournal?.workspaceId === workspaceId && matchesScope) {
      const parsed = knowledgeJournalSchema.safeParse(initialJournal)
      setData(parsed.success ? parsed.data : null); setState(parsed.success ? 'ready' : 'error')
    } else { setData(null); void load() }
    return () => { generation.current += 1; reader.current?.abort() }
  }, [workspaceId, matchesScope, initialJournal, load])
  const current = matchesScope && data?.workspaceId === workspaceId ? data : null
  const entries = current?.entries.filter(entry => filter === 'all' || entry.kind === filter) ?? []
  const unavailable = [...new Set(current?.sources.filter(source => source.state === 'unavailable').map(source => journalKindLabels[source.kind]) ?? [])]

  return <section aria-label="지식·업무 일지" className="flex min-w-0 flex-col gap-4">
    <header className="flex flex-wrap items-start justify-between gap-2">
      <div><h3 className="font-semibold">지시·업무·학습 일지</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">대화 지시와 실제 업무·설정·검토 기록을 원본에 연결해 살펴봐요.</p></div>
      <Button type="button" variant="ghost" size="sm" disabled={!matchesScope || state === 'loading'} onClick={() => { void load() }}><RefreshCw data-icon="inline-start" />새로고침</Button>
    </header>
    <details className="text-xs leading-relaxed text-muted-foreground"><summary className="min-h-11 cursor-pointer py-3">소희가 기록을 사용하는 기준</summary>
      <p>권한·안전 정책 → 승인된 운영 규칙과 유효 지식 → 현재 업무 지시·정본 일정과 자동화 → 과거 요청·관찰·검토 전 학습 후보 순서로 구분해요.</p>
      <p className="mt-2">일지에 기록됐다는 사실만으로 자동 실행되거나 확정 지식이 되지는 않아요. 자동화 항목은 현재 설정 상태이며 모든 변경의 과거 버전을 복제한 기록은 아니에요.</p>
    </details>
    <Select value={filter} onValueChange={value => { if (value === 'all' || journalKinds.includes(value as typeof journalKinds[number])) setFilter(value as typeof filter) }}>
      <SelectTrigger aria-label="기록 종류"><SelectValue /></SelectTrigger>
      <SelectContent><SelectGroup><SelectItem value="all">모든 기록</SelectItem>{journalKinds.map(kind => <SelectItem key={kind} value={kind}>{journalKindLabels[kind]}</SelectItem>)}</SelectGroup></SelectContent>
    </Select>
    {!matchesScope ? <Alert><AlertDescription>현재 가게의 지식 일지를 다시 열어 주세요.</AlertDescription></Alert>
      : state === 'loading' ? <p role="status" className="text-sm text-muted-foreground">저장된 원본 기록을 확인하고 있어요.</p>
      : state === 'error' ? <Alert variant="destructive"><AlertDescription>기록을 불러오지 못했어요. 접근 권한과 연결 상태를 확인한 뒤 다시 조회해 주세요.</AlertDescription></Alert> : null}
    {current && state === 'ready' ? <>
      {unavailable.length ? <Alert><AlertDescription>일부 자료를 확인하지 못했어요: {unavailable.join(', ')}. 확인한 기록만 표시하며 빈 기록으로 처리하지 않아요.</AlertDescription></Alert> : null}
      <ol aria-label="지식 일지 기록" className="flex flex-col gap-4">
        {entries.map(entry => <li key={entry.id} className="min-w-0 border-b border-border pb-4">
          <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{journalKindLabels[entry.kind]}</Badge><Badge variant="secondary">{entry.statusLabel}</Badge></div>
          <h4 className="mt-2 break-words text-sm font-semibold">{entry.title}</h4>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{entry.summary}</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><time dateTime={entry.occurredAt}>{timeLabel(entry.occurredAt)}</time><AppLink href={entry.href} className="inline-flex min-h-11 items-center underline underline-offset-4">원본 보기</AppLink></div>
        </li>)}
      </ol>
      {!entries.length ? <p className="text-sm text-muted-foreground">{unavailable.length ? '확인하지 못한 자료가 있어 기록 유무를 단정하지 않아요.' : filter === 'all' ? '아직 연결된 기록이 없어요.' : '최근 조회 범위에서 선택한 종류의 기록이 없어요.'}</p> : null}
      <p className="text-xs leading-relaxed text-muted-foreground">{current.partial ? '최근 일부 기록만 표시하고 있어요. ' : '현재 조회 범위의 기록이에요. '}전체 대화·일정·자동화와 최신 상태는 원본에서 확인해 주세요.</p>
    </> : null}
  </section>
}
