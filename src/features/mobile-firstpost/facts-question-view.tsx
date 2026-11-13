'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  FACT_FIELDS,
  FACT_QUESTIONS,
  FACT_ANSWER_MAX_LENGTH,
  type FactField,
  type FactEntry,
  seedConfirmedFacts,
  nextFactField,
  pendingProposal,
  submitFactAnswer,
  confirmFact,
  discardProposal,
  skipFact,
  canProceed,
  usableFactValues,
  factProgress,
} from './facts'

export interface FactsQuestionViewProps {
  /** 기존 서버에 등록된 사업장 기억. 초기 확정(CONFIRMED) 상태로 시작한다. */
  initialMemory?: Partial<Record<FactField, string>>
  /** 진행 중이던 사실 목록. initialMemory 보다 우선하며, 두 prop 이 모두 주어지면 결합한다. */
  initialFacts?: readonly FactEntry[]
  /** 로컬 사실 상태가 바뀔 때 호출 (서버 저장이 아니며 로컬 상태 전이 알림). */
  onChange?: (facts: readonly FactEntry[]) => void
  /**
   * 모든 항목이 확인/건너뜀 되었을 때 호출.
   * 부모가 전달하지 않으면 완료 버튼은 비활성화된다 (서버 저장 미배선 방어).
   */
  onComplete?: (usableFacts: Partial<Record<FactField, string>>) => void
}

const FIELD_TITLES: Record<FactField, string> = {
  price: '가격',
  menu: '메뉴 / 서비스',
  hours: '영업시간',
  eventPeriod: '이벤트 기간',
  contact: '문의 / 예약',
}

/** initialMemory(기본)와 initialFacts(상위 우선)를 안전하게 병합한다. */
function mergeInitialFacts(
  memory?: Partial<Record<FactField, string>>,
  facts?: readonly FactEntry[],
): readonly FactEntry[] {
  const base = memory ? seedConfirmedFacts(memory) : []
  if (!facts || facts.length === 0) return base

  const map = new Map<FactField, FactEntry>()
  for (const entry of base) {
    map.set(entry.field, entry)
  }
  // initialFacts 가 같은 필드를 덮어쓰거나 새 필드를 추가한다
  for (const entry of facts) {
    map.set(entry.field, entry)
  }

  return [...map.values()].sort(
    (a, b) => FACT_FIELDS.indexOf(a.field) - FACT_FIELDS.indexOf(b.field),
  )
}

export function FactsQuestionView({
  initialMemory,
  initialFacts,
  onChange,
  onComplete,
}: FactsQuestionViewProps) {
  const [facts, setFacts] = useState<readonly FactEntry[]>(() =>
    mergeInitialFacts(initialMemory, initialFacts),
  )

  const [answerInput, setAnswerInput] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isCompleted, setIsCompleted] = useState(false)

  // 접근성: 섹션 전환/질문 변경 시 포커스가 소실되지 않도록 새 헤딩에 포커스 이동
  const activeHeadingRef = useRef<HTMLHeadingElement | null>(null)

  const proposal = pendingProposal(facts)
  const currentField = nextFactField(facts)
  const done = canProceed(facts)
  const confirmedList = facts.filter((f) => f.status === 'CONFIRMED')
  const progress = factProgress(facts)

  // 질문 항목 또는 제안 상태가 바뀔 때 활성 헤딩으로 포커스 복귀
  useEffect(() => {
    activeHeadingRef.current?.focus()
  }, [proposal?.field, currentField, done])

  const updateFacts = (next: readonly FactEntry[]) => {
    setFacts(next)
    setAnswerInput('')
    setErrorMessage(null)
    onChange?.(next)
  }

  const handleSubmitAnswer = () => {
    if (!currentField) return
    if (!answerInput.trim()) {
      setErrorMessage('알릴 내용을 입력해 주세요.')
      return
    }
    if (answerInput.length > FACT_ANSWER_MAX_LENGTH) {
      setErrorMessage(`답변은 ${FACT_ANSWER_MAX_LENGTH}자 이내로 입력해 주세요.`)
      return
    }

    const mutation = submitFactAnswer(facts, currentField, answerInput)
    if (!mutation.ok) {
      if (mutation.reason === 'TOO_LONG') {
        setErrorMessage(`답변은 ${FACT_ANSWER_MAX_LENGTH}자 이내로 입력해 주세요.`)
      } else {
        setErrorMessage('답변을 확인하지 못했어요.')
      }
      return
    }
    updateFacts(mutation.state)
  }

  const handleConfirmProposal = () => {
    if (!proposal) return
    const mutation = confirmFact(facts, proposal.field)
    if (mutation.ok) {
      updateFacts(mutation.state)
    }
  }

  const handleDiscardProposal = () => {
    if (!proposal) return
    const mutation = discardProposal(facts, proposal.field)
    if (mutation.ok) {
      updateFacts(mutation.state)
    }
  }

  const handleSkipField = () => {
    if (!currentField) return
    const mutation = skipFact(facts, currentField)
    if (mutation.ok) {
      updateFacts(mutation.state)
    }
  }

  const handleFinish = () => {
    if (isCompleted || !onComplete) return
    setIsCompleted(true)
    onComplete(usableFactValues(facts))
  }

  return (
    <div className="mx-auto max-w-md space-y-5 px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">소희의 사실 확인</h1>
        <p className="text-sm text-muted-foreground">
          정확한 홍보를 위해 누락된 사실만 확인할게요. 추정으로 거짓 내용을 만들지 않아요.
        </p>
      </header>

      {/* 1. 이번 초안에서 확인된 내용 (로컬 선택+기존 기억 통합, 서버 영구 등록 오인 방지) */}
      {confirmedList.length > 0 && (
        <section aria-label="이번 초안에서 확인한 내용" className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>이번 초안에서 확인한 내용</span>
            <span>{confirmedList.length}건 확인</span>
          </div>
          <ul className="divide-y divide-border/50 text-sm">
            {confirmedList.map((entry) => (
              <li key={entry.field} className="py-2 first:pt-0 last:pb-0 flex items-start justify-between gap-3">
                <span className="font-medium text-foreground min-w-20">{FIELD_TITLES[entry.field]}</span>
                <span className="text-muted-foreground text-right">{entry.value}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 2. 이번 초안용 사용자 확인 대기 제안 (서버 영구 저장이 아닌 로컬 초안 준비용 정직한 문구) */}
      {proposal && (
        <section aria-label="소희의 제안 확인" className="rounded-lg border-2 border-primary/30 bg-primary/5 p-4 space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold text-primary">
            <h2
              ref={activeHeadingRef}
              tabIndex={-1}
              className="text-xs font-semibold text-primary outline-none focus-visible:ring-1 focus-visible:ring-ring flex items-center gap-1.5"
            >
              <span>소희의 제안</span>
              <span className="font-normal text-muted-foreground">({FIELD_TITLES[proposal.field]})</span>
            </h2>
            <span>확인 대기</span>
          </div>
          <p className="text-base font-medium text-foreground break-keep">{proposal.value}</p>
          <p className="text-xs text-muted-foreground">
            이번 홍보 초안 작성에만 사용되며, 서버 저장이나 영구 변경은 별도 승인 후 진행됩니다.
          </p>
          <div className="flex flex-col gap-2 pt-2">
            <Button
              type="button"
              className="min-h-11 w-full"
              onClick={handleConfirmProposal}
            >
              이 내용으로 초안 준비
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 w-full"
              onClick={handleDiscardProposal}
            >
              다시 작성
            </Button>
          </div>
        </section>
      )}

      {/* 3. 누락 질문 입력 화면 (접근성: aria-invalid, aria-describedby, tabIndex=-1 헤딩 포커스) */}
      {!proposal && currentField && (
        <section aria-label="누락 사실 질문" className="rounded-lg border bg-card p-4 space-y-4">
          <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>{FIELD_TITLES[currentField]} 확인</span>
            <span>남은 질문 {progress.remaining}개</span>
          </div>

          <h2
            ref={activeHeadingRef}
            tabIndex={-1}
            className="text-lg font-semibold tracking-tight text-foreground break-keep outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {FACT_QUESTIONS[currentField]}
          </h2>

          <div className="space-y-1.5">
            <Label htmlFor="fact-answer-input">답변 입력</Label>
            <Textarea
              id="fact-answer-input"
              className="min-h-24 text-base"
              placeholder="예: 컷 25,000원 / 매일 10:00 - 20:00 등"
              value={answerInput}
              maxLength={FACT_ANSWER_MAX_LENGTH + 10}
              aria-invalid={Boolean(errorMessage)}
              aria-describedby={errorMessage ? 'fact-error-msg' : undefined}
              onChange={(e) => {
                setAnswerInput(e.target.value)
                if (errorMessage) setErrorMessage(null)
              }}
            />
            <div className="flex justify-between text-xs text-muted-foreground pt-1">
              <span>답변은 소희의 수정 제안을 거쳐 반영됩니다.</span>
              <span className={answerInput.length > FACT_ANSWER_MAX_LENGTH ? 'text-destructive font-semibold' : ''}>
                {answerInput.length}/{FACT_ANSWER_MAX_LENGTH}
              </span>
            </div>
          </div>

          {errorMessage && (
            <p id="fact-error-msg" role="alert" className="text-sm text-destructive font-medium">
              {errorMessage}
            </p>
          )}

          <div className="space-y-2 pt-2">
            <Button
              type="button"
              className="min-h-11 w-full"
              disabled={!answerInput.trim()}
              onClick={handleSubmitAnswer}
            >
              소희에게 제안하기
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 w-full text-muted-foreground"
              onClick={handleSkipField}
            >
              해당 정보 없이 진행
            </Button>
          </div>
        </section>
      )}

      {/* 4. 모든 질문 완료 */}
      {done && (
        <section aria-label="사실 확인 완료" className="rounded-lg border bg-card p-5 space-y-4 text-center">
          <div className="space-y-1">
            <h2
              ref={activeHeadingRef}
              tabIndex={-1}
              className="text-lg font-semibold tracking-tight text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              모든 사실 확인이 끝났어요
            </h2>
            <p className="text-sm text-muted-foreground">
              확인된 기억만 홍보 문구에 사용되며, 건너뛴 항목은 임의로 지어내지 않아요.
            </p>
          </div>
          <Button
            type="button"
            className="min-h-11 w-full"
            disabled={!onComplete || isCompleted}
            onClick={handleFinish}
          >
            홍보 초안 만들기
          </Button>
          {!onComplete && (
            <p className="text-xs text-state-warn">
              다음 단계가 연결되지 않았습니다 (서버 저장 미배선).
            </p>
          )}
        </section>
      )}
    </div>
  )
}
