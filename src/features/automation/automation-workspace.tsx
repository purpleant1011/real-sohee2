'use client'

import React, { useState } from 'react'
import {
  Clock,
  Sparkles,
  ShieldCheck,
  Plus
} from 'lucide-react'
import Link from 'next/link'
import { useEffect } from 'react'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'
import { mapChannelsApi } from '@/features/mobile-channels/channels-api-mapper'

const DEMO_CHANNELS = [
  { id: 'naver_blog', name: '네이버 블로그', account: 'naver_blog_official', status: 'active', autoPublish: false, scheduleDesc: '주 3회 (화·목·토 14:00)' },
  { id: 'instagram', name: '인스타그램 피드/릴스', account: '@instagram_account', status: 'active', autoPublish: true, scheduleDesc: '주 4회 (월·수·금·일 18:30)' },
  { id: 'daangn', name: '당근 비즈프로필', account: '우리동네 매장', status: 'active', autoPublish: false, scheduleDesc: '주 2회 (화·금 11:00)' },
  { id: 'threads', name: '스레드 (Threads)', account: '@threads_account', status: 'active', autoPublish: true, scheduleDesc: '매일 1회 (17:00 숏폼)' },
]

const DEFAULT_CLEAN_CHANNELS = [
  { id: 'naver_blog', name: '네이버 블로그', account: '미연동 (연동 필요)', status: 'unlinked', autoPublish: false, scheduleDesc: '주 3회 추천 (화·목·토 14:00)' },
  { id: 'instagram', name: '인스타그램 피드/릴스', account: '미연동 (연동 필요)', status: 'unlinked', autoPublish: false, scheduleDesc: '주 4회 추천 (월·수·금·일 18:30)' },
  { id: 'daangn', name: '당근 비즈프로필', account: '미연동 (연동 필요)', status: 'unlinked', autoPublish: false, scheduleDesc: '주 2회 추천 (화·금 11:00)' },
  { id: 'threads', name: '스레드 (Threads)', account: '미연동 (연동 필요)', status: 'unlinked', autoPublish: false, scheduleDesc: '매일 1회 추천 (17:00 숏폼)' },
]

export function AutomationWorkspace() {
  const [activeMainTab, setActiveMainTab] = useState<'schedule' | 'wizard' | 'badges'>('schedule')
  const [selectedDay, setSelectedDay] = useState<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'>('mon')
  const [channels, setChannels] = useState(DEFAULT_CLEAN_CHANNELS)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    try {
      const supabase = createBrowserSupabaseClient()
      supabase.auth.getUser().then(({ data }) => {
        if (cancelled) return
        if (data?.user?.email === 'test@example.com') {
          setChannels(DEMO_CHANNELS)
        }
      })
    } catch {}

    fetch('/api/channels')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data || typeof data !== 'object') return
        const { channels: mapped } = mapChannelsApi(data)
        setChannels((prev) =>
          prev.map((ch) => {
            const found = mapped.find((m) => m.id === ch.id)
            if (!found) return ch
            const isConnected =
              found.level === 'publish_verified' ||
              found.level === 'account_connected' ||
              found.level === 'permission_granted'
            if (isConnected) {
              const raw = data as Record<string, Record<string, unknown> | undefined>
              const apiKey = ch.id === 'naver_blog' ? 'naverBlog' : ch.id
              const rawAccount = (raw[apiKey]?.accountName || raw[apiKey]?.accountLabel) as string | undefined
              return {
                ...ch,
                status: 'active',
                account: rawAccount
                  ? rawAccount.startsWith('@')
                    ? rawAccount
                    : `@${rawAccount}`
                  : '연결됨',
              }
            }
            return {
              ...ch,
              status: 'unlinked',
              account: '미연동 (연동 필요)',
            }
          })
        )
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [])

  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3000)
  }

  const toggleChannelAutoPublish = (id: string) => {
    setChannels(prev => prev.map(c => {
      if (c.id === id) {
        const next = !c.autoPublish
        const actionLabel = c.id === 'naver_blog' || c.id === 'daangn' ? '초안 자동 준비가' : '자동 포스팅이'
        showToast(`${c.name} ${actionLabel} ${next ? '활성화' : '일시정지'}되었습니다.`)
        return { ...c, autoPublish: next }
      }
      return c
    }))
  }

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl bg-zinc-900 text-white text-xs font-semibold shadow-xl border border-zinc-700 animate-in fade-in slide-in-from-bottom-2">
          {toastMessage}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-zinc-400 mb-1">
            <span>자동화</span>
            <span>/</span>
            <span className="text-purple-600 dark:text-purple-400">자동화 & 소희의 근무표</span>
          </div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            소희의 주간 근무표 & 자동화 관제
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            인스타그램은 예약된 일정에 맞춰 자동으로 콘텐츠를 발행하고, 네이버 블로그와 당근마켓은 원고·사진을 준비하며 실시간으로 응대합니다.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/app/content"
            className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>새 콘텐츠 시안 만들기</span>
          </Link>
        </div>
      </div>

      {/* Main Tab Switcher */}
      <div className="flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-800 pb-2">
        <button
          onClick={() => setActiveMainTab('schedule')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
            activeMainTab === 'schedule'
              ? 'bg-purple-600 text-white shadow-xs'
              : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
          }`}
        >
          주간 근무표
        </button>
        <button
          onClick={() => setActiveMainTab('wizard')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
            activeMainTab === 'wizard'
              ? 'bg-purple-600 text-white shadow-xs'
              : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
          }`}
        >
          자동화 생성 마법사
        </button>
        <button
          onClick={() => setActiveMainTab('badges')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
            activeMainTab === 'badges'
              ? 'bg-purple-600 text-white shadow-xs'
              : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
          }`}
        >
          채널별 연동 신뢰 뱃지
        </button>
      </div>

      {/* Tab 1: Weekly Schedule */}
      {activeMainTab === 'schedule' && (
        <div className="space-y-6">
          {/* Day Tabs */}
          <div role="tablist" className="flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-900 rounded-xl overflow-x-auto">
            <button
              role="tab"
              aria-selected={selectedDay === 'mon'}
              onClick={() => setSelectedDay('mon')}
              className={`min-h-10 shrink-0 whitespace-nowrap px-3.5 py-1.5 rounded-lg text-sm font-bold transition-all ${selectedDay === 'mon' ? 'bg-white dark:bg-zinc-800 text-purple-600 shadow-xs' : 'text-zinc-500'}`}
            >
              월요일
            </button>
            <button
              role="tab"
              aria-selected={selectedDay === 'tue'}
              onClick={() => setSelectedDay('tue')}
              className={`min-h-10 shrink-0 whitespace-nowrap px-3.5 py-1.5 rounded-lg text-sm font-bold transition-all ${selectedDay === 'tue' ? 'bg-white dark:bg-zinc-800 text-purple-600 shadow-xs' : 'text-zinc-500'}`}
            >
              화요일
            </button>
            <button
              role="tab"
              aria-selected={selectedDay === 'wed'}
              onClick={() => setSelectedDay('wed')}
              className={`min-h-10 shrink-0 whitespace-nowrap px-3.5 py-1.5 rounded-lg text-sm font-bold transition-all ${selectedDay === 'wed' ? 'bg-white dark:bg-zinc-800 text-purple-600 shadow-xs' : 'text-zinc-500'}`}
            >
              수요일
            </button>
            <button
              role="tab"
              aria-selected={selectedDay === 'thu'}
              onClick={() => setSelectedDay('thu')}
              className={`min-h-10 shrink-0 whitespace-nowrap px-3.5 py-1.5 rounded-lg text-sm font-bold transition-all ${selectedDay === 'thu' ? 'bg-white dark:bg-zinc-800 text-purple-600 shadow-xs' : 'text-zinc-500'}`}
            >
              목요일
            </button>
            <button
              role="tab"
              aria-selected={selectedDay === 'fri'}
              onClick={() => setSelectedDay('fri')}
              className={`min-h-10 shrink-0 whitespace-nowrap px-3.5 py-1.5 rounded-lg text-sm font-bold transition-all ${selectedDay === 'fri' ? 'bg-white dark:bg-zinc-800 text-purple-600 shadow-xs' : 'text-zinc-500'}`}
            >
              금요일
            </button>
            <button
              role="tab"
              aria-selected={selectedDay === 'sat'}
              onClick={() => setSelectedDay('sat')}
              className={`min-h-10 shrink-0 whitespace-nowrap px-3.5 py-1.5 rounded-lg text-sm font-bold transition-all ${selectedDay === 'sat' ? 'bg-white dark:bg-zinc-800 text-purple-600 shadow-xs' : 'text-zinc-500'}`}
            >
              토요일
            </button>
            <button
              role="tab"
              aria-selected={selectedDay === 'sun'}
              onClick={() => setSelectedDay('sun')}
              className={`min-h-10 shrink-0 whitespace-nowrap px-3.5 py-1.5 rounded-lg text-sm font-bold transition-all ${selectedDay === 'sun' ? 'bg-white dark:bg-zinc-800 text-purple-600 shadow-xs' : 'text-zinc-500'}`}
            >
              일요일
            </button>
          </div>

          {/* Routine Blocks */}
          <div className="p-5 rounded-2xl bg-white dark:bg-[#121215] border border-zinc-200 dark:border-zinc-800 space-y-3">
            <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
              {selectedDay === 'mon' ? '월요일 정기 루틴 업무' : selectedDay === 'tue' ? '화요일 정기 루틴 업무' : '요일별 정기 루틴 업무'}
            </h3>
            <p className="text-xs text-zinc-500">
              아침 09:00 상권 기회 분석, 14:00 네이버 블로그 원고 준비, 18:00 인스타그램 피드 포스팅
            </p>
          </div>

          {/* Real-Time Detection Rules */}
          <div className="p-5 rounded-2xl bg-white dark:bg-[#121215] border border-zinc-200 dark:border-zinc-800 space-y-3">
            <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
              실시간 알림 확인 및 응대 규칙
            </h3>
            <p className="text-xs text-zinc-500">
              인스타 DM이나 예약 문의가 들어오면 10분 안에 정성스러운 답변 초안을 작성해 드려요.
            </p>
          </div>

          {/* 1. 채널별 자동 포스팅 런타임 상태 & 스위치 (4 Cards) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {channels.map((channel) => {
              const isUnlinked = channel.status === 'unlinked'
              return (
                <div
                  key={channel.id}
                  className="p-4 rounded-xl bg-white dark:bg-[#121215] border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                        {channel.name}
                      </span>
                      {isUnlinked ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          미연동
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          정상 연동
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono mb-2">
                      {channel.account}
                    </p>
                    <div className="text-[11px] text-zinc-600 dark:text-zinc-300 flex items-center gap-1 mb-3">
                      <Clock className="w-3 h-3 text-zinc-400" />
                      <span>{channel.scheduleDesc}</span>
                    </div>
                  </div>

                  <div className="pt-2.5 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between">
                    <span className="text-[11px] font-medium text-zinc-500">
                      {channel.id === 'naver_blog' || channel.id === 'daangn' ? '초안 자동 준비' : '자동 발행'}
                    </span>
                    {isUnlinked ? (
                      <Link
                        href="/app/settings/channels"
                        className="px-2.5 py-1 rounded-lg text-xs font-bold bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 hover:bg-purple-100 transition-colors"
                      >
                        채널 연동
                      </Link>
                    ) : (
                      <button
                        onClick={() => toggleChannelAutoPublish(channel.id)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                          channel.autoPublish
                            ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 border border-zinc-200 dark:border-zinc-700'
                        }`}
                      >
                        {channel.autoPublish ? '켜짐 (자동)' : '일시정지'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Tab 2: Automation Wizard */}
      {activeMainTab === 'wizard' && (
        <div className="p-6 rounded-2xl bg-white dark:bg-[#121215] border border-zinc-200 dark:border-zinc-800 space-y-4">
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Plus className="w-4 h-4 text-purple-600" />
            <span>새 자동화 만들기 (마법사)</span>
          </h2>
          <p className="text-xs text-zinc-500">
            원하는 트리거 조건과 실행할 채널, 발행 시각을 지정하여 소희의 새 자동화 루틴을 등록합니다.
          </p>
        </div>
      )}

      {/* Tab 3: Channel Trust Badges & Policy */}
      {activeMainTab === 'badges' && (
        <div className="p-6 rounded-2xl bg-white dark:bg-[#121215] border border-zinc-200 dark:border-zinc-800 space-y-4">
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-purple-600" />
            <span>채널별 연동 신뢰 뱃지 & 실행 정책</span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
            <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <div>
                <div className="font-bold text-xs">인스타그램 공식 연동</div>
                <div className="text-[10px] text-zinc-500">피드/릴스 발행 권한</div>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950 text-emerald-700 font-bold">
                공식 자동연동
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <div>
                <div className="font-bold text-xs">네이버 블로그 원고 및 사진 보관함</div>
                <div className="text-[10px] text-zinc-500">원고·사진 준비 및 미리보기</div>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950 text-emerald-700 font-bold">
                원고 준비 지원
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
