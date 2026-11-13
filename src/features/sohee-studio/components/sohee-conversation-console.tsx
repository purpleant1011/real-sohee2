'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowUp,
  Edit3,
  HelpCircle,
  Lightbulb,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Target,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ProposalCard } from './proposal-card'
import type { CuriosityItem, KnowledgeView, StudioFocus, StudioTurnMessage } from '../types'

const WELCOME_MESSAGE: StudioTurnMessage = {
  id: 'welcome',
  sender: 'sohee',
  content:
    '사장님, 안녕하세요! 소희예요. 😊\n가게에 대해 새로운 정보가 생겼거나, 제가 잘못 기억하고 있는 내용이 있다면 언제든 편하게 말씀해 주세요. 사장님이 원하시는 사업 목표도 말씀해주시면 마케팅 방향에 적극 반영할게요!',
  timestamp: new Date().toISOString(),
  status: 'completed',
}

interface PendingSendContext {
  content: string
  clientMessageId: string
  focus?: StudioFocus
  relatedEntityId?: string
}

interface SoheeConversationConsoleProps {
  workspaceId: string
  onFactOrGoalConfirmed: () => void
  selectedCuriosityForAnswer?: CuriosityItem | null
  selectedKnowledgeForCorrection?: KnowledgeView | null
  goalRequestToken?: number
  onClearSelectedCuriosity?: () => void
  onClearSelectedCorrection?: () => void
}

export function SoheeConversationConsole({
  workspaceId,
  onFactOrGoalConfirmed,
  selectedCuriosityForAnswer,
  selectedKnowledgeForCorrection,
  goalRequestToken,
  onClearSelectedCuriosity,
  onClearSelectedCorrection,
}: SoheeConversationConsoleProps) {
  const [messages, setMessages] = useState<StudioTurnMessage[]>([WELCOME_MESSAGE])
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isLoadingTurns, setIsLoadingTurns] = useState(true)
  const [turnsError, setTurnsError] = useState<string | null>(null)
  const [activeFocus, setActiveFocus] = useState<StudioFocus>('teach')
  const [activeRelatedEntityId, setActiveRelatedEntityId] = useState<string | undefined>()
  const [failedTurnContext, setFailedTurnContext] = useState<PendingSendContext | null>(null)
  const [failureType, setFailureType] = useState<'network' | 'server' | 'streaming409' | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 1. 대화 GET /turns reload 복원
  const fetchTurns = useCallback(async () => {
    setIsLoadingTurns(true)
    setTurnsError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/sohee-studio/turns`)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const json = await res.json().catch(() => ({}))
      const turnList: StudioTurnMessage[] = Array.isArray(json)
        ? json
        : Array.isArray(json?.data)
          ? json.data
          : []

      if (turnList.length > 0) {
        setMessages((prev) => {
          const userSent = prev.filter((m) => m.sender === 'user')
          if (userSent.length > 0) {
            return turnList.concat(userSent)
          }
          return turnList
        })
      } else {
        setMessages((prev) => (prev.some((m) => m.sender === 'user') ? prev : [WELCOME_MESSAGE]))
      }
    } catch (err: any) {
      console.error('Failed to load turns:', err)
      setTurnsError('이전 대화 내역을 불러오지 못했습니다.')
    } finally {
      setIsLoadingTurns(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void fetchTurns()
  }, [fetchTurns])

  // 호기심 질문 선택 시 입력창에 프리셋 주입 및 focus/relatedEntityId 설정
  useEffect(() => {
    if (selectedCuriosityForAnswer) {
      setInput(`[답변] ${selectedCuriosityForAnswer.question}\n`)
      setActiveFocus('curiosity')
      setActiveRelatedEntityId(selectedCuriosityForAnswer.id)
      textareaRef.current?.focus()
    }
  }, [selectedCuriosityForAnswer])

  // 잘못된 지식 교정 선택 시 입력창에 프리셋 주입 및 focus/relatedEntityId 설정
  useEffect(() => {
    if (selectedKnowledgeForCorrection) {
      setInput(`"${selectedKnowledgeForCorrection.content}" 내용이 바뀌었어: `)
      setActiveFocus('inspect')
      setActiveRelatedEntityId(selectedKnowledgeForCorrection.id)
      textareaRef.current?.focus()
    }
  }, [selectedKnowledgeForCorrection])

  // 목표 지시 요청 토큰 수신 시 입력창 프리셋 주입 및 textarea 포커스
  useEffect(() => {
    if (goalRequestToken && goalRequestToken > 0) {
      setInput('이번 달에는 이런 목표를 꼭 달성하고 싶어: ')
      setActiveFocus('goal')
      setActiveRelatedEntityId(undefined)
      textareaRef.current?.focus()
    }
  }, [goalRequestToken])

  useEffect(() => {
    if (typeof scrollRef.current?.scrollIntoView === 'function') {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  const generateUuid = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  }

  const sendPayload = async (context: PendingSendContext) => {
    setIsSending(true)
    setFailedTurnContext(null)
    setFailureType(null)

    let responseStatus: number | null = null

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/sohee-studio/turns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: context.content,
          clientMessageId: context.clientMessageId,
          focus: context.focus || 'teach',
          relatedEntityId: context.relatedEntityId,
        }),
      })

      responseStatus = res.status

      if (res.status === 409) {
        setFailureType('streaming409')
        throw new Error('STREAMING_CONFLICT')
      }

      if (!res.ok) {
        setFailureType('server')
        throw new Error(`HTTP ${res.status}`)
      }

      const json = await res.json().catch(() => ({}))
      if (!json.success || !json.data) {
        setFailureType('server')
        throw new Error(json.message || '소희의 답변 생성 실패')
      }

      // 성공: 보낸 메시지 상태 완료로 갱신 & 소희 답변 추가
      setMessages((prev) =>
        prev
          .map((m) =>
            m.clientMessageId === context.clientMessageId ? { ...m, status: 'completed' as const } : m
          )
          .concat(json.data)
      )
    } catch (err: any) {
      console.error('Failed to send turn:', err)
      setFailedTurnContext(context)
      if (responseStatus === null) {
        setFailureType('network')
      }

      // 보낸 메시지 상태 실패로 갱신
      setMessages((prev) =>
        prev.map((m) =>
          m.clientMessageId === context.clientMessageId ? { ...m, status: 'failed' as const } : m
        )
      )
    } finally {
      setIsSending(false)
    }
  }

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend ?? input).trim()
    if (!text || isSending) return

    const clientMessageId = generateUuid()
    const focusToSend = activeFocus
    const relatedEntityIdToSend = activeRelatedEntityId

    const userMsg: StudioTurnMessage = {
      id: `user_${Date.now()}`,
      sender: 'user',
      content: text,
      timestamp: new Date().toISOString(),
      status: 'queued',
      focus: focusToSend,
      clientMessageId,
    }

    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setActiveFocus('teach')
    setActiveRelatedEntityId(undefined)

    if (selectedCuriosityForAnswer) onClearSelectedCuriosity?.()
    if (selectedKnowledgeForCorrection) onClearSelectedCorrection?.()

    await sendPayload({
      content: text,
      clientMessageId,
      focus: focusToSend,
      relatedEntityId: relatedEntityIdToSend,
    })
  }

  // 네트워크 장애 재시도 (동일 clientMessageId)
  const handleNetworkRetry = async () => {
    if (!failedTurnContext || isSending) return
    await sendPayload(failedTurnContext)
  }

  // 서버 최종 실패 시 새 요청으로 다시 시도 (새로운 UUID clientMessageId 생성)
  const handleNewRequestRetry = async () => {
    if (!failedTurnContext || isSending) return
    const newContext: PendingSendContext = {
      ...failedTurnContext,
      clientMessageId: generateUuid(),
    }
    await sendPayload(newContext)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 한국어 IME 조합 중 엔터 누를 때 중복 전송 방지
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  return (
    <Card className="rounded-[24px] border border-border bg-card/95 shadow-sm flex flex-col h-full max-h-[85dvh] lg:max-h-none overflow-hidden backdrop-blur-sm">
      {/* 1. 상단 대화 헤더 */}
      <div className="p-4 border-b border-border/60 flex items-center justify-between bg-muted/20">
        <div className="flex items-center gap-3">
          <div className="relative size-10 rounded-full overflow-hidden ring-2 ring-purple-400 dark:ring-purple-600 bg-purple-50 dark:bg-purple-950 flex items-center justify-center">
            <Sparkles className="size-5 text-purple-600 dark:text-purple-300" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-sm text-foreground">소희와의 1:1 대화</span>
              <Badge variant="outline" className="text-[10px] bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800">
                실시간 대화
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              가르치기 · 잘못된 점 고치기 · 목표 지시 · 소희의 질문에 답하기
            </p>
          </div>
        </div>

        {turnsError && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void fetchTurns()}
            className="h-7 text-xs gap-1 border-destructive/40 text-destructive hover:bg-destructive/10"
          >
            <RefreshCw className="size-3" />
            대화 복원 재시도
          </Button>
        )}
      </div>

      {/* 2. 대화 메시지 영역 */}
      <div className="flex-1 p-4 overflow-y-auto space-y-4">
        {isLoadingTurns ? (
          <div className="flex items-center justify-center h-32 text-xs text-muted-foreground gap-2">
            <Sparkles className="size-4 animate-spin text-purple-600" />
            <span>소희와의 이전 대화 내용을 불러오는 중...</span>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed whitespace-pre-wrap ${
                  msg.sender === 'user'
                    ? msg.status === 'failed'
                      ? 'bg-destructive/10 text-destructive border border-destructive/30 font-medium'
                      : 'bg-purple-600 text-white font-medium shadow-xs'
                    : 'bg-muted/70 text-foreground border border-border/60'
                }`}
              >
                {msg.content}
              </div>

              {/* 전송 실패 / 경합 시 액션 버튼 */}
              {msg.sender === 'user' && msg.status === 'failed' && (
                <div className="flex items-center gap-2 mt-1 text-xs text-destructive">
                  <AlertCircle className="size-3.5 shrink-0" />
                  <span>
                    {failureType === 'streaming409'
                      ? '소희가 답변을 생성 중입니다.'
                      : failureType === 'server'
                        ? '답변 생성에 실패했습니다.'
                        : '전송에 실패했습니다.'}
                  </span>
                  {failureType === 'streaming409' ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void fetchTurns()}
                      disabled={isLoadingTurns}
                      className="h-6 px-2 text-xs text-purple-700 dark:text-purple-300 underline hover:bg-purple-50 dark:hover:bg-purple-950"
                    >
                      <RefreshCw className="size-3 mr-1" />
                      대화 내용 확인
                    </Button>
                  ) : failureType === 'server' ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleNewRequestRetry}
                      disabled={isSending}
                      className="h-6 px-2 text-xs text-destructive underline hover:bg-destructive/10"
                    >
                      <RotateCcw className="size-3 mr-1" />
                      새 요청으로 다시 시도
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleNetworkRetry}
                      disabled={isSending}
                      className="h-6 px-2 text-xs text-destructive underline hover:bg-destructive/10"
                    >
                      <RotateCcw className="size-3 mr-1" />
                      다시 시도
                    </Button>
                  )}
                </div>
              )}

              {/* 소희 제안 카드 (팩트 저장안 또는 목표안) */}
              {msg.sender === 'sohee' && (msg.proposals || msg.suggestedGoal) && (
                <div className="mt-2.5 w-full max-w-[88%]">
                  {msg.proposals?.map((prop) => (
                    <ProposalCard
                      key={prop.id}
                      workspaceId={workspaceId}
                      proposal={prop}
                      onDecided={onFactOrGoalConfirmed}
                    />
                  ))}
                  {msg.suggestedGoal && (
                    <ProposalCard
                      key={msg.suggestedGoal.id}
                      workspaceId={workspaceId}
                      suggestedGoal={msg.suggestedGoal}
                      onDecided={onFactOrGoalConfirmed}
                    />
                  )}
                </div>
              )}
            </div>
          ))
        )}

        {isSending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground italic">
            <Sparkles className="size-3.5 animate-spin text-purple-600" />
            <span>소희가 사장님의 말씀을 깊이 이해하고 있어요...</span>
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      {/* 3. 하단 추천 액션 칩 */}
      <div className="px-4 py-2 border-t border-border/40 bg-muted/10 flex gap-1.5 overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => {
            setInput('우리 매장의 새로운 특징을 알려줄게: ')
            setActiveFocus('teach')
            setActiveRelatedEntityId(undefined)
          }}
          className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50/60 px-3 py-1 text-[11px] font-semibold text-purple-700 hover:bg-purple-100 dark:border-purple-900 dark:bg-purple-950/40 dark:text-purple-300 shrink-0 transition-colors"
        >
          <Lightbulb className="size-3" />
          <span>새 지식 가르치기</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setInput('소희야, 잘못 알고 있는 내용이 있어: ')
            setActiveFocus('inspect')
          }}
          className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50/60 px-3 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300 shrink-0 transition-colors"
        >
          <Edit3 className="size-3" />
          <span>잘못된 점 고치기</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setInput('이번 달에는 이런 목표를 꼭 달성하고 싶어: ')
            setActiveFocus('goal')
          }}
          className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50/60 px-3 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300 shrink-0 transition-colors"
        >
          <Target className="size-3" />
          <span>목표 지시하기</span>
        </button>
      </div>

      {/* 4. 메시지 입력창 */}
      <div className="p-3 bg-muted/30 border-t border-border/60">
        <div className="relative flex items-end bg-background rounded-2xl border border-input focus-within:ring-2 focus-within:ring-purple-500/30 p-2 shadow-xs">
          <Textarea
            ref={textareaRef}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="소희에게 무엇이든 말해보세요. (가르치기, 고치기, 목표 지시 등)"
            aria-label="소희에게 메시지 입력"
            className="border-0 focus-visible:ring-0 resize-none text-xs p-1 shadow-none min-h-[44px]"
          />
          <Button
            type="button"
            size="icon"
            onClick={() => handleSend()}
            disabled={!input.trim() || isSending}
            aria-label="메시지 전송"
            className="size-8 rounded-xl bg-purple-600 hover:bg-purple-700 text-white shrink-0 ml-1 mb-0.5"
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>
      </div>
    </Card>
  )
}
