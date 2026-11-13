'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { BlogStrategyProposal } from './blog-strategy-proposal'
import { BlogStrategyBriefing } from './blog-strategy-briefing'

type Reference = NonNullable<BlogStrategyProposal['reference']>
const messages: Record<string, string> = {
  MARKETING_STRATEGY_RUN_REQUIRED: '이 대화에 연결할 업무가 아직 없어요. 먼저 업무 계획을 만들어 주세요.',
  MARKETING_STRATEGY_MISSION_REQUIRED: '이 대화에 연결할 업무 계획을 먼저 확인해 주세요.',
  MARKETING_STRATEGY_GOAL_REQUIRED: '연결할 사업 목표를 하나 정해 주세요. 안내 원고는 목표 연결 없이도 준비할 수 있어요.',
  MARKETING_STRATEGY_FACTS_REQUIRED: '사용할 수 있는 승인된 가게 정보가 없어요. 가게 정보를 확인해 주세요.',
  MARKETING_STRATEGY_STALE: '가게 정보나 목표, 선택 내용이 바뀌었어요. 최신 정보로 다시 정해야 해요.',
  MARKETING_STRATEGY_CONFLICT: '다른 곳에서 선택 내용을 바꿨어요. 다시 열어 최신 내용을 확인해 주세요.',
  MARKETING_STRATEGY_FORBIDDEN: '사장님 계정에서 가게 사실과 전략을 승인해 주세요.',
  MARKETING_STRATEGY_CONTROL_BLOCKED: '지금은 중지된 업무예요. 업무 상태를 먼저 확인해 주세요.',
}

export function BlogStrategyCard({ workspaceId, threadId, requestToken = 0, disabled = false, onGenerate, onPrepareOnly, onReplyHandlerChange }: {
  workspaceId: string; threadId: string; requestToken?: number; disabled?: boolean;
  onGenerate(reference: Reference): Promise<boolean>
  onPrepareOnly?(): Promise<boolean>
  onReplyHandlerChange?(handler: ((text: string) => Promise<boolean>) | null): void
}) {
  const [proposal, setProposal] = useState<BlogStrategyProposal | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [audience, setAudience] = useState('')
  const [constraints, setConstraints] = useState('')
  const [outcome, setOutcome] = useState<'valid_inquiry' | 'confirmed_booking' | 'verified_sale'>('valid_inquiry')
  const [confirmed, setConfirmed] = useState(false)
  const [credits, setCredits] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [preparationRequested, setPreparationRequested] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const pending = useRef(false)
  const seenRequest = useRef(0)
  const decisionVersion = useRef(0)
  const approvedKeyword = proposal?.status === 'approved' && proposal.selectedIndex !== null && proposal.topics[proposal.selectedIndex]?.primaryKeyword
    ? proposal.topics[proposal.selectedIndex] : null
  const dirty = proposal !== null && (selected !== proposal.selectedIndex || audience !== proposal.audience || constraints !== proposal.constraints)

  function restore(data: BlogStrategyProposal, generationCredits?: number) {
    setProposal(data)
    setSelected(data.selectedIndex)
    setAudience(data.audience)
    setConstraints(data.constraints)
    setCredits(Number.isSafeInteger(generationCredits) && generationCredits! > 0 ? generationCredits! : null)
    setConfirmed(false)
    setBlocked(false)
  }

  useEffect(() => {
    const controller = new AbortController()
    const version = decisionVersion.current
    void (async () => {
      try {
        const response = await fetch(`/api/workspaces/${workspaceId}/conversations/${threadId}/blog-strategy`, {
          method: 'GET', cache: 'no-store', signal: controller.signal,
        })
        const payload = await response.json() as { data?: BlogStrategyProposal | null; generationCredits?: number; error?: { code?: string } }
        if (controller.signal.aborted || decisionVersion.current !== version) return
        if (!response.ok || payload.data === undefined) throw new Error(payload.error?.code ?? 'UNAVAILABLE')
        if (payload.data) restore(payload.data, payload.generationCredits)
      } catch (caught) {
        if (controller.signal.aborted || decisionVersion.current !== version) return
        setRecoveryCode(caught instanceof Error ? caught.message : '')
        setError(messages[caught instanceof Error ? caught.message : ''] ?? '저장한 전략을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.')
        setBlocked(true)
      }
    })()
    return () => controller.abort()
  }, [workspaceId, threadId])

  async function decide(decision: object) {
    if (pending.current || disabled) return false
    decisionVersion.current += 1
    pending.current = true
    setBusy(true)
    setError('')
    setRecoveryCode('')
    setPreparationRequested(false)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/conversations/${threadId}/blog-strategy`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(decision),
      })
      const payload = await response.json() as { data?: BlogStrategyProposal; generationCredits?: number; error?: { code?: string } }
      if (!response.ok || !payload.data) throw new Error(payload.error?.code ?? 'UNAVAILABLE')
      restore(payload.data, payload.generationCredits)
      return true
    } catch (caught) {
      setRecoveryCode(caught instanceof Error ? caught.message : '')
      setError(messages[caught instanceof Error ? caught.message : ''] ?? '주제와 전략을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
      setBlocked(true)
      return false
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  async function prepareOnly() {
    if (!onPrepareOnly || pending.current || disabled || recoveryCode !== 'MARKETING_STRATEGY_GOAL_REQUIRED') return
    pending.current = true
    setBusy(true)
    try {
      const accepted = await onPrepareOnly()
      if (accepted) setPreparationRequested(true)
      else setError('원고 준비 질문을 요청하지 못했어요. 잠시 후 다시 시도해 주세요.')
    } catch {
      setError('원고 준비 질문을 요청하지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  // Register only the current saved proposal; conversational replies cannot approve it.
  useEffect(() => {
    onReplyHandlerChange?.(proposal && !busy && !blocked && !disabled && proposal.status === 'proposed'
      ? reply => decide({ action: 'respond', proposalId: proposal.id, expectedRevision: proposal.revision, text: reply }) : null)
    return () => onReplyHandlerChange?.(null)
  })
  useEffect(() => {
    if (requestToken > seenRequest.current) {
      seenRequest.current = requestToken
      void decide({ action: 'open' })
    }
    // Only an explicit new conversation request opens this card; ordinary rerenders never send a write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestToken])

  if (preparationRequested) return <section aria-label="블로그 주제와 전략" className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-3">
    <p role="status">원고 준비 질문을 요청했어요. 사업 목표를 새로 등록하지 않았으며, 생성 전 가게 사실과 비용은 기존 확인 절차를 거쳐요.</p>
    <Button variant="outline" disabled={busy || disabled} onClick={() => void decide({ action: 'open' })}>사업 목표 연결 다시 확인</Button>
  </section>

  return <section aria-label="블로그 주제와 전략" className="mx-auto w-full max-w-3xl px-4 py-3">
    {!proposal ? <Button variant="outline" disabled={busy || disabled} onClick={() => void decide({ action: 'open' })}>블로그 주제 정하기</Button> :
      <Card>
        <CardHeader>
          <CardTitle><h2>어떤 주제로 안내할까요?</h2></CardTitle>
          <CardDescription>승인된 가게 정보로 만든 기본 주제예요. 검색 수요나 실제 고객 질문을 관측한 결과는 아니에요.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <BlogStrategyBriefing proposal={proposal} dirty={dirty} blocked={blocked} />
          <fieldset disabled={busy || disabled || blocked} className="flex flex-col gap-3">
            <legend>주제 하나 선택</legend>
            {proposal.topics.map((topic, index) => <label key={topic.title} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
              <input type="radio" name={`topic-${proposal.id}`} checked={selected === index} onChange={() => { setSelected(index); setConfirmed(false) }} aria-label={topic.title} />
              <span className="flex min-w-0 flex-col gap-2"><strong>{topic.title}</strong><span>근거: {topic.evidence.join(' / ')}</span>{topic.primaryKeyword ? <span>핵심 키워드: {topic.primaryKeyword}{topic.keywordStatus === 'OBSERVED' ? '' : ' (검색 수요 측정 전)'}</span> : null}{topic.keywordScore ? <span data-keyword-score>소희 내부 기준 {Math.round(topic.keywordScore.score)}점 · 근거 확인 범위 {Math.round(topic.keywordScore.coverage)}% (검색 수요나 노출 가능성이 아니에요)</span> : null}</span>
            </label>)}
          </fieldset>
          <div className="flex flex-col gap-2"><Label htmlFor={`audience-${proposal.id}`}>누구에게 안내할까요?</Label>
            <Input id={`audience-${proposal.id}`} maxLength={300} value={audience} disabled={busy || disabled || blocked} onChange={event => { setAudience(event.target.value); setConfirmed(false) }} /></div>
          <div className="flex flex-col gap-2"><Label htmlFor={`constraints-${proposal.id}`}>반영할 조건</Label>
            <Textarea id={`constraints-${proposal.id}`} maxLength={300} value={constraints} placeholder="예: 할인 내용 제외" disabled={busy || disabled || blocked} onChange={event => { setConstraints(event.target.value); setConfirmed(false) }} /></div>
          <Button variant="outline" disabled={busy || disabled || blocked || selected === null || !audience.trim() || !dirty} onClick={() => void decide({ action: 'select', proposalId: proposal.id,
            expectedRevision: proposal.revision, selectedIndex: selected, audience, constraints })}>선택·조건 저장</Button>
          {proposal.status !== 'approved' ? <>
            <div className="flex flex-col gap-2"><Label htmlFor={`outcome-${proposal.id}`}>이 글이 도울 사업 목표</Label>
              <select id={`outcome-${proposal.id}`} value={outcome} disabled={busy || disabled || blocked} onChange={event => { setOutcome(event.target.value as typeof outcome); setConfirmed(false) }} className="min-h-11 rounded-md border bg-background px-3">
                <option value="valid_inquiry">유효한 문의</option><option value="confirmed_booking">확정 예약</option><option value="verified_sale">확인 가능한 판매</option>
              </select></div>
            <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={confirmed} disabled={busy || disabled || blocked || dirty || selected === null} onChange={event => setConfirmed(event.target.checked)} />가게 사실과 목표를 확인했으며 이 전략을 승인해요.</label>
            <p className="text-sm text-muted-foreground">
              승인은 선택한 전략만 저장해요. 원고·이미지 생성이나 외부 게시는 실행하지 않아요.
            </p>
          </> : <p role="status">전략을 승인했어요. 원고 준비와 외부 게시 확인, 실제 사업 성과는 각각 별도예요.{approvedKeyword ? ` 원고 핵심 키워드: ${approvedKeyword.primaryKeyword}${approvedKeyword.keywordStatus === 'OBSERVED' ? '' : ' (검색 수요 측정 전)'}` : ''}</p>}
        </CardContent>
        <CardFooter className="flex flex-col items-stretch gap-3">
          <p>
            {credits === null
              ? '생성 비용을 확인하지 못해 지금은 원고를 준비할 수 없어요.'
              : '원고와 이미지를 준비할 수 있어요. 실행 직전 적용 기준을 다시 확인해요.'}
          </p>
          {proposal.status === 'approved' ? <>
            <Button disabled={busy || disabled || blocked || dirty || credits === null} onClick={async () => {
              if (!proposal.reference || pending.current) return
              pending.current = true; setBusy(true)
              try { await onGenerate(proposal.reference) } finally { pending.current = false; setBusy(false) }
            }}>승인한 전략으로 원고 준비</Button>
          </> : <Button disabled={busy || disabled || blocked || dirty || !confirmed || selected === null} onClick={() => void decide({ action: 'approve', proposalId: proposal.id,
            expectedRevision: proposal.revision, confirmed: true, outcome })}>이 전략 승인</Button>}
          <Button variant="ghost" disabled={busy || disabled} onClick={() => void decide({ action: 'open' })}>저장한 선택 다시 열기</Button>
        </CardFooter>
      </Card>}
    {error ? <div className="mt-3 flex flex-col gap-3"><p role="alert">{error}</p>
      {recoveryCode === 'MARKETING_STRATEGY_GOAL_REQUIRED' && onPrepareOnly ? <>
        <p className="text-sm text-muted-foreground">사업 목표 대신 주제와 사용할 가게 정보를 기존 원고 질문에서 확인해요. 이 선택만으로 원고·이미지를 생성하거나 게시하지 않아요.</p>
        <Button disabled={busy || disabled} onClick={() => void prepareOnly()}>목표 없이 원고 준비 질문 시작</Button>
      </> : null}
      <Button variant="outline" disabled={busy || disabled} onClick={() => void decide({ action: 'refresh' })}>최신 정보로 다시 제안</Button>
    </div> : null}
  </section>
}
