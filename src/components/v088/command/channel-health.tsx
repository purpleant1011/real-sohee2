'use client'

import React from 'react'
import { FileText, MessageCircle, ShoppingBag, CheckCircle2, AlertCircle, RefreshCw, Share2, Camera } from 'lucide-react'

export interface ChannelStatusItem {
  id: string
  name: string
  icon: 'instagram' | 'threads' | 'naver' | 'daangn'
  status: 'healthy' | 'warning' | 'disconnected'
  lastSyncAt: string
  detailMessage: string
}

interface ChannelHealthProps {
  channels?: ChannelStatusItem[]
  onReconnect?: (id: string) => void
}

export function ChannelHealth({
  channels = [
    {
      id: 'ch-ig',
      name: '인스타그램 (@instagram_account)',
      icon: 'instagram',
      status: 'healthy',
      lastSyncAt: '5분 전',
      detailMessage: '연결 정상 (게시 API, 웹훅 활성)'
    },
    {
      id: 'ch-threads',
      name: '스레드 (@sohee.ai)',
      icon: 'threads',
      status: 'healthy',
      lastSyncAt: '12분 전',
      detailMessage: '연결 정상 (스레드 게시 API 활성)'
    },
    {
      id: 'ch-naver',
      name: '네이버 블로그 (공식 블로그)',
      icon: 'naver',
      status: 'healthy',
      lastSyncAt: '1시간 전',
      detailMessage: '원고 준비 및 복사 지원'
    },
    {
      id: 'ch-daangn',
      name: '당근마켓 비즈프로필 (동네 소식)',
      icon: 'daangn',
      status: 'healthy',
      lastSyncAt: '2시간 전',
      detailMessage: '동네 소식 원고 및 프로필 안내 구성'
    }
  ],
  onReconnect
}: ChannelHealthProps) {
  const allHealthy = channels.length > 0 && channels.every((ch) => ch.status === 'healthy')

  return (
    <div className="p-5 md:p-6 rounded-2xl bg-[var(--v088-surface)] border border-[var(--v088-border)] shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-base tracking-tight">마케팅 채널 연동 상태</h3>
        {allHealthy ? (
          <span className="text-xs text-state-ok font-semibold flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            모든 채널 정상 작동 중
          </span>
        ) : (
          <span className="text-xs text-state-warn font-semibold flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5" />
            채널 상태 확인 필요
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {channels.map((ch) => (
          <div
            key={ch.id}
            className="p-3.5 rounded-xl bg-[var(--v088-surface-subtle)] border border-[var(--v088-border-subtle)] flex flex-col justify-between group hover:border-state-ok/30 transition-colors"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-[var(--v088-ink)]">{ch.name}</span>
                <span className="w-2 h-2 rounded-full bg-state-ok" />
              </div>
              <p className="text-[11px] text-[var(--v088-muted)] leading-relaxed">{ch.detailMessage}</p>
            </div>
            <div className="mt-3 pt-2 border-t border-[var(--v088-border-subtle)] flex items-center justify-between">
              <span className="text-[10px] text-[var(--v088-muted)] font-mono">
                {ch.lastSyncAt}
              </span>
              <button
                onClick={() => onReconnect?.(ch.id)}
                className="text-[10px] font-bold text-zinc-500 hover:text-state-ok flex items-center gap-1 cursor-pointer"
                title="상태 새로고침"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                <span>동기화</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
