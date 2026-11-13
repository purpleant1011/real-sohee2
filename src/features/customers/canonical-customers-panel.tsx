'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  Users,
  Search,
  Calendar,
  Phone,
  MessageSquare,
  AlertCircle,
  RefreshCw,
} from 'lucide-react'
import { KakaoStatusBadge } from '@/features/kakao/history/history-badge'
import { formatKstHistoryTime } from '@/features/kakao/history/history-list'
import type { KakaoHistoryItem, KakaoHistoryResponse } from '@/features/kakao/history/contract'
import type { CanonicalCustomerItem, CanonicalCustomersResponse } from './canonical-contract'
import { cn } from '@/lib/utils'

export interface CanonicalCustomersPanelProps {
  workspaceId: string
  className?: string
}

export function CanonicalCustomersPanel({
  workspaceId,
  className,
}: CanonicalCustomersPanelProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [customers, setCustomers] = useState<CanonicalCustomerItem[]>([])
  const [customerLoad, setCustomerLoad] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [customerTick, setCustomerTick] = useState(0)

  const retryCustomers = useCallback(() => {
    setCustomerLoad('loading')
    setCustomerTick((prev) => prev + 1)
  }, [])

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value)
    setCustomerLoad('loading')
  }, [])

  useEffect(() => {
    if (!workspaceId) return
    const controller = new AbortController()

    const timer = setTimeout(() => {
      const q = searchQuery.trim()
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      params.set('limit', '50')

      const url = `/api/workspaces/${encodeURIComponent(workspaceId)}/customers/canonical?${params.toString()}`

      fetch(url, {
        signal: controller.signal,
        cache: 'no-store',
      })
        .then(async (res) => {
          if (!res.ok) throw new Error('failed_to_fetch_canonical_customers')
          const data = (await res.json()) as CanonicalCustomersResponse
          setCustomers(Array.isArray(data.items) ? data.items : [])
          setCustomerLoad('ready')
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return
          setCustomerLoad('error')
        })
    }, 200)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [workspaceId, searchQuery, customerTick])

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId) || null

  return (
    <section
      aria-label="예약 고객(번호 기준)"
      className={cn(
        'p-6 md:p-7 rounded-3xl bg-card border border-border shadow-xs space-y-5',
        className,
      )}
    >
      {/* 헤더 및 검색 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 flex items-center gap-1">
              <Users className="w-3 h-3" />
              <span>정본 고객 관리</span>
            </span>
          </div>
          <h2 className="text-lg md:text-xl font-extrabold text-foreground">
            예약 고객(번호 기준)
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5 font-medium">
            전화번호 기준으로 통합된 고객의 예약 횟수와 알림톡 발송 이력을 확인할 수 있어요.
          </p>
        </div>

        {/* 검색창 */}
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="고객 이름 검색"
            aria-label="고객 이름 검색"
            className="w-full rounded-xl border border-input bg-background pl-9 pr-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {/* 상태에 따른 본문 표시 */}
      {customerLoad === 'loading' ? (
        <div role="status" className="p-12 text-center space-y-3">
          <div className="w-8 h-8 mx-auto border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-muted-foreground">고객 목록을 불러오는 중입니다...</p>
        </div>
      ) : customerLoad === 'error' ? (
        <div
          role="alert"
          className="p-8 rounded-2xl border border-destructive/20 bg-destructive/5 text-center space-y-3"
        >
          <div className="w-10 h-10 mx-auto rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
            <AlertCircle className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-bold text-destructive">
              고객 정보를 불러오지 못했어요
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              네트워크 상태를 확인하고 다시 시도해 주세요.
            </p>
          </div>
          <button
            type="button"
            onClick={retryCustomers}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-border bg-background hover:bg-muted text-xs font-semibold text-foreground transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>다시 시도</span>
          </button>
        </div>
      ) : customers.length === 0 ? (
        <div className="p-12 text-center text-xs text-muted-foreground border border-dashed border-border rounded-2xl bg-muted/10 space-y-2">
          <Users className="w-8 h-8 mx-auto text-muted-foreground/60 mb-2" />
          <p className="font-semibold text-foreground text-sm">
            번호가 있는 예약이 등록되면 여기에 모여요
          </p>
          <p className="text-muted-foreground text-xs">
            신규 예약이 등록되면 전화번호(010) 기준으로 고객이 자동 생성됩니다.
          </p>
        </div>
      ) : (
        /* 고객 목록 & 발송내역 상세 (2단 레이아웃) */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* 고객 목록 테이블 (좌측 7컬럼) */}
          <div className="lg:col-span-7 overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-muted-foreground font-bold">
                  <th className="py-3 px-4">고객명</th>
                  <th className="py-3 px-4">연락처</th>
                  <th className="py-3 px-4 text-center">예약 건수</th>
                  <th className="py-3 px-4">최근 예약 일시</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 font-medium">
                {customers.map((cust) => {
                  const isSelected = selectedCustomerId === cust.id
                  const formattedBookingTime = cust.lastBookingStartsAt
                    ? formatKstHistoryTime(cust.lastBookingStartsAt)
                    : '-'

                  return (
                    <tr
                      key={cust.id}
                      onClick={() => setSelectedCustomerId(cust.id)}
                      className={cn(
                        'hover:bg-muted/40 transition-colors cursor-pointer',
                        isSelected && 'bg-primary/10 font-bold',
                      )}
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center text-[10px] shrink-0">
                            {cust.displayName.slice(0, 1) || '고'}
                          </div>
                          <span className="text-foreground">{cust.displayName}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <Phone className="w-3 h-3 text-muted-foreground/70" />
                          {cust.phoneMasked}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <div className="inline-flex items-center gap-1.5">
                          <span className="px-2 py-0.5 rounded-full bg-muted text-foreground text-[11px] font-mono font-bold">
                            {cust.reservationCount}건
                          </span>
                          {typeof cust.conversationCount === 'number' && cust.conversationCount > 0 ? (
                            <span className="px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground text-[11px] font-mono font-bold">
                              대화 {cust.conversationCount}건
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-muted-foreground font-mono text-[11px]">
                        <span className="flex items-center gap-1.5">
                          <Calendar className="w-3 h-3 text-muted-foreground/70" />
                          {formattedBookingTime}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* 알림톡 발송내역 상세 (우측 5컬럼) */}
          <div className="lg:col-span-5 rounded-2xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary" />
                <h3 className="font-bold text-sm text-foreground">
                  카카오 안내 발송내역
                </h3>
              </div>
              {selectedCustomer && (
                <span className="text-xs font-bold text-primary font-mono">
                  {selectedCustomer.displayName} ({selectedCustomer.phoneMasked})
                </span>
              )}
            </div>

            {selectedCustomer ? (
              <CustomerKakaoHistoryList
                key={selectedCustomer.id}
                workspaceId={workspaceId}
                customerUuid={selectedCustomer.id}
              />
            ) : (
              <div className="p-8 text-center text-xs text-muted-foreground border border-dashed border-border rounded-xl">
                목록에서 고객을 선택하면 카카오 안내 발송내역을 확인할 수 있어요.
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * 특정 customerUuid에 대한 카카오 안내 발송내역 목록 컴포넌트
 */
function CustomerKakaoHistoryList({
  workspaceId,
  customerUuid,
}: {
  workspaceId: string
  customerUuid: string
}) {
  const [items, setItems] = useState<KakaoHistoryItem[]>([])
  const [load, setLoad] = useState<'loading' | 'ready' | 'error'>('loading')
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => {
    setLoad('loading')
    setTick((prev) => prev + 1)
  }, [])

  useEffect(() => {
    if (!workspaceId || !customerUuid) return
    const controller = new AbortController()

    fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/kakao/outbox?customerUuid=${encodeURIComponent(customerUuid)}&limit=50`,
      {
        signal: controller.signal,
        cache: 'no-store',
      },
    )
      .then(async (res) => {
        if (!res.ok) throw new Error('kakao_history_failed')
        const data = (await res.json()) as KakaoHistoryResponse
        setItems(Array.isArray(data.items) ? data.items : [])
        setLoad('ready')
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setLoad('error')
      })

    return () => controller.abort()
  }, [workspaceId, customerUuid, tick])

  if (load === 'loading') {
    return (
      <div role="status" aria-label="발송내역을 불러오는 중입니다" className="space-y-2.5">
        <div className="p-3 rounded-xl border border-border bg-card space-y-2 animate-pulse">
          <div className="flex items-center justify-between">
            <div className="h-4 w-28 bg-muted rounded" />
            <div className="h-4 w-16 bg-muted rounded-full" />
          </div>
          <div className="h-3 w-36 bg-muted/70 rounded" />
        </div>
        <div className="p-3 rounded-xl border border-border bg-card space-y-2 animate-pulse">
          <div className="flex items-center justify-between">
            <div className="h-4 w-32 bg-muted rounded" />
            <div className="h-4 w-16 bg-muted rounded-full" />
          </div>
          <div className="h-3 w-40 bg-muted/70 rounded" />
        </div>
      </div>
    )
  }

  if (load === 'error') {
    return (
      <div
        role="alert"
        className="p-4 rounded-xl border border-destructive/20 bg-destructive/5 text-center space-y-2.5"
      >
        <p className="text-xs font-semibold text-destructive">
          발송내역을 불러오지 못했어요
        </p>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold rounded-lg border border-border bg-background hover:bg-muted text-foreground transition-colors cursor-pointer"
        >
          다시 시도
        </button>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="p-6 text-center text-xs text-muted-foreground border border-dashed border-border rounded-xl bg-card/50">
        아직 보낸 안내가 없어요
      </div>
    )
  }

  return (
    <ul className="divide-y divide-border/60 rounded-xl border border-border bg-card max-h-[360px] overflow-y-auto">
      {items.map((item) => {
        const timeText = formatKstHistoryTime(item.updatedAt || item.dueAt)
        return (
          <li key={item.id} className="p-3 space-y-1">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <span className="font-semibold text-xs text-foreground truncate">
                {item.eventLabel}
              </span>
              <KakaoStatusBadge item={item} />
            </div>

            {timeText && (
              <div className="text-[11px] text-muted-foreground font-mono">
                {timeText}
              </div>
            )}

            {item.detailLabel && (
              <p className="text-[11px] text-muted-foreground leading-relaxed pt-0.5">
                {item.detailLabel}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}
