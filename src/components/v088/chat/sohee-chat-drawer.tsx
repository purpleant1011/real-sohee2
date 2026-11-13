'use client'

import React, { useState, useRef, useEffect } from 'react'
import { useExternalWriteGuard } from '@/features/pwa/use-external-write-guard'
import Link from 'next/link'
import Image from 'next/image'
import { 
  X, 
  Send, 
  Sparkles, 
  Bot, 
  User, 
  ArrowRight, 
  CheckCircle2, 
  RefreshCw, 
  FileText, 
  Calendar, 
  Zap, 
  Share2, 
  ExternalLink, 
  Heart, 
  MessageCircle, 
  Bookmark, 
  SendHorizontal,
  Layers,
  ChevronRight,
  ImageIcon,
  Plus,
  History,
  AlertCircle
} from 'lucide-react'
import { useSoheeAutonomy } from '@/hooks/use-sohee-autonomy'
import { useCreditBalance } from '@/hooks/use-credit-balance'
import {
  CHAT_SEND_FAILED_NOTICE,
  chatSendResultFromResponse,
} from '@/features/mobile-chat/chat-send'
import { useRouter } from 'next/navigation'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'

interface SoheeChatDrawerProps {
  isOpen: boolean
  onClose: () => void
  workspaceId?: string
  isTestAccount?: boolean
}

export interface InterviewOption {
  id: string
  label: string
  description?: string
  value: string
}

export interface InterviewQuestion {
  stepIndex: number
  questionCategory: 'PURPOSE' | 'IMAGE_STYLE' | 'IMAGE_COUNT'
  question: string
  options: InterviewOption[]
}

export interface SocialFeedPreview {
  channel: 'INSTAGRAM' | 'THREADS' | 'NAVER_BLOG' | 'DAANGN'
  profileName: string
  accountHandle: string
  avatarUrl?: string
  images: string[]
  caption: string
  hashtags: string[]
  publishedUrl?: string
  isPublished?: boolean
  contentId?: string
  versionId?: string
  versionNumber?: number
  fingerprint?: string
  approvalId?: string
  isApproved?: boolean
  workItemId?: string | null
}

export interface PlanCardData {
  planId: string
  title: string
  steps: { name: string; sc: number; risk: string }[]
  totalSC: number
  requiresApproval: boolean
}

export interface LiveExecutionCardData {
  planId: string
  progressPercentage: number
  currentStepName: string
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  logs: string[]
}

export interface DecisionCardData {
  decisionId: string
  title: string
  options: { id: string; label: string; description?: string; sc?: number }[]
}

export interface EvidenceResultCardData {
  settledSC: number
  verifiedUrls: { channel: string; url: string; httpStatus: number }[]
  navUrl?: string
  navLabel?: string
}

export interface FailureCardData {
  errorCode: string
  message: string
  step: string
}

export interface CreditDeductionInfo {
  textTokens?: number
  textSC?: number
  imageUnits?: number
  imageSC?: number
  totalDeductedSC: number
  reason?: string
}

interface ChatMessage {
  id: string
  role: 'assistant' | 'user' | 'system'
  content: string
  timestamp: string
  interview?: InterviewQuestion
  preview?: SocialFeedPreview
  toolName?: string
  visualImage?: {
    url: string
    prompt: string
    style?: string
  }
  planCard?: PlanCardData
  liveExecutionCard?: LiveExecutionCardData
  decisionCard?: DecisionCardData
  evidenceResultCard?: EvidenceResultCardData
  failureCard?: FailureCardData
  creditDeduction?: CreditDeductionInfo
}

interface ThreadSummary {
  id: string
  title: string
  lastMessageAt: string | null
  createdAt: string
}

const INITIAL_GREETING = `안녕하세요 사장님! 매장 전담 1인 마케팅 직원 소희입니다 😊

오늘 매장 운영이나 고객 상담은 어떠신가요? 
대화 한 문장으로 인스타·블로그·당근 실발행부터 유휴 슬롯 프로모션, 고객 맞춤 응대, 실사 이미지 생성까지 제가 알아서 실행해 드릴게요!`

export function SoheeChatDrawer({
  isOpen,
  onClose,
  workspaceId = 'ws-default',
  isTestAccount = false
}: SoheeChatDrawerProps) {
  let router: any = null
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    router = useRouter()
  } catch {}
  const { consumeCredits } = useCreditBalance(workspaceId)
  const [isTestUser, setIsTestUser] = useState(isTestAccount)

  // Thread and History State (ANI-652, ANI-653)
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null)
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [showThreadMenu, setShowThreadMenu] = useState(false)
  const [activeRunStatus, setActiveRunStatus] = useState<string | null>(null)

  useEffect(() => {
    if (isTestAccount) {
      setIsTestUser(true)
      return
    }
    try {
      const supabase = createBrowserSupabaseClient()
      supabase.auth.getUser().then(({ data }) => {
        if (data?.user?.email?.trim().toLowerCase() === 'test@example.com') {
          setIsTestUser(true)
        }
      })
    } catch {}
  }, [isTestAccount])

  // Load threads list on open
  useEffect(() => {
    if (isOpen && workspaceId) {
      fetch(`/api/workspaces/${workspaceId}/agent/chat?_t=${Date.now()}`)
        .then(res => res.json())
        .then(data => {
          if (data?.threads && Array.isArray(data.threads)) {
            setThreads(data.threads)
          }
        })
        .catch(() => null)
    }
  }, [isOpen, workspaceId])

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'msg-init',
      role: 'assistant',
      content: INITIAL_GREETING,
      timestamp: '방금 전'
    }
  ])
  const [inputText, setInputText] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const runExternalWrite = useExternalWriteGuard()
  const [isPublishing, setIsPublishing] = useState(false)
  
  // Multi-step interview state
  const [interviewContext, setInterviewContext] = useState<{
    purpose?: string
    imageStyle?: string
    imageCount?: string
  }>({})

  const { setAutonomy } = useSoheeAutonomy()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Start a fresh new conversation thread
  const handleStartNewThread = () => {
    setCurrentThreadId(null)
    setInterviewContext({})
    setActiveRunStatus(null)
    setMessages([
      {
        id: `msg-new-${Date.now()}`,
        role: 'assistant',
        content: `사장님, 새로운 대화가 시작되었습니다 ✨\n어떤 마케팅 업무나 매장 운영을 도와드릴까요?`,
        timestamp: '방금 전'
      }
    ])
    setShowThreadMenu(false)
  }

  // Load an existing thread from history
  const handleSelectThread = async (threadId: string) => {
    setCurrentThreadId(threadId)
    setShowThreadMenu(false)
    setIsTyping(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agent/chat?threadId=${threadId}&_t=${Date.now()}`)
      const data = await res.json()
      if (data?.messages && Array.isArray(data.messages) && data.messages.length > 0) {
        setMessages(data.messages.map((m: any) => ({
          id: m.id,
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content,
          toolName: m.tool_calls?.[0]?.toolName,
          timestamp: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        })))
      }
    } catch (err) {
      console.error('Failed to load thread messages:', err)
    } finally {
      setIsTyping(false)
    }
  }

  // Cmd+K global shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (isOpen) onClose()
      }
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isOpen])

  // Call API for conversational AI & multi-step interview
  const callChatApi = async (inputPayload: Record<string, unknown>) => {
    setIsTyping(true)
    setActiveRunStatus('소희가 작업을 실행하기 위해 준비 중입니다...')

    const bodyPayload = {
      workspaceId,
      isTestAccount: isTestUser,
      threadId: currentThreadId,
      ...inputPayload
    }

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agent/chat?_t=${Date.now()}`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 
          'Content-Type': 'application/json',
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        },
        body: JSON.stringify(bodyPayload)
      })

      const data = await res.json().catch(() => null)

      // 서버는 실패를 200 이 아닌 상태나 본문의 status:'FAILED' / step:'ERROR' 로 알린다.
      // 상태를 보지 않으면 실패 응답이 정상 답변처럼 화면에 남는다.
      const sendResult = chatSendResultFromResponse({ status: res.status, body: data })
      if (!sendResult.ok) {
        setMessages(prev => [
          ...prev,
          {
            id: `ast-${Date.now()}`,
            role: 'assistant',
            content: sendResult.message,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ])
        setActiveRunStatus(null)
        return
      }

      if (data.threadId) {
        setCurrentThreadId(data.threadId)
      }

      // 1. 크레딧 실시간 차감 연동 (테스트 계정은 차감 면제)
      if (!isTestUser && data.creditDeduction && typeof data.creditDeduction.totalDeductedSC === 'number' && data.creditDeduction.totalDeductedSC > 0) {
        consumeCredits(data.creditDeduction.totalDeductedSC)
      }

      // 2. MCP Action 처리 (자율 가동, 킬스위치, 화면 이동 및 포커스)
      if (data.mcpAction?.type === 'SET_AUTONOMY') {
        setAutonomy(data.mcpAction.isRunning)
      } else if (data.mcpAction?.type === 'NAVIGATE_MENU' && data.mcpAction.menu) {
        const targetMenu = data.mcpAction.menu
        const entityId = data.mcpAction.entityId
        setTimeout(() => {
          if (router?.push) {
            router.push(targetMenu)
          } else if (typeof window !== 'undefined') {
            window.location.href = targetMenu
          }
          if (entityId && typeof document !== 'undefined') {
            setTimeout(() => {
              const el = document.getElementById(entityId) || document.querySelector(`[data-entity-id="${entityId}"]`)
              el?.scrollIntoView({ behavior: 'smooth' })
            }, 600)
          }
        }, 800)
      }

      const assistantMsg: ChatMessage = {
        id: `ast-${Date.now()}`,
        role: 'assistant',
        content: data.content || data.message || '사장님! 지시하신 업무를 실시간으로 처리해 두었습니다 😊',
        interview: data.interview,
        preview: data.preview,
        toolName: data.toolName,
        visualImage: data.visualImage,
        planCard: data.planCard,
        liveExecutionCard: data.liveExecutionCard,
        decisionCard: data.approvalCard,
        evidenceResultCard: data.evidenceResultCard,
        failureCard: data.failureCard,
        creditDeduction: data.creditDeduction,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }

      setMessages(prev => [...prev, assistantMsg])
      setActiveRunStatus(null)
    } catch (err) {
      console.error('Chat API error:', err)
      setMessages(prev => [
        ...prev,
        {
          id: `ast-${Date.now()}`,
          role: 'assistant',
          content: CHAT_SEND_FAILED_NOTICE,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ])
      setActiveRunStatus(null)
    } finally {
      setIsTyping(false)
    }
  }

  // Handle User Selecting 1 of 5 Interview Options
  const handleSelectOption = async (option: InterviewOption, questionCategory: 'PURPOSE' | 'IMAGE_STYLE' | 'IMAGE_COUNT') => {
    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      role: 'user',
      content: option.label,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    setMessages(prev => [...prev, userMsg])

    let nextContext = { ...interviewContext }
    let step = ''

    if (questionCategory === 'PURPOSE') {
      nextContext.purpose = option.value
      step = 'PURPOSE_SELECTED'
    } else if (questionCategory === 'IMAGE_STYLE') {
      nextContext.imageStyle = option.value
      step = 'STYLE_SELECTED'
    } else if (questionCategory === 'IMAGE_COUNT') {
      nextContext.imageCount = option.value
      step = 'COUNT_SELECTED'
    }

    setInterviewContext(nextContext)

    await callChatApi({
      messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })),
      selectionData: {
        step,
        purpose: nextContext.purpose,
        imageStyle: nextContext.imageStyle,
        imageCount: nextContext.imageCount,
        channel: 'INSTAGRAM'
      }
    })
  }

  // Handle Freeform Message Send
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputText).trim()
    if (!text) return

    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    if (!textToSend) setInputText('')
    setInterviewContext({})

    await callChatApi({
      messages: nextMessages.map(m => ({ role: m.role, content: m.content }))
    })
  }

  // Handle Instant Publish to Live Instagram / Threads (ANI-648 Mock URL Purged, ANI-1043 Exact Approval Gate)
  const publishToChannels = async (msgId: string, preview: SocialFeedPreview) => {
    setIsPublishing(true)
    try {
      // 1. Ensure Durable Exact-Version Approval FIRST (ANI-1043)
      let approvalId = preview.approvalId
      if (!approvalId && preview.contentId && preview.versionId && preview.fingerprint) {
        const appRes = await fetch(`/api/workspaces/${workspaceId}/content/approvals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contentId: preview.contentId,
            versionId: preview.versionId,
            fingerprint: preview.fingerprint,
            reason: '대화창에서 사장님 직접 게시 승인',
          }),
        })
        const appData = await appRes.json()
        if (!appRes.ok || !appData.success) {
          throw new Error(appData.error?.message || '원고 승인 처리에 실패하여 게시가 중단되었습니다.')
        }
        approvalId = appData.approval?.approvalId
      }

      const res = await fetch(`/api/workspaces/${workspaceId}/publishing/instant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: preview.channel === 'THREADS' ? 'THREADS' : 'INSTAGRAM',
          caption: preview.caption,
          hashtags: preview.hashtags,
          images: preview.images,
          approvalId,
          contentId: preview.contentId,
          versionId: preview.versionId,
          fingerprint: preview.fingerprint,
        })
      })
      const data = await res.json()
      
      const channelResult = preview.channel === 'THREADS' ? data.results?.threads : data.results?.instagram
      const publishedUrl = channelResult?.url

      if (channelResult?.success && publishedUrl) {
        setMessages(prev => prev.map(m => {
          if (m.id === msgId && m.preview) {
            return {
              ...m,
              preview: {
                ...m.preview,
                isPublished: true,
                publishedUrl
              }
            }
          }
          return m
        }))

        setMessages(prev => [
          ...prev,
          {
            id: `ast-${Date.now()}`,
            role: 'assistant',
            content: `🎉 사장님, 요청하신 콘텐츠가 실제 공식 채널에 성공적으로 게시되었습니다!\n\n게시물 URL: ${publishedUrl}\n\n외부 링크가 정상 작동하는지 실시간 검증을 마쳤습니다. 고객 유입을 계속 모니터링할게요!`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ])
      } else {
        // Honest error message without fake URL
        setMessages(prev => [
          ...prev,
          {
            id: `ast-${Date.now()}`,
            role: 'assistant',
            content: `⚠️ 사장님, 공식 채널 연동 확인이 필요합니다.\n\n${channelResult?.message || data.message || '채널 계정 권한을 확인해 주세요.'}\n[채널 관리] 메뉴에서 계정이 올바르게 연동되어 있는지 점검해 드릴게요.`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ])
      }
    } catch (err) {
      console.error('Instant publish failed:', err)
    } finally {
      setIsPublishing(false)
    }
  }

  // 오프라인이면 승인 API 조차 부르지 않고, 같은 원고의 중복 발행은 한 번만 실행한다(ANI-1778).
  const handleInstantPublish = async (msgId: string, preview: SocialFeedPreview) => {
    const outcome = await runExternalWrite('publish', preview.contentId || msgId, () => publishToChannels(msgId, preview))
    if (!outcome.ran) {
      setMessages(prev => [
        ...prev,
        {
          id: `ast-${Date.now()}`,
          role: 'assistant',
          content: `⚠️ ${outcome.decision.message}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ])
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div 
        onClick={onClose}
        className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-200" 
      />

      {/* Drawer Panel (480px) */}
      <div className="relative w-full max-w-lg bg-[var(--v088-surface)] h-full shadow-2xl border-l border-[var(--v088-border)] flex flex-col z-10 animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="h-16 px-5 border-b border-[var(--v088-border)] flex items-center justify-between bg-[var(--v088-surface-subtle)] relative">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-full ring-2 ring-primary/30 overflow-hidden bg-primary/10 shadow-md">
                <Image
                  src="/brand/sohee-character-v1.png"
                  alt="마케팅 전담 직원 소희"
                  width={40}
                  height={40}
                  className="w-full h-full object-cover"
                />
              </div>
              <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-state-ok ring-2 ring-white dark:ring-zinc-900 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-1.5 leading-none">
                <h3 className="font-bold text-sm text-[var(--v088-ink)]">
                  소희 V0.8.9 Agent OS
                </h3>
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md bg-primary/10 text-foreground dark:text-primary border border-primary/30">
                  GPT 5.6 Luna Max
                </span>
              </div>
              <span className="text-[11px] text-[var(--v088-muted)] font-medium mt-1 block">
                자율 마케팅 직원 · 실시간 실행
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {/* New Thread Button */}
            <button
              onClick={handleStartNewThread}
              className="p-2 rounded-xl text-primary hover:bg-primary/10 dark:hover:bg-primary/40 transition-colors cursor-pointer"
              title="새 대화 시작"
            >
              <Plus className="w-4 h-4" />
            </button>

            {/* History Dropdown Toggle */}
            <button
              onClick={() => setShowThreadMenu(!showThreadMenu)}
              className="p-2 rounded-xl text-[var(--v088-muted)] hover:bg-[var(--v088-surface)] transition-colors cursor-pointer"
              title="과거 대화 목록"
            >
              <History className="w-4 h-4" />
            </button>

            <button
              onClick={onClose}
              className="p-2 rounded-xl text-[var(--v088-muted)] hover:bg-[var(--v088-surface)] transition-colors cursor-pointer"
              title="닫기"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* History Dropdown Menu */}
          {showThreadMenu && (
            <div className="absolute top-16 right-5 w-64 p-2 rounded-xl bg-[var(--v088-surface)] border border-[var(--v088-border)] shadow-xl z-20 space-y-1 animate-in fade-in zoom-in-95 duration-150">
              <div className="px-2 py-1 text-[11px] font-bold text-[var(--v088-muted)] border-b border-[var(--v088-border-subtle)] flex items-center justify-between">
                <span>과거 대화 목록 ({threads.length})</span>
                <button onClick={handleStartNewThread} className="text-primary hover:underline flex items-center gap-0.5">
                  <Plus className="w-3 h-3" /> 새 채팅
                </button>
              </div>
              <div className="max-h-56 overflow-y-auto space-y-0.5">
                {threads.length === 0 ? (
                  <div className="p-3 text-center text-xs text-[var(--v088-muted)]">
                    저장된 과거 대화가 없습니다.
                  </div>
                ) : (
                  threads.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => handleSelectThread(t.id)}
                      className={`w-full p-2 rounded-lg text-left text-xs transition-colors truncate block ${
                        currentThreadId === t.id
                          ? 'bg-primary/10 text-foreground dark:text-primary font-bold'
                          : 'text-[var(--v088-ink)] hover:bg-[var(--v088-surface-subtle)]'
                      }`}
                    >
                      {t.title}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Message Stream */}
        <div className="flex-1 p-4 overflow-y-auto space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'assistant' && (
                <div className="w-8 h-8 rounded-full overflow-hidden ring-1 ring-primary/30 bg-primary/10 shrink-0 mt-0.5 shadow-xs">
                  <Image
                    src="/brand/sohee-character-v1.png"
                    alt="소희"
                    width={32}
                    height={32}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              <div className={`max-w-[88%] space-y-3 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                {/* Text Bubble */}
                <div
                  className={`p-3.5 rounded-2xl text-xs leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-primary text-white rounded-tr-xs shadow-xs'
                      : 'bg-[var(--v088-surface-subtle)] text-[var(--v088-ink)] border border-[var(--v088-border-subtle)] rounded-tl-xs'
                  }`}
                >
                  {msg.toolName && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/30 text-[10px] font-bold text-foreground dark:text-primary w-fit mb-2 shadow-2xs">
                      <Sparkles className="w-3 h-3 text-primary animate-spin" />
                      <span>소희 Action Worker 실행: {msg.toolName}</span>
                    </div>
                  )}
                  <div className="whitespace-pre-wrap leading-relaxed">
                    {msg.content}
                  </div>
                </div>

                {/* 5-Option Interview Question Buttons */}
                {msg.interview && (
                  <div className="space-y-2 p-3.5 rounded-2xl bg-primary/70 border border-primary/30 shadow-xs">
                    <span className="text-xs font-bold text-foreground dark:text-primary flex items-center gap-1.5 mb-2">
                      <Zap className="w-3.5 h-3.5 text-primary" />
                      {msg.interview.question}
                    </span>

                    <div className="space-y-1.5">
                      {msg.interview.options.map((opt) => (
                        <button
                          key={opt.id}
                          onClick={() => handleSelectOption(opt, msg.interview!.questionCategory)}
                          className="w-full p-3 rounded-xl bg-[var(--v088-surface)] hover:bg-primary/10 dark:hover:bg-primary/50 border border-primary/80 text-left transition-all group flex items-center justify-between cursor-pointer"
                        >
                          <div>
                            <span className="font-bold text-xs text-[var(--v088-ink)] block group-hover:text-foreground dark:group-hover:text-primary">
                              {opt.label}
                            </span>
                            {opt.description && (
                              <span className="text-[11px] text-[var(--v088-muted)] block mt-0.5">
                                {opt.description}
                              </span>
                            )}
                          </div>
                          <ChevronRight className="w-4 h-4 text-[var(--v088-muted)] group-hover:text-primary group-hover:translate-x-0.5 transition-transform" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Social Feed Preview Card with AI Image & Instant Publish Button */}
                {msg.preview && (
                  <div className="p-4 rounded-2xl bg-[var(--v088-surface)] border-2 border-primary/50 shadow-lg space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-[var(--v088-border)]">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-md bg-gradient-to-tr from-state-warn via-state-danger to-primary flex items-center justify-center text-white text-[10px]">
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect width="20" height="20" x="2" y="2" rx="5" ry="5"/>
                            <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
                            <line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/>
                          </svg>
                        </div>
                        <div>
                          <span className="font-bold text-xs text-[var(--v088-ink)] block leading-none">
                            {msg.preview.profileName}
                          </span>
                          <span className="text-[10px] text-primary font-semibold">
                            {msg.preview.accountHandle}
                          </span>
                        </div>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-foreground dark:text-primary font-bold">
                        피드 프리뷰
                      </span>
                    </div>

                    {/* AI Generated Image Preview */}
                    {msg.preview.images && msg.preview.images.length > 0 && (
                      <div className="relative rounded-xl overflow-hidden bg-neutral-900 aspect-square border border-[var(--v088-border)]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img 
                          src={msg.preview.images[0]} 
                          alt="AI Generated Feed Image"
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-xs text-[10px] text-white font-mono flex items-center gap-1">
                          <ImageIcon className="w-3 h-3 text-primary" />
                          <span>GPT-Image-2 실사 생성</span>
                        </div>
                      </div>
                    )}

                    {/* Feed Caption */}
                    <div className="p-3 rounded-xl bg-[var(--v088-surface-subtle)] text-xs text-[var(--v088-ink)] whitespace-pre-wrap leading-relaxed">
                      {msg.preview.caption}
                    </div>

                    {/* Hashtags */}
                    {msg.preview.hashtags && msg.preview.hashtags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {msg.preview.hashtags.map((tag, idx) => (
                          <span key={idx} className="text-[11px] font-semibold text-primary">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Publish Action Button */}
                    {msg.preview.isPublished ? (
                      <div className="p-3 rounded-xl bg-state-ok-soft border border-state-ok/40 flex items-center justify-between">
                        <span className="text-xs font-bold text-state-ok flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-state-ok" />
                          공식 채널 게시 완료
                        </span>
                        {msg.preview.publishedUrl && (
                          <a
                            href={msg.preview.publishedUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] font-bold text-primary hover:underline flex items-center gap-0.5"
                          >
                            게시물 보기 <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => handleInstantPublish(msg.id, msg.preview!)}
                        disabled={isPublishing}
                        className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-primary to-state-wait hover:from-primary hover:to-state-wait text-white font-bold text-xs shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                      >
                        {isPublishing ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            <span>공식 채널에 실시간 발행 중...</span>
                          </>
                        ) : (
                          <>
                            <Share2 className="w-4 h-4" />
                            <span>실제 공식 채널에 즉시 게시하기</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                )}

                {/* Standalone AI Lookbook Image Card */}
                {msg.visualImage && (
                  <div className="p-4 rounded-2xl bg-[var(--v088-surface)] border-2 border-primary/50 shadow-lg space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-[var(--v088-border)]">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-primary animate-spin" />
                        <span className="font-bold text-xs text-[var(--v088-ink)]">
                          소희 GPT-Image-2 실사 비주얼
                        </span>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-foreground dark:text-primary font-bold">
                        1024x1024 초고화질
                      </span>
                    </div>

                    <div className="relative rounded-xl overflow-hidden bg-neutral-900 aspect-square border border-[var(--v088-border)] group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img 
                        src={msg.visualImage.url} 
                        alt="소희 생성 비주얼 이미지" 
                        className="w-full h-full object-cover transition-transform group-hover:scale-105 duration-300"
                      />
                      <div className="absolute bottom-2 left-2 px-2.5 py-1 rounded-md bg-black/70 backdrop-blur-xs text-[11px] text-white font-medium flex items-center gap-1.5">
                        <ImageIcon className="w-3.5 h-3.5 text-primary" />
                        <span>{msg.visualImage.style || '초고화질 실사'}</span>
                      </div>
                    </div>

                    <div className="text-[11px] text-[var(--v088-muted)] p-2.5 rounded-xl bg-[var(--v088-surface-subtle)] leading-relaxed">
                      💡 <strong>생성 프롬프트</strong>: {msg.visualImage.prompt}
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <a
                        href={msg.visualImage.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 py-2 px-3 rounded-xl bg-primary/10 hover:bg-primary/20 dark:hover:bg-primary/90 text-foreground dark:text-primary font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>고화질 원본</span>
                      </a>
                      <button
                        onClick={() => {
                          setInputText(`이 이미지(${msg.visualImage!.prompt})를 활용해서 인스타그램 피드 포스팅 작성해줘`);
                        }}
                        className="flex-1 py-2 px-3 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        <span>인스타 피드 연계</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* 1. Plan Card (ANI-652) */}
                {msg.planCard && (
                  <div className="p-4 rounded-2xl bg-[var(--v088-surface)] border border-primary/40 shadow-md space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-[var(--v088-border)]">
                      <div className="flex items-center gap-2">
                        <Layers className="w-4 h-4 text-primary" />
                        <span className="font-bold text-xs text-[var(--v088-ink)]">
                          {msg.planCard.title}
                        </span>
                      </div>
                      {msg.planCard.requiresApproval && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-state-warn-soft text-state-warn font-bold border border-state-warn/40">
                          승인 필요
                        </span>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      {msg.planCard.steps.map((step, idx) => (
                        <div key={idx} className="p-2 rounded-lg bg-[var(--v088-surface-subtle)] text-xs flex items-center justify-between">
                          <span className="text-[var(--v088-ink)] flex items-center gap-1.5">
                            <span className="w-4 h-4 rounded-full bg-primary/10 text-foreground dark:text-primary text-[10px] font-bold flex items-center justify-center">
                              {idx + 1}
                            </span>
                            {step.name}
                          </span>
                          <div className="flex items-center gap-1.5 font-mono text-[10px]">
                            <span className="px-1.5 py-0.5 rounded-md bg-primary/10 text-primary">
                              {step.sc} SC
                            </span>
                            <span className={`px-1.5 py-0.5 rounded-md font-bold ${
                              step.risk === 'CRITICAL' ? 'bg-state-danger-soft text-state-danger' :
                              step.risk === 'HIGH' ? 'bg-state-warn-soft text-state-warn' : 'bg-zinc-100 text-zinc-600'
                            }`}>
                              {step.risk}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="pt-2 border-t border-[var(--v088-border-subtle)] flex items-center justify-between text-xs">
                      <span className="text-[var(--v088-muted)] font-medium">총 소요 예상:</span>
                      <span className="font-mono font-bold text-primary">
                        {msg.planCard.totalSC} SC
                      </span>
                    </div>
                  </div>
                )}

                {/* 2. Live Execution Timeline Card (ANI-652) */}
                {msg.liveExecutionCard && (
                  <div className="p-4 rounded-2xl bg-[var(--v088-surface)] border border-[var(--v088-border)] shadow-md space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-[var(--v088-border)]">
                      <div className="flex items-center gap-2">
                        <RefreshCw className={`w-3.5 h-3.5 text-primary ${msg.liveExecutionCard.status === 'RUNNING' ? 'animate-spin' : ''}`} />
                        <span className="font-bold text-xs text-[var(--v088-ink)]">
                          실행 상태: {msg.liveExecutionCard.currentStepName}
                        </span>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        msg.liveExecutionCard.status === 'COMPLETED' ? 'bg-state-ok-soft text-state-ok dark:bg-state-ok dark:text-state-ok' :
                        msg.liveExecutionCard.status === 'RUNNING' ? 'bg-primary/10 text-foreground dark:bg-primary dark:text-primary' :
                        msg.liveExecutionCard.status === 'FAILED' ? 'bg-state-danger-soft text-state-danger dark:bg-state-danger dark:text-state-danger' : 'bg-zinc-100 text-zinc-700'
                      }`}>
                        {msg.liveExecutionCard.status}
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-500 ${
                          msg.liveExecutionCard.status === 'FAILED' ? 'bg-state-danger' : 'bg-primary'
                        }`}
                        style={{ width: `${msg.liveExecutionCard.progressPercentage}%` }}
                      />
                    </div>

                    {/* Execution Logs */}
                    {msg.liveExecutionCard.logs && msg.liveExecutionCard.logs.length > 0 && (
                      <div className="p-2.5 rounded-xl bg-[var(--v088-surface-subtle)] space-y-1 font-mono text-[11px] text-[var(--v088-muted)]">
                        {msg.liveExecutionCard.logs.map((log, idx) => (
                          <div key={idx} className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                            <span>{log}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 3. Decision / Approval Card (ANI-652, ANI-656) */}
                {msg.decisionCard && (
                  <div className="p-4 rounded-2xl bg-state-warn/70 border-2 border-state-warn/40 shadow-md space-y-3">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-state-warn shrink-0" />
                      <span className="font-bold text-xs text-state-warn">
                        {msg.decisionCard.title}
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      {msg.decisionCard.options.map((opt) => (
                        <button
                          key={opt.id}
                          onClick={() => handleSendMessage(opt.label)}
                          className="w-full p-2.5 rounded-xl bg-[var(--v088-surface)] hover:bg-state-warn-soft dark:hover:bg-state-warn/50 border border-state-warn/30 text-left transition-colors flex items-center justify-between cursor-pointer"
                        >
                          <div>
                            <span className="font-bold text-xs text-[var(--v088-ink)] block">
                              {opt.label}
                            </span>
                            {opt.description && (
                              <span className="text-[10px] text-[var(--v088-muted)] block">
                                {opt.description}
                              </span>
                            )}
                          </div>
                          {typeof opt.sc === 'number' && opt.sc > 0 && (
                            <span className="text-[10px] font-mono font-bold text-state-warn bg-state-warn-soft px-1.5 py-0.5 rounded-md">
                              {opt.sc} SC
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 4. Evidence Result Card (ANI-652, ANI-655) */}
                {msg.evidenceResultCard && (
                  <div className="p-4 rounded-2xl bg-state-ok/60 border border-state-ok/40 shadow-md space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-state-ok/30">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-state-ok" />
                        <span className="font-bold text-xs text-state-ok">
                          외부 검증 영수증 (Readback Verified)
                        </span>
                      </div>
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-state-ok-soft text-state-ok">
                        정산: {msg.evidenceResultCard.settledSC} SC
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      {msg.evidenceResultCard.verifiedUrls.map((v, idx) => (
                        <div key={idx} className="p-2.5 rounded-xl bg-[var(--v088-surface)] border border-state-ok/80 flex items-center justify-between text-xs">
                          <span className="font-bold text-[11px] text-foreground dark:text-primary">
                            [{v.channel}]
                          </span>
                          <a
                            href={v.url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-[11px] text-primary hover:underline flex items-center gap-1 truncate max-w-[200px]"
                          >
                            <span>{v.url}</span>
                            <ExternalLink className="w-3 h-3 shrink-0" />
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 5. Failure Card (ANI-652) */}
                {msg.failureCard && (
                  <div className="p-4 rounded-2xl bg-state-danger/70 border border-state-danger/40 shadow-md space-y-2">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-state-danger shrink-0" />
                      <span className="font-bold text-xs text-state-danger">
                        실패: {msg.failureCard.step}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-[var(--v088-surface)] text-xs text-state-danger font-mono">
                      <div className="font-bold">코드: {msg.failureCard.errorCode}</div>
                      <div className="text-[11px] mt-0.5">{msg.failureCard.message}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center text-white shrink-0">
                <Bot className="w-4 h-4" />
              </div>
              <div className="p-3.5 rounded-2xl bg-[var(--v088-surface-subtle)] text-xs text-[var(--v088-muted)] flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-primary animate-bounce" />
                <span className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:0.2s]" />
                <span className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:0.4s]" />
                <span className="ml-1 text-[11px] font-medium">
                  {activeRunStatus || '소희가 GPT 5.6 Luna Max로 실행 중입니다...'}
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Quick Prompts */}
        <div className="p-3 border-t border-[var(--v088-border)] bg-[var(--v088-surface-subtle)]/40 overflow-x-auto whitespace-nowrap">
          <div className="flex items-center gap-1.5">
            <Zap className="w-3 h-3 text-primary shrink-0" />
            <span className="text-[10px] font-bold text-[var(--v088-muted)] mr-1">추천 지시:</span>
            {[
              '이번 주 인스타/스레드 콘텐츠 만들어서 이미지 포함해 올려줘',
              '오늘 온 댓글/DM 확인하고 예약 문의에 답해줘',
              '화·수 유휴 슬롯 소진용 15% 할인 프로모션 기획해줘',
              '매장 마케팅 ROI 및 슬롯 점유율 분석해줘'
            ].map((p, idx) => (
              <button
                key={idx}
                onClick={() => handleSendMessage(p)}
                className="px-2.5 py-1 rounded-lg bg-[var(--v088-surface)] border border-[var(--v088-border)] text-[11px] text-[var(--v088-ink)] hover:border-primary/50 hover:text-primary transition-colors shrink-0 cursor-pointer"
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Input Bar */}
        <div className="p-3 border-t border-[var(--v088-border)] bg-[var(--v088-surface)] flex gap-2">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSendMessage()
              }
            }}
            placeholder="소희에게 마케팅 업무나 일상 대화를 입력하세요... (Enter로 전송)"
            rows={2}
            className="flex-1 p-2.5 rounded-xl bg-[var(--v088-surface-subtle)] border border-[var(--v088-border)] text-xs text-[var(--v088-ink)] placeholder:text-[var(--v088-muted)] focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
          />
          <button
            onClick={() => handleSendMessage()}
            disabled={!inputText.trim()}
            className="px-4 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-40 text-white text-xs font-bold shadow-md shadow-primary/20 transition-all flex items-center justify-center cursor-pointer"
          >
            <SendHorizontal className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
