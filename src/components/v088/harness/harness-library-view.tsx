'use client'

import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles,
  Link as LinkIcon,
  Search,
  Filter,
  Layers,
  Cpu,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Clock,
  ArrowUpRight,
  Plus,
  Play,
  RotateCcw,
  Sliders,
  FileText,
  BarChart3,
  Globe,
  Radio,
  ExternalLink,
  ChevronRight
} from 'lucide-react'
import { HarnessAsset, PlatformType, HarnessStatus } from '@/types/harness'
import { harnessStore } from '@/lib/harness/harness-store'

import { useWorkspaceId } from '@/hooks/use-workspace-context'

interface HarnessLibraryViewProps {
  onSelectHarness: (harnessId: string) => void
  onOpenCreateModal: () => void
  workspaceId?: string
}

import { useEffect } from 'react'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'

export function HarnessLibraryView({ onSelectHarness, onOpenCreateModal, workspaceId: propWorkspaceId }: HarnessLibraryViewProps) {
  const currentWorkspaceId = useWorkspaceId(propWorkspaceId)
  const [searchQuery, setSearchQuery] = useState('')
  const [platformFilter, setPlatformFilter] = useState<PlatformType | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<HarnessStatus | 'all'>('all')
  const [isTestAccount, setIsTestAccount] = useState(false)
  const [storeName, setStoreName] = useState('우리 매장')

  useEffect(() => {
    try {
      const supabase = createBrowserSupabaseClient()
      supabase.auth.getUser().then((res: any) => {
        if (res.data?.user?.email === 'test@example.com') {
          setIsTestAccount(true)
        } else {
          setIsTestAccount(false)
          if (res.data?.user) {
            supabase
              .from('business_profiles')
              .select('*')
              .limit(1)
              .maybeSingle()
              .then((pRes: any) => {
                const profile = pRes.data
                if (profile?.business_name) setStoreName(profile.business_name)
              })
          }
        }
      })
    } catch {}
  }, [])

  const rawAssets = isTestAccount ? harnessStore.getAssets(currentWorkspaceId) : []
  const assignments = isTestAccount ? harnessStore.getAssignments(currentWorkspaceId) : []

  const filteredAssets = rawAssets.filter(asset => {
    if (platformFilter !== 'all' && asset.platform !== platformFilter) return false
    if (statusFilter !== 'all' && asset.overallStatus !== statusFilter) return false
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      return (
        asset.title.toLowerCase().includes(q) ||
        asset.sourceUrl.toLowerCase().includes(q) ||
        asset.coreDna.some(dna => dna.toLowerCase().includes(q))
      )
    }
    return true
  })

  // Stats
  const activeChannelsCount = assignments.filter(a => a.enabled).length

  return (
    <div className="space-y-6">
      {/* 1. 상단 통계 바 (KPI Bento Stats) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-white dark:bg-[#18181B] border border-zinc-200 dark:border-zinc-800 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 text-xs font-semibold mb-2">
            <span>보유 비법노트</span>
            <Layers className="w-4 h-4 text-state-ok" />
          </div>
          <div className="text-2xl font-black text-zinc-900 dark:text-zinc-50">
            {rawAssets.length} <span className="text-xs font-medium text-zinc-400">개 스타일</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-state-ok font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>우리 매장 전용 안전 보관</span>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-[#18181B] border border-zinc-200 dark:border-zinc-800 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 text-xs font-semibold mb-2">
            <span>연결된 SNS 채널</span>
            <Radio className="w-4 h-4 text-state-wait" />
          </div>
          <div className="text-2xl font-black text-zinc-900 dark:text-zinc-50">
            {activeChannelsCount} <span className="text-xs font-medium text-zinc-400">개 채널 연동</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-state-wait font-medium">
            <span>인스타 · 스레드 · 네이버 블로그</span>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-[#18181B] border border-zinc-200 dark:border-zinc-800 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 text-xs font-semibold mb-2">
            <span>하루 운영 지원</span>
            <Cpu className="w-4 h-4 text-state-warn" />
          </div>
          <div className="text-2xl font-black text-zinc-900 dark:text-zinc-50">
            정상 지원 <span className="text-xs font-medium text-zinc-400">자동 운영</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-state-warn font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>콘텐츠 구성 및 답변 추천 포함</span>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-gradient-to-br from-primary/10 via-state-ok/10 to-transparent border border-primary/20 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground dark:text-primary">새 비법 배우기</span>
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 my-1">
            잘나가는 인스타나 블로그 주소만 넣으면 3분 만에 비법을 배웁니다.
          </p>
          <button
            onClick={onOpenCreateModal}
            className="w-full py-2 px-3 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>+ 링크로 비법 배우기</span>
          </button>
        </div>
      </div>

      {/* 2. 컨트롤 바 (검색, 필터, 생성 버튼) */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 rounded-2xl bg-white dark:bg-[#18181B] border border-zinc-200 dark:border-zinc-800 shadow-sm">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="비법 이름, 주소, 핵심 특징 검색..."
              className="w-full pl-9 pr-3.5 py-2 text-sm rounded-xl bg-zinc-100 dark:bg-zinc-900 border-none text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:ring-2 focus:ring-state-ok/50"
            />
          </div>

          {/* 플랫폼 필터 */}
          <div className="flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-900 rounded-xl text-xs font-semibold">
            {(['all', 'instagram', 'threads', 'naver_blog'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPlatformFilter(p)}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  platformFilter === p
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                {p === 'all'
                  ? '전체'
                  : p === 'instagram'
                  ? '인스타그램'
                  : p === 'threads'
                  ? '스레드'
                  : '네이버 블로그'}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={onOpenCreateModal}
          className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-state-ok hover:bg-state-ok/90 text-white text-sm font-bold shadow-md shadow-state-ok/20 transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>링크로 비법 만들기</span>
        </button>
      </div>

      {/* 3. 하네스 카드 그리드 (Bento Cards) */}
      {filteredAssets.length === 0 ? (
        <div className="p-12 text-center rounded-3xl bg-white dark:bg-[#18181B] border border-dashed border-zinc-300 dark:border-zinc-800 space-y-4">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-state-ok-soft text-state-ok flex items-center justify-center shadow-inner">
            <Layers className="w-7 h-7" />
          </div>
          <div className="max-w-md mx-auto space-y-1.5">
            <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-100">
              {storeName}만의 첫 비법을 등록해 보세요
            </h3>
            <p className="text-xs text-zinc-500 leading-relaxed">
              사장님의 인스타그램 또는 네이버 블로그 링크를 등록하시면, 소희가 매장 고유의 말투, 비주얼 톤앤매너, 핵심 서비스·상품 DNA를 3분 만에 학습하여 전용 비법을 생성합니다.
            </p>
          </div>
          <button
            onClick={onOpenCreateModal}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-state-ok hover:bg-state-ok/90 text-white font-bold text-xs shadow-md shadow-state-ok/20 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>SNS 링크로 {storeName} 비법 만들기</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {filteredAssets.map(asset => {
          const isByreum = asset.id.includes('byreum')
          return (
            <motion.div
              key={asset.id}
              whileHover={{ y: -2 }}
              transition={{ duration: 0.15 }}
              onClick={() => onSelectHarness(asset.id)}
              className="p-6 rounded-3xl bg-white dark:bg-[#18181B] border border-zinc-200 dark:border-zinc-800 hover:border-state-ok/50 dark:hover:border-state-ok/50 shadow-sm hover:shadow-md transition-all cursor-pointer flex flex-col justify-between group"
            >
              <div>
                {/* 카드 상단 배지 & 플랫폼 */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
                        asset.platform === 'instagram'
                          ? 'bg-primary/10 text-primary border border-primary/20'
                          : asset.platform === 'threads'
                          ? 'bg-zinc-900/10 dark:bg-zinc-100/10 text-zinc-900 dark:text-zinc-100 border border-zinc-500/20'
                          : 'bg-state-ok/10 text-state-ok border border-state-ok/20'
                      }`}
                    >
                      <Globe className="w-3 h-3" />
                      {asset.platform === 'instagram'
                        ? '인스타그램'
                        : asset.platform === 'threads'
                        ? '스레드'
                        : '네이버 블로그'}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
                      v{asset.activeVersionNo}.0
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                        asset.overallStatus === 'READY'
                          ? 'bg-state-ok/10 text-state-ok'
                          : 'bg-state-warn/10 text-state-warn'
                      }`}
                    >
                      {asset.overallStatus === 'READY' ? '● 가동 가능' : '▲ 부분 준비'}
                    </span>
                  </div>
                </div>

                {/* 하네스 타이틀 & URL */}
                <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-50 group-hover:text-state-ok dark:group-hover:text-state-ok transition-colors line-clamp-1 mb-1">
                  {asset.title}
                </h3>
                <p className="text-xs font-mono text-zinc-400 dark:text-zinc-500 flex items-center gap-1 mb-4 truncate">
                  <LinkIcon className="w-3 h-3 flex-shrink-0" />
                  {asset.sourceUrl}
                </p>

                {/* 3대 핵심 DNA 태그 */}
                <div className="space-y-1.5 mb-5">
                  <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block">
                    3대 핵심 운영 특징
                  </span>
                  {asset.coreDna.map((dna, idx) => (
                    <div
                      key={idx}
                      className="text-xs font-medium text-zinc-700 dark:text-zinc-300 flex items-start gap-2 bg-zinc-50 dark:bg-zinc-900/60 px-3 py-1.5 rounded-xl border border-zinc-100 dark:border-zinc-800/80"
                    >
                      <span className="text-state-ok font-bold">#{idx + 1}</span>
                      <span className="line-clamp-1">{dna}</span>
                    </div>
                  ))}
                </div>

                {/* 5대 모듈 준비도 뱃지 (Text, Visual, Ops, Community, Platform) */}
                <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800/60">
                  <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block mb-2">
                    5대 업무 영역 준비 상태
                  </span>
                  <div className="grid grid-cols-5 gap-1 text-center">
                    <div className="p-1.5 rounded-lg bg-state-ok-soft border border-state-ok/30">
                      <div className="text-[10px] text-zinc-400 font-medium">글작성</div>
                      <div className="text-xs font-bold text-state-ok">준비 완료</div>
                    </div>
                    <div className="p-1.5 rounded-lg bg-state-warn-soft border border-state-warn/30">
                      <div className="text-[10px] text-zinc-400 font-medium">이미지</div>
                      <div className="text-xs font-bold text-state-warn">보완 중</div>
                    </div>
                    <div className="p-1.5 rounded-lg bg-state-ok-soft border border-state-ok/30">
                      <div className="text-[10px] text-zinc-400 font-medium">운영</div>
                      <div className="text-xs font-bold text-state-ok">준비 완료</div>
                    </div>
                    <div className="p-1.5 rounded-lg bg-state-warn-soft border border-state-warn/30">
                      <div className="text-[10px] text-zinc-400 font-medium">댓글답변</div>
                      <div className="text-xs font-bold text-state-warn">보완 중</div>
                    </div>
                    <div className="p-1.5 rounded-lg bg-state-ok-soft border border-state-ok/30">
                      <div className="text-[10px] text-zinc-400 font-medium">채널연결</div>
                      <div className="text-xs font-bold text-state-ok">준비 완료</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 카드 하단 액션 & 메타 정보 */}
              <div className="mt-5 pt-4 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  <span>운영 상태: </span>
                  <span className="font-bold text-zinc-900 dark:text-zinc-200">
                    자동 운영 지원
                  </span>
                </div>

                <div className="flex items-center gap-1 text-xs font-bold text-state-ok group-hover:translate-x-1 transition-transform">
                  <span>상세 관리 및 실행</span>
                  <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>
      )}
    </div>
  )
}
