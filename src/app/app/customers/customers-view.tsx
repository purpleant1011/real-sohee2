'use client'

import React, { useState, useEffect, useRef } from 'react'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import Link from 'next/link'
import {
  MessageSquare,
  Calendar,
  Send,
  ShieldCheck,
  Clock,
  Sparkles,
  CheckCircle2,
  Sliders,
  TrendingUp,
  CalendarCheck,
  Search,
  MessageCircle,
  ChevronDown,
  Info,
  ArrowLeft,
} from 'lucide-react'
import { useWorkspaceId } from '@/hooks/use-workspace-context'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'
import { SoheeLiveWorkboard } from '@/components/agent-os/sohee-live-workboard'
import { CustomerClosedLoopTrace } from '@/components/v088/customers/customer-closed-loop-trace'
import { ReservationCalendarView } from '@/components/v088/customers/reservation-calendar-view'
import { ReservationActionsDialog } from '@/components/v088/customers/reservation-actions-dialog'
import { CopyBookingRequestLinkButton } from '@/features/booking-request/copy-booking-request-link'
import { toast } from 'sonner'
import { RecoveryCard } from '@/features/booking-recovery/components/recovery-card'
import type { RecoveryView } from '@/features/booking-recovery/contracts'
import { KakaoStatusBadge } from '@/features/kakao/history/history-badge'
import { KakaoHistoryList } from '@/features/kakao/history/history-list'
import { useKakaoHistory } from '@/features/kakao/history/use-kakao-history'
import type { KakaoHistoryItem } from '@/features/kakao/history/contract'

interface CustomerMessageItem {
  id: string
  name: string
  handle: string
  channel: 'instagram' | 'naver' | 'daangn' | 'threads' | 'kakao'
  channelLabel: string
  channelColor: string
  lastMessage: string
  lastMessageTime: string
  urgency: 'high' | 'medium' | 'low'
  bookingIntent: boolean
  stage: 'inquiry' | 'deposit_pending' | 'booked' | 'completed'
  stageLabel: string
  stageColor: string
  unread: boolean
  suggestedSlot?: string
  suggestedReply?: string
  dialogueHistory: {
    sender: 'customer' | 'sohee' | 'owner'
    text: string
    time: string
  }[]
}

import { MasterDetail } from '@/components/layout/master-detail'
import { CustomerInquiryReview, CustomerQueryScope } from '@/features/customers/customer-inquiry-review'
import { CanonicalCustomersPanel } from '@/features/customers/canonical-customers-panel'

export default function CustomersPage({ initialCustomerId }: { initialCustomerId?: string } = {}) {
  const workspaceId = useWorkspaceId()
  return <CustomerWorkspaceView key={workspaceId} workspaceId={workspaceId} initialCustomerId={initialCustomerId} />
}

function CustomerWorkspaceView({ workspaceId, initialCustomerId }: { workspaceId: string; initialCustomerId?: string }) {
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(initialCustomerId ?? null)
  const [crmViewMode, setCrmViewMode] = useState<'list' | 'calendar'>('list')
  const [channelFilter, setChannelFilter] = useState<'all' | 'instagram' | 'naver' | 'daangn' | 'threads' | 'kakao'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<'recent' | 'name'>('recent')
  const [replyInput, setReplyInput] = useState<string>('')
  const [sendSuccessMsg, setSendSuccessMsg] = useState<string | null>(null)
  const [handoffActive, setHandoffActive] = useState<boolean>(false)
  const [customerState, setCustomerState] = useState<'loading' | 'ready' | 'empty' | 'not_observed' | 'error' | 'not_found'>('loading')
  const [showAdvancedCrm, setShowAdvancedCrm] = useState(false)
  const [isTestAccount, setIsTestAccount] = useState(false)
  const [pipelineItems, setPipelineItems] = useState<CustomerMessageItem[]>([])
  const hasCustomers = pipelineItems.length > 0
  const [liveReservations, setLiveReservations] = useState<any[]>([])
  const [recoveryCases, setRecoveryCases] = useState<RecoveryView[]>([])
  const [actionDialogState, setActionDialogState] = useState<{
    open: boolean
    mode: 'reschedule' | 'cancel' | 'decline'
    reservationId: string
    customerName?: string
    customerPhone?: string
    currentBookingStartsAt?: string
    hasKakaoHistory?: boolean
  } | null>(null)
  const [isConfirmingId, setIsConfirmingId] = useState<string | null>(null)

  const handleConfirmReservation = async (reservationId: string) => {
    if (isConfirmingId) return
    setIsConfirmingId(reservationId)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/reservations/${reservationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm' }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.error || '예약 확정 처리에 실패했습니다.')
        return
      }
      toast.success('예약 신청을 확정했어요')
      await fetchPipeline()
    } catch {
      toast.error('네트워크 오류가 발생했습니다. 다시 시도해 주세요.')
    } finally {
      setIsConfirmingId(null)
    }
  }

  const { items: kakaoHistoryItems } = useKakaoHistory({ workspaceId, limit: 100 })
  const kakaoByReservation = React.useMemo(() => {
    const map = new Map<string, KakaoHistoryItem>()
    for (const item of kakaoHistoryItems) {
      if (!item.reservationId) continue
      const existing = map.get(item.reservationId)
      if (!existing) {
        map.set(item.reservationId, item)
      } else {
        const existingTime = new Date(existing.updatedAt || existing.dueAt).getTime()
        const itemTime = new Date(item.updatedAt || item.dueAt).getTime()
        if (itemTime > existingTime) {
          map.set(item.reservationId, item)
        }
      }
    }
    return map
  }, [kakaoHistoryItems])

  const pipelineRequest = useRef(0)
  const fetchPipeline = React.useCallback(async () => {
    const requestId = ++pipelineRequest.current
    setPipelineItems([])
    setLiveReservations([])
    setRecoveryCases([])
    setCustomerState('loading')
    if (!workspaceId || workspaceId === 'ws-default') {
      setCustomerState('error')
      return
    }
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/customers/pipeline`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      if (requestId !== pipelineRequest.current) return
      if (data.datasetMode !== 'ACTUAL') {
        setCustomerState('not_observed')
        return
      }
      if (!Array.isArray(data.items) || !Array.isArray(data.reservations)) throw new Error('Invalid response')
      setPipelineItems(data.items)
      setLiveReservations(data.reservations)
      setCustomerState(data.items.length || data.reservations.length ? 'ready' : 'empty')
      const hash = window.location.hash
      if (hash.startsWith('#reservation-') && hash !== '#reservation-ledger') {
        const requestedReservation = decodeURIComponent(hash.slice('#reservation-'.length))
        if (!data.reservations.some((item: { id: string }) => item.id === requestedReservation)) {
          setSelectedCustomerId(null)
          setCustomerState('error')
          return
        }
      }
      const requested = new URLSearchParams(window.location.search).get('customer')
      const targetRequested = initialCustomerId || requested
      if (targetRequested && !data.items.some((item: CustomerMessageItem) => item.id === targetRequested)) {
        setSelectedCustomerId(null)
        setCustomerState('not_found')
        return
      }
      setSelectedCustomerId((prev) => data.items.find((item: CustomerMessageItem) => item.id === (targetRequested || prev))?.id || data.items[0]?.id || null)

      // 회수 케이스 조회 (Task 10)
      void fetch(`/api/workspaces/${workspaceId}/booking-recovery/cases`)
        .then((r) => (r.ok ? r.json() : null))
        .then((cData) => {
          if (requestId === pipelineRequest.current && Array.isArray(cData?.cases)) {
            setRecoveryCases(cData.cases)
          }
        })
        .catch(() => {})
    } catch {
      if (requestId !== pipelineRequest.current) return
      setPipelineItems([])
      setLiveReservations([])
      setCustomerState('error')
    }
  }, [workspaceId, initialCustomerId])

  useEffect(() => {
    try {
      const supabase = createBrowserSupabaseClient()
      supabase.auth.getUser().then(({ data }) => {
        const email = data?.user?.email || ''
        if (email.startsWith('test@') || email.includes('test') || email.includes('canary')) {
          setIsTestAccount(true)
        }
      }).catch(() => {})
    } catch {}
    const openLinkedLedger = () => {
      if (window.location.hash === '#reservation-ledger' || window.location.hash.startsWith('#reservation-')) setShowAdvancedCrm(true)
    }
    openLinkedLedger()
    window.addEventListener('hashchange', openLinkedLedger)
    void fetchPipeline()
    return () => {
      pipelineRequest.current++
      window.removeEventListener('hashchange', openLinkedLedger)
    }
  }, [fetchPipeline])

  useEffect(() => {
    if (!showAdvancedCrm || !window.location.hash.startsWith('#reservation-')) return
    try {
      document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView?.({ block: 'center' })
    } catch {
      // Malformed links must not select another record.
    }
  }, [liveReservations, showAdvancedCrm])

  const currentList = pipelineItems
  const filteredCustomers = currentList
    .filter(c => {
      if (channelFilter !== 'all' && c.channel !== channelFilter) return false
      if (!searchQuery.trim()) return true
      const query = searchQuery.trim().toLowerCase()
      return c.name.toLowerCase().includes(query) || c.handle.toLowerCase().includes(query) || c.lastMessage.toLowerCase().includes(query)
    })
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name, 'ko-KR')
      return 0
    })

  const selectedCustomer = currentList.find(c => c.id === selectedCustomerId) || currentList[0]

  const customerReservations = liveReservations.filter((r) => {
    if (!selectedCustomer) return false
    return r.customer_name === selectedCustomer.name || r.id === selectedCustomer.id
  })

  const handleSendReply = async () => {
    setSendSuccessMsg('아직 발송하지 않았어요. 확인된 답변은 아래 문의 카드에서 검토해 주세요.')
  }

  const emptyCustomerNotice = (
    <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center space-y-4">
      <div className="w-12 h-12 mx-auto rounded-full bg-primary/10 text-primary flex items-center justify-center">
        <MessageSquare className="w-6 h-6" />
      </div>
      <div className="space-y-1">
        <h3 className="text-base font-bold text-foreground">
          문의 주신 손님은 소통함에서 볼 수 있어요
        </h3>
        <p className="text-sm text-muted-foreground">
          인스타그램 DM과 댓글로 문의한 손님들을 소통함에서 바로 확인하고 답장할 수 있어요.
        </p>
      </div>
      <div>
        <Link
          href="/app/engagement"
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          소통함 열기
        </Link>
      </div>
    </div>
  )

  return (
    <V088AppShell workspaceId={workspaceId}>
      <div className="space-y-6 max-w-7xl mx-auto">
        {customerState === 'loading' ? (
          <p role="status">고객 정보를 확인하고 있어요.</p>
        ) : customerState === 'not_found' ? (
          <div className="rounded-3xl border border-dashed border-border bg-card p-10 text-center space-y-4 max-w-md mx-auto my-12 shadow-xs">
            <div className="w-12 h-12 mx-auto rounded-full bg-muted flex items-center justify-center text-muted-foreground">
              <MessageSquare className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-foreground">
                손님 정보를 찾을 수 없어요
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                요청하신 손님 정보가 없거나 이미 상담이 완료되어 목록에서 제외되었을 수 있어요.
              </p>
            </div>
            <div>
              <Link
                href="/app/customers"
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                고객 목록으로 돌아가기
              </Link>
            </div>
          </div>
        ) : customerState === 'error' ? (
          <div className="rounded-3xl border border-border bg-card p-8 text-center space-y-3 max-w-md mx-auto my-12 shadow-xs">
            <p role="alert" className="text-sm font-semibold text-destructive">
              고객 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.
            </p>
            <button
              type="button"
              onClick={() => void fetchPipeline()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-border text-xs font-semibold hover:bg-muted"
            >
              다시 시도
            </button>
          </div>
        ) : customerState === 'not_observed' ? (
          <p role="status">실제 운영 자료로 확인되지 않아 고객 목록 집계에서 제외했어요.</p>
        ) : (
          <>
            {!hasCustomers ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-foreground">인스타그램 문의 손님</h2>
                </div>
                {emptyCustomerNotice}
              </div>
            ) : (
              <>
                <CustomerQueryScope />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 rounded-3xl bg-card border border-border shadow-xs space-y-1">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-bold">이번 조회 DM 대화</span>
                  <MessageSquare className="w-4 h-4 text-primary" />
                </div>
                <div className="text-2xl font-black text-foreground font-mono">
                  {currentList.length}건
                </div>
                <span className="text-[11px] text-primary font-bold block">
                  현재 상담 중 {currentList.filter((item) => item.stage === 'inquiry').length}건
                </span>
              </div>

              <div className="p-5 rounded-3xl bg-card border border-border shadow-xs space-y-1">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-bold">예약 조율 중</span>
                  <Clock className="w-4 h-4 text-state-wait" />
                </div>
                <div className="text-2xl font-black text-foreground font-mono">
                  {currentList.filter((item) => item.stage === 'deposit_pending').length}건
                </div>
                <span className="text-[11px] text-state-wait font-bold block">
                  후속 안내 진행
                </span>
              </div>

              <div className="p-5 rounded-3xl bg-card border border-border shadow-xs space-y-1">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-bold">확정된 예약</span>
                  <CalendarCheck className="w-4 h-4 text-state-ok" />
                </div>
                <div className="text-2xl font-black text-foreground font-mono">
                  {liveReservations.filter((item) => item.status === 'CONFIRMED').length}건
                </div>
                <span className="text-[11px] text-state-ok font-bold block">
                  예약 원장 상태 기준 · 방문·결제는 별도 확인
                </span>
              </div>

              <div className="p-5 rounded-3xl bg-card border border-border shadow-xs space-y-1">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-bold">문의 전환율</span>
                  <TrendingUp className="w-4 h-4 text-primary" />
                </div>
                <div className="text-lg font-bold text-foreground">
                  확인 근거 필요
                </div>
                <span className="text-[11px] text-primary font-bold block">
                  문의와 예약의 연결 근거가 필요해요
                </span>
              </div>
            </div>

            {/* View Mode Toggle: 목록 뷰 vs 주간 예약 캘린더 */}
            <div className="flex items-center justify-between gap-3 border-b border-border/40 pb-2">
              <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-muted/60 text-xs font-bold border border-border/40">
                <button
                  type="button"
                  onClick={() => setCrmViewMode('list')}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl transition-all cursor-pointer ${
                    crmViewMode === 'list'
                      ? 'bg-card text-foreground shadow-2xs font-extrabold'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <MessageSquare className="size-3.5 text-primary" />
                  <span>실시간 대화 & 목록</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCrmViewMode('calendar')}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl transition-all cursor-pointer ${
                    crmViewMode === 'calendar'
                      ? 'bg-card text-foreground shadow-2xs font-extrabold'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Calendar className="size-3.5 text-primary" />
                  <span>주간 예약 캘린더</span>
                </button>
              </div>

              <Link
                href={selectedCustomer ? `/app/engagement/${encodeURIComponent(`dm:${selectedCustomer.id}`)}` : '/app/inbox'}
                className="inline-flex min-h-11 items-center rounded-xl bg-primary px-3 text-sm font-medium text-primary-foreground"
              >
                예약 문의 검토
              </Link>
            </div>

            {crmViewMode === 'calendar' ? (
              <div className="w-full min-w-0 overflow-x-auto pb-2">
                <ReservationCalendarView
                  reservations={liveReservations.filter((r) => r.status !== 'CANCELLED').map((r) => ({
                    id: r.id,
                    customerName: r.customer_name || '고객',
                    serviceName: r.service_name || '서비스 정보 확인 필요',
                    bookingStartsAt: r.booking_starts_at || r.metadata?.bookingStartsAt || '',
                    totalAmountKrw: r.total_amount_krw ?? undefined,
                    status: r.status === 'CONFIRMED' ? 'confirmed' as const : r.status === 'COMPLETED' ? 'completed' as const : 'pending' as const,
                    channel: r.channel_source,
                  }))}
                />
              </div>
            ) : (
              <>
                {/* 💌 예약 전환 회수 진행 중인 문의 */}
                {recoveryCases.length > 0 && (
                  <div className="p-5 rounded-3xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/80 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                        <Sparkles className="size-4 text-primary" />
                        <span>예약 전환 회수 진행 중인 문의 ({recoveryCases.length}건)</span>
                      </h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {recoveryCases.map((rc) => (
                        <RecoveryCard
                          key={rc.caseId}
                          view={rc}
                          onCommand={async (cmd) => {
                            const res = await fetch(
                              `/api/workspaces/${encodeURIComponent(workspaceId)}/booking-recovery/cases/${encodeURIComponent(rc.caseId)}/commands`,
                              {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(cmd),
                              }
                            )
                            const json = await res.json().catch(() => ({}))
                            if (!res.ok) {
                              throw new Error(json.error || json.message || '명령 처리에 실패했습니다.')
                            }
                            void fetchPipeline()
                            if (json.view) {
                              setRecoveryCases((prev) =>
                                prev.map((c) => (c.caseId === rc.caseId ? json.view : c))
                              )
                            }
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* MasterDetail (왼쪽 목록 + 오른쪽 상세) */}
                <MasterDetail
                  listLabel="고객 목록"
                  detailLabel="고객 상세"
                  hasSelection={Boolean(selectedCustomerId)}
                  emptyDetail="목록에서 손님을 선택하면 대화와 예약 기록을 볼 수 있어요."
                  list={
                    <div className="space-y-3">
                      {/* 검색 및 필터/정렬 */}
                      <div className="space-y-2 rounded-2xl border border-border bg-card p-3 shadow-2xs">
                        <div className="relative">
                          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="손님 이름 또는 아이디 검색"
                            className="w-full rounded-xl border border-input bg-background pl-9 pr-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </div>
                        <div className="flex items-center justify-between gap-1 text-xs">
                          <div className="flex items-center gap-1">
                            {[
                              { id: 'all', label: '전체' },
                              { id: 'instagram', label: '인스타' },
                            ].map((ch) => (
                              <button
                                key={ch.id}
                                type="button"
                                onClick={() => setChannelFilter(ch.id as any)}
                                className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                                  channelFilter === ch.id
                                    ? 'bg-primary text-primary-foreground font-bold'
                                    : 'bg-muted text-muted-foreground hover:text-foreground'
                                }`}
                              >
                                {ch.label}
                              </button>
                            ))}
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setSortBy(sortBy === 'recent' ? 'name' : 'recent')}
                              className="px-2 py-1 rounded-lg bg-muted text-muted-foreground hover:text-foreground font-medium text-[11px]"
                            >
                              {sortBy === 'recent' ? '최신순' : '이름순'}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* 고객 카드 목록 */}
                      <div className="space-y-2">
                        {filteredCustomers.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                            검색 조건에 맞는 손님이 없어요.
                          </div>
                        ) : (
                          filteredCustomers.map((cust) => {
                            const isSelected = selectedCustomerId === cust.id
                            return (
                              <div
                                key={cust.id}
                                role="button"
                                tabIndex={0}
                                aria-pressed={isSelected}
                                aria-label={`${cust.name} (${cust.channelLabel})`}
                                onClick={() => setSelectedCustomerId(cust.id)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    setSelectedCustomerId(cust.id)
                                  }
                                }}
                                className={`p-4 rounded-2xl border transition-all cursor-pointer space-y-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                                  isSelected
                                    ? 'bg-primary/10 border-primary shadow-xs ring-1 ring-primary/20'
                                    : 'bg-card border-border hover:border-zinc-300 dark:hover:border-zinc-700'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1.5 min-w-0">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${cust.channelColor || 'bg-muted text-muted-foreground'}`}>
                                      {cust.channelLabel}
                                    </span>
                                    <span className="font-bold text-xs text-foreground whitespace-nowrap">
                                      {cust.name}
                                    </span>
                                    <span className="text-[11px] text-muted-foreground font-mono truncate">{cust.handle}</span>
                                  </div>
                                  <span className="text-[10px] text-muted-foreground shrink-0 whitespace-nowrap">{cust.lastMessageTime}</span>
                                </div>

                                <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                                  {cust.lastMessage}
                                </p>

                                <div className="pt-1.5 border-t border-border flex items-center justify-between text-[11px]">
                                  <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${cust.stageColor || 'bg-muted text-muted-foreground'}`}>
                                    {cust.stageLabel}
                                  </span>
                                  {cust.suggestedSlot && (
                                    <span className="font-mono text-primary font-bold flex items-center gap-1">
                                      <Clock className="w-3 h-3" /> {cust.suggestedSlot.split(' ')[1]} 슬롯
                                    </span>
                                  )}
                                </div>
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  }
                  detail={
                    selectedCustomer ? (
                      <div className="space-y-4 rounded-3xl border border-border bg-card p-6 shadow-xs">
                        {/* 목록으로 돌아가기 (44px 터치 타깃, 모바일/좁은 화면 목록 복귀) */}
                        <div className="flex items-center justify-between pb-1">
                          <button
                            type="button"
                            onClick={() => setSelectedCustomerId(null)}
                            className="inline-flex min-h-11 items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                            aria-label="고객 목록으로 돌아가기"
                          >
                            <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
                            <span>고객 목록으로 돌아가기</span>
                          </button>
                        </div>

                        {/* 1. 기본 정보 */}
                        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-border">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground font-bold flex items-center justify-center text-sm shrink-0">
                              {selectedCustomer.name.slice(0, 1)}
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="font-bold text-base text-foreground whitespace-nowrap">
                                  {selectedCustomer.name}
                                </h3>
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${selectedCustomer.channelColor || 'bg-muted text-muted-foreground'}`}>
                                  {selectedCustomer.channelLabel}
                                </span>
                              </div>
                              <span className="text-xs text-muted-foreground font-mono truncate block">
                                {selectedCustomer.handle}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setHandoffActive(!handoffActive)}
                              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer shrink-0 whitespace-nowrap ${
                                handoffActive
                                  ? 'bg-state-warn-soft text-state-warn border-state-warn/30 shadow-2xs'
                                  : 'bg-background text-foreground border-border hover:bg-muted'
                              }`}
                            >
                              {handoffActive ? '사장님 직접 개입 중' : '사장님 직접 개입'}
                            </button>
                          </div>
                        </div>

                        {/* 문의·예약 검토 안내 배너 */}
                        <div className="p-3.5 rounded-2xl bg-muted/40 border border-border/60">
                          <CustomerInquiryReview threadId={selectedCustomer.id} />
                        </div>

                        {/* 2. 최근 대화 (대화 버블 스트림) */}
                        <div className="space-y-2">
                          <h4 className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
                            <MessageCircle className="w-3.5 h-3.5 text-primary" />
                            최근 대화 내역
                          </h4>
                          <div className="space-y-3 min-h-[160px] max-h-[260px] overflow-y-auto pr-1 rounded-2xl bg-muted/30 p-3 border border-border/50">
                            {selectedCustomer.dialogueHistory.length === 0 ? (
                              <p className="text-xs text-muted-foreground p-3 text-center">대화 기록이 없습니다.</p>
                            ) : (
                              selectedCustomer.dialogueHistory.map((msg, idx) => (
                                <div
                                  key={idx}
                                  className={`flex flex-col ${msg.sender === 'customer' ? 'items-start' : 'items-end'}`}
                                >
                                  <div className={`p-3 rounded-2xl text-xs leading-relaxed max-w-[85%] ${
                                    msg.sender === 'customer'
                                      ? 'bg-card border border-border text-foreground rounded-tl-none shadow-2xs'
                                      : 'bg-primary text-primary-foreground rounded-tr-none shadow-xs font-medium'
                                  }`}>
                                    {msg.text}
                                  </div>
                                  <span className="text-[10px] text-muted-foreground mt-1 px-1">{msg.time}</span>
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        {/* 3. 소희 AI 추천 답변 및 입력창 */}
                        {selectedCustomer.suggestedReply && (
                          <div className="p-4 rounded-2xl bg-primary/10 border border-primary/20 text-xs space-y-2">
                            <div className="flex items-center justify-between text-primary font-bold">
                              <span className="flex items-center gap-1.5">
                                <Sparkles className="w-3.5 h-3.5" />
                                소희의 추천 답변
                              </span>
                            </div>
                            <p className="text-foreground leading-relaxed font-medium">
                              {selectedCustomer.suggestedReply}
                            </p>
                            <div className="pt-1 flex items-center justify-end">
                              <button
                                type="button"
                                onClick={() => setReplyInput(selectedCustomer.suggestedReply || '')}
                                className="px-3 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs transition-all shadow-xs cursor-pointer"
                              >
                                추천 답변 입력창에 채우기
                              </button>
                            </div>
                          </div>
                        )}

                        {sendSuccessMsg && (
                          <div className="p-3 rounded-xl bg-state-ok-soft border border-state-ok/30 text-xs font-bold text-state-ok flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4 text-state-ok shrink-0" />
                            <span>{sendSuccessMsg}</span>
                          </div>
                        )}

                        <div className="flex items-center gap-2 pt-1">
                          <input
                            type="text"
                            aria-label="고객 답변 메시지 입력"
                            value={replyInput}
                            onChange={(e) => setReplyInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSendReply()}
                            placeholder="소희 추천 답변을 수정하거나 직접 메시지를 입력하세요..."
                            className="flex-1 px-4 py-2.5 rounded-xl bg-background border border-border text-xs focus:outline-none focus:ring-1 focus:ring-ring text-foreground"
                          />
                          <button
                            type="button"
                            onClick={handleSendReply}
                            disabled={!replyInput.trim()}
                            className="p-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground transition-all disabled:opacity-50 cursor-pointer shadow-xs"
                          >
                            <Send className="w-4 h-4" />
                          </button>
                        </div>

                        {/* 4. 고객 예약 기록 & 메모 요약 */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                          <div className="p-4 rounded-2xl border border-border bg-muted/20 space-y-2">
                            <div className="flex items-center justify-between text-xs font-bold text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3.5 h-3.5 text-primary" />
                                연결된 예약 기록
                              </span>
                              <span className="text-foreground">{customerReservations.length}건</span>
                            </div>
                            {customerReservations.length === 0 ? (
                              <p className="text-xs text-muted-foreground pt-1">연결된 예약 기록이 없어요.</p>
                            ) : (
                              <ul className="space-y-1.5 text-xs">
                                {customerReservations.slice(0, 3).map((r, i) => (
                                  <li key={r.id || i} className="p-2 rounded-xl bg-card border border-border">
                                    <div className="font-semibold text-foreground">{r.service_name || '서비스 정보 확인 필요'}</div>
                                    <div className="text-[11px] text-muted-foreground">
                                      {r.booking_starts_at || '예약 시간 확인 필요'} · {r.status === 'CONFIRMED' ? '확정' : r.status || '대기'}
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>

                          <div className="p-4 rounded-2xl border border-border bg-muted/20 space-y-2">
                            <div className="text-xs font-bold text-muted-foreground flex items-center gap-1">
                              <Info className="w-3.5 h-3.5 text-primary" />
                              상담 메모 & 특이사항
                            </div>
                            <div className="space-y-1 text-xs">
                              <div className="flex justify-between py-1 border-b border-border/40">
                                <span className="text-muted-foreground">응대 단계</span>
                                <span className="font-semibold text-foreground">{selectedCustomer.stageLabel}</span>
                              </div>
                              <div className="flex justify-between py-1 border-b border-border/40">
                                <span className="text-muted-foreground">우선순위</span>
                                <span className="font-semibold text-foreground">
                                  {selectedCustomer.urgency === 'high' ? '높음' : selectedCustomer.urgency === 'medium' ? '보통' : '낮음'}
                                </span>
                              </div>
                              <div className="flex justify-between py-1">
                                <span className="text-muted-foreground">예약 의도</span>
                                <span className="font-semibold text-foreground">
                                  {selectedCustomer.bookingIntent ? '있음' : '단순 문의'}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* 카카오 안내 발송내역 */}
                        <div className="p-4 rounded-2xl border border-border bg-muted/20 space-y-2">
                          <div className="flex items-center justify-between text-xs font-bold text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <MessageSquare className="w-3.5 h-3.5 text-primary" />
                              카카오 안내 발송내역 (최근 예약)
                            </span>
                          </div>
                          <KakaoHistoryList
                            workspaceId={workspaceId}
                            reservationId={customerReservations[0]?.id}
                          />
                        </div>
                      </div>
                    ) : null
                  }
                />
              </>
            )}
          </>
        )}

        {/* 🌟 2.5 예약 고객(번호 기준) 섹션 */}
        <CanonicalCustomersPanel workspaceId={workspaceId} />

        {/* 🌟 3. 상세 CRM 장부 & 세부 지표 토글 (Progressive Disclosure) */}
        <section aria-label="고객 장부 상세 보기">
          <button
            type="button"
            aria-expanded={showAdvancedCrm}
            onClick={() => setShowAdvancedCrm(!showAdvancedCrm)}
            className="w-full flex items-center justify-between p-4 rounded-2xl bg-card border border-border hover:bg-muted text-foreground transition-all cursor-pointer min-h-12 shadow-xs"
          >
            <div className="flex items-center gap-3">
              <Sliders className="w-5 h-5 text-primary" />
              <div className="text-left">
                <span className="text-sm font-bold block">
                  고객 성과 상세 분석 & 예약금 원장 장부 보기
                </span>
                <span className="text-xs text-muted-foreground">
                  소희 업무 현황판, 채널별 소통 통계 및 예약금 수납 상세 내역
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-primary">
              <span>{showAdvancedCrm ? '접기' : '펼치기'}</span>
              <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showAdvancedCrm ? 'rotate-180' : ''}`} />
            </div>
          </button>
        </section>

        {showAdvancedCrm && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Sohee Live Workboard (Figma 32:2412) */}
            <SoheeLiveWorkboard workspaceId={workspaceId} />

            {/* Closed-Loop Customer CRM Trace */}
            {isTestAccount && <CustomerClosedLoopTrace workspaceId={workspaceId} />}

            {/* Setup Bridge Header */}
            <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                    소희의 고객 응대 자율권과 금지어 필터는 [나의 소희 ➔ 업무 운영 규정]을 따릅니다.
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    자동 응대, 확인 후 전송, 결재 필요 기준 및 매장 금지어 설정
                  </div>
                </div>
              </div>
              <Link
                href="/app/sohee?tab=rules"
                className="px-3.5 py-1.5 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs font-bold text-primary hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-all flex items-center gap-1.5 shadow-2xs"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>고객 응대 규정 셋업</span>
              </Link>
            </div>

            <span id="reservation-ledger" />
            {/* 3. 🌟 [실제 고객 방문 예약 및 예약금 수납 장부 (Confirmed Bookings & Deposit Ledger)] */}
            <div className="p-6 md:p-7 rounded-3xl bg-white dark:bg-[#121215] border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-100 dark:border-zinc-800">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-state-ok-soft text-state-ok border border-state-ok/30 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>예약 기록</span>
                    </span>
                  </div>
                  <h2 className="text-lg md:text-xl font-extrabold text-zinc-950 dark:text-zinc-50">
                    고객 예약 기록 ({liveReservations.length}건)
                  </h2>
                  <p className="text-xs text-zinc-500 mt-0.5 font-medium">
                    저장된 예약 상태를 보여드려요. 예약 금액과 실제 수납·방문은 달라요.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <CopyBookingRequestLinkButton workspaceId={workspaceId} />
                  <div className="flex items-center gap-2 text-xs font-bold text-zinc-600 dark:text-zinc-400">
                    <span>수납 예약금 총액:</span>
                    <span className="text-sm font-black text-state-ok font-mono">
                      아직 확인할 수 없어요
                    </span>
                  </div>
                </div>
              </div>

              {liveReservations.length === 0 ? (
                <div className="p-8 text-center text-xs text-zinc-500 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl">
                  저장된 예약 기록이 없어요.
                </div>
              ) : (
                <div className="w-full overflow-x-auto pb-2">
                <table className="w-full min-w-[840px] text-left text-xs whitespace-nowrap">
                  <thead>
                    <tr className="border-b border-zinc-100 dark:border-zinc-800 text-zinc-400 font-bold whitespace-nowrap">
                      <th className="py-3 px-3 whitespace-nowrap">고객명 / 연락처</th>
                      <th className="py-3 px-3 whitespace-nowrap">유입 채널</th>
                      <th className="py-3 px-3 whitespace-nowrap">확정 예약 일시</th>
                      <th className="py-3 px-3 whitespace-nowrap">예약 서비스 항목</th>
                      <th className="py-3 px-3 text-right whitespace-nowrap">수납 예약금</th>
                      <th className="py-3 px-3 text-right whitespace-nowrap">예약 상태</th>
                      <th className="py-3 px-3 whitespace-nowrap">소희 CRM 특이사항</th>
                      <th className="py-3 px-3 text-center whitespace-nowrap">알림톡</th>
                      <th className="py-3 px-3 text-center whitespace-nowrap">예약 관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60 font-medium whitespace-nowrap">
                    {liveReservations.map((r: any) => ({
                      id: r.id,
                      rawStatus: r.status,
                      customerName: r.customer_name,
                      phone: r.customer_phone || '-',
                      channelLabel: r.channel_source || '확인 필요',
                      bookingDateTime: r.metadata?.bookingStartsAt ? new Date(r.metadata.bookingStartsAt).toLocaleString('ko-KR') : '예약 시간 확인 필요',
                      rawBookingStartsAt: r.metadata?.bookingStartsAt || r.metadata?.startsAt || '',
                      serviceName: r.service_name,
                      statusLabel: r.status === 'CANCELLED' ? '취소' : r.status === 'CONFIRMED' ? '예약 확정' : r.status === 'AWAITING_CONFIRMATION' ? '신청 대기' : r.status === 'COMPLETED' ? '완료 기록 · 방문 근거 확인 필요' : '확인 필요',
                      crmNote: '예약 기록 · 수납 확인 별도',
                    })).map((bk) => (
                      <tr key={bk.id} id={`reservation-${bk.id}`} className="hover:bg-zinc-50/80 dark:hover:bg-zinc-900/50 transition-colors whitespace-nowrap">
                        <td className="py-4 px-3 whitespace-nowrap">
                          <div className="font-extrabold text-zinc-950 dark:text-zinc-50">{bk.customerName}</div>
                          <div className="text-[11px] text-zinc-400 font-mono">{bk.phone}</div>
                        </td>

                        <td className="py-4 px-3 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-[10px] font-bold">
                            {bk.channelLabel}
                          </span>
                        </td>

                        <td className="py-4 px-3 font-mono font-bold text-primary whitespace-nowrap">
                          {bk.bookingDateTime}
                        </td>

                        <td className="py-4 px-3 font-bold text-zinc-800 dark:text-zinc-200 whitespace-nowrap">
                          {bk.serviceName}
                        </td>

                        <td className="py-4 px-3 text-right font-mono font-black text-state-ok whitespace-nowrap">
                          수납 확인 필요
                        </td>

                        <td className="py-4 px-3 text-right font-mono font-bold text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
                          {bk.statusLabel}
                        </td>

                        <td className="py-4 px-3 text-[11px] text-zinc-500 whitespace-nowrap">
                          {bk.crmNote}
                        </td>

                        <td className="py-4 px-3 text-center whitespace-nowrap">
                          {kakaoByReservation.has(bk.id) ? (
                            <KakaoStatusBadge item={kakaoByReservation.get(bk.id)!} />
                          ) : (
                            <span className="text-zinc-400 font-mono">-</span>
                          )}
                        </td>

                        <td className="py-4 px-3 text-center whitespace-nowrap">
                          {bk.rawStatus === 'CONFIRMED' ? (
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                data-action="reschedule"
                                onClick={() =>
                                  setActionDialogState({
                                    open: true,
                                    mode: 'reschedule',
                                    reservationId: bk.id,
                                    customerName: bk.customerName,
                                    customerPhone: bk.phone,
                                    currentBookingStartsAt: bk.rawBookingStartsAt,
                                    hasKakaoHistory: kakaoByReservation.has(bk.id),
                                  })
                                }
                                className="px-2.5 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-bold transition-colors cursor-pointer"
                              >
                                변경
                              </button>
                              <button
                                type="button"
                                data-action="cancel"
                                onClick={() =>
                                  setActionDialogState({
                                    open: true,
                                    mode: 'cancel',
                                    reservationId: bk.id,
                                    customerName: bk.customerName,
                                    customerPhone: bk.phone,
                                    currentBookingStartsAt: bk.rawBookingStartsAt,
                                    hasKakaoHistory: kakaoByReservation.has(bk.id),
                                  })
                                }
                                className="px-2.5 py-1 rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive text-xs font-bold transition-colors cursor-pointer"
                              >
                                취소
                              </button>
                            </div>
                          ) : bk.rawStatus === 'AWAITING_CONFIRMATION' ? (
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                data-action="confirm"
                                disabled={isConfirmingId === bk.id}
                                onClick={() => handleConfirmReservation(bk.id)}
                                className="px-2.5 py-1 rounded-lg bg-state-ok hover:bg-state-ok/90 text-state-ok-soft text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
                              >
                                {isConfirmingId === bk.id ? '처리 중' : '확정'}
                              </button>
                              <button
                                type="button"
                                data-action="decline"
                                onClick={() =>
                                  setActionDialogState({
                                    open: true,
                                    mode: 'decline',
                                    reservationId: bk.id,
                                    customerName: bk.customerName,
                                    customerPhone: bk.phone,
                                    currentBookingStartsAt: bk.rawBookingStartsAt,
                                    hasKakaoHistory: kakaoByReservation.has(bk.id),
                                  })
                                }
                                className="px-2.5 py-1 rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive text-xs font-bold transition-colors cursor-pointer"
                              >
                                거절
                              </button>
                            </div>
                          ) : (
                            <span className="text-zinc-400 text-xs font-mono">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}
            </div>
          </div>
        )}
          </>
        )}
        {actionDialogState?.open && (
          <ReservationActionsDialog
            open={actionDialogState.open}
            mode={actionDialogState.mode}
            workspaceId={workspaceId}
            reservationId={actionDialogState.reservationId}
            customerName={actionDialogState.customerName}
            customerPhone={actionDialogState.customerPhone}
            hasKakaoHistory={actionDialogState.hasKakaoHistory}
            currentBookingStartsAt={actionDialogState.currentBookingStartsAt}
            onClose={() => setActionDialogState(null)}
            onDone={fetchPipeline}
          />
        )}
      </div>
    </V088AppShell>
  )
}
