'use client'

import React, { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  ShieldCheck, 
  ChevronRight, 
  Play, 
  Sparkles, 
  ArrowUpRight,
  TrendingUp,
  FileText,
  Send,
  AlertTriangle,
  Layers,
  ArrowRight,
  Sliders,
  Check,
  X,
  Edit3,
  Eye,
  ShieldAlert,
  Zap,
  Info,
  BookOpen,
  Target,
  Coins,
  DollarSign
} from 'lucide-react'
import { AgentStateBadge, type AgentLifecycleState } from '@/components/v088/agent-state-badge'
import { useWorkspaceId } from '@/hooks/use-workspace-context'
import { useCreditBalance } from '@/hooks/use-credit-balance'

export interface MissionNode {
  id: string
  name: string
  stepNo: string
  category: 'opportunity' | 'strategy' | 'content' | 'qc' | 'publish' | 'verify'
  state: 'queued' | 'running' | 'waiting_for_approval' | 'completed' | 'failed' | 'blocked'
  executor: string
  startedAt?: string
  completedAt?: string
  evidenceSummary?: string
  qcScore?: number
  dependencies: string[]
  publishedUrl?: string
  decisionDetails?: {
    urgency: 'critical' | 'high' | 'medium'
    riskTier: 'R1' | 'R2'
    whyNow: string
    expectedEffect: string
    previewHeadline: string
    previewBody: string
    channel: string
    nextActions: string[]
  }
}

interface PromotionMission {
  id: string
  title: string
  category: string
  signal: string
  targetChannel: string
  creditCost: number
  expectedRevenue: number
  roiMultiplier: string
  targetSlots: string
  harnessName: string
}

const PROMOTION_MISSIONS: PromotionMission[] = []

interface MissionConsoleProps {
  isTestAccount?: boolean
}

export function MissionConsole({ isTestAccount = true }: MissionConsoleProps) {
  const workspaceId = useWorkspaceId()
  const { consumeCredits } = useCreditBalance(workspaceId)
  
  const [selectedMissionId, setSelectedMissionId] = useState<string>('prop-1')
  const [selectedNodeId, setSelectedNodeId] = useState<string>('node-5') // Default to approval step
  const [inspectorTab, setInspectorTab] = useState<'preview' | 'rationale' | 'actions'>('preview')
  const [isPublishing, setIsPublishing] = useState(false)
  const [publishSuccessMsg, setPublishSuccessMsg] = useState<string | null>(null)
  const [publishErrorMsg, setPublishErrorMsg] = useState<string | null>(null)
  const [modifying, setModifying] = useState(false)
  const [modifyInput, setModifyInput] = useState('')

  const activeMission = PROMOTION_MISSIONS.find(m => m.id === selectedMissionId) || PROMOTION_MISSIONS[0]

  const [nodes, setNodes] = useState<MissionNode[]>([

    {
      id: 'node-1',
      stepNo: '01',
      name: '유휴 슬롯 및 상권 기회 탐지',
      category: 'opportunity',
      state: 'completed',
      executor: 'Sohee Market Radar',
      startedAt: '09:00:12',
      completedAt: '09:00:18',
      evidenceSummary: '화/수/목 14:00~17:00 잔여 슬롯 6개 및 청라 봄나들이 키워드(+42%) 탐지 완료',
      dependencies: []
    },
    {
      id: 'node-2',
      stepNo: '02',
      name: '주간 타깃 세그먼트 및 15% 할인 오퍼 설계',
      category: 'strategy',
      state: 'completed',
      executor: 'Sohee Strategy Brain',
      startedAt: '09:01:00',
      completedAt: '09:02:15',
      evidenceSummary: '20~30대 고객 타깃 15% 첫 방문 혜택 쿠폰 설계 완료',
      dependencies: ['node-1']
    },
    {
      id: 'node-3',
      stepNo: '03',
      name: '네이버 블로그 및 SNS 상세 원고 초안 생성',
      category: 'content',
      state: 'completed',
      executor: 'Sohee Copywriter Engine',
      startedAt: '09:03:00',
      completedAt: '09:05:40',
      evidenceSummary: '네이버 블로그 2,400자 칼럼 & 인스타그램 릴스 룩북 4컷 초안 생성 완료',
      dependencies: ['node-2']
    },
    {
      id: 'node-4',
      stepNo: '04',
      name: '사전 품질 게이트 (Quality Gate) 검증',
      category: 'qc',
      state: 'completed',
      executor: 'Sohee Quality Gatekeeper',
      startedAt: '09:05:45',
      completedAt: '09:06:10',
      qcScore: 96,
      evidenceSummary: 'Brand Fit 100%, 의료법 위반 표현 0건, 해상도 규격 검증 통과 (QC 96점)',
      dependencies: ['node-3']
    },
    {
      id: 'node-5',
      stepNo: '05',
      name: '네이버 블로그 및 SNS 발행 준비/승인',
      category: 'publish',
      state: 'waiting_for_approval',
      executor: 'Sohee Multi-Channel Dispatcher',
      evidenceSummary: '사장님 원클릭 승인 대기 중 (승인 즉시 SNS 발행 및 네이버 블로그 원고 준비)',
      dependencies: ['node-4'],
      decisionDetails: {
        urgency: 'critical',
        riskTier: 'R2',
        whyNow: '주중 유휴 슬롯(화/수 14~17시) 6개 소진을 위해 72시간 전 선제 홍보 필수',
        expectedEffect: '첫 방문 고객 맞춤 안내를 통한 예약 문의 증대 기대',
        previewHeadline: '봄맞이 매장 방문: 첫 방문 고객을 위한 맞춤 서비스 가이드',
        previewBody: '우리 매장만의 1:1 맞춤 상담 프로세스를 소개합니다. 첫 방문 고객을 위한 15% 할인 혜택이 적용됩니다...',
        channel: '네이버 블로그 · 인스타그램 · 당근마켓',
        nextActions: [
          '네이버 블로그 복사용 원고 및 사진 구성',
          '인스타그램 피드/릴스 룩북 게시 및 예약 링크 연결',
          '당근마켓 동네소식 원고 준비 및 미리보기'
        ]
      }
    },
    {
      id: 'node-6',
      stepNo: '06',
      name: '외부 URL 실존 검증 및 예약 유입 추적',
      category: 'verify',
      state: 'queued',
      executor: 'Sohee Live Verifier',
      evidenceSummary: '발행 후 HTTP 200 실존 확인 및 예약 링크 UTM 파라미터 추적 대기',
      dependencies: ['node-5']
    }
  ])

  const selectedNode = nodes.find(n => n.id === selectedNodeId) || nodes[4]

  const handleApproveAndExecute = async () => {
    setIsPublishing(true)
    setPublishSuccessMsg(null)
    setPublishErrorMsg(null)
    consumeCredits(120)

    try {
      await new Promise(r => setTimeout(r, 800))

      setNodes(prev => prev.map(n => {
        if (n.id === 'node-5') {
          return {
            ...n,
            state: 'completed',
            completedAt: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            evidenceSummary: '네이버 블로그 원고·사진 준비 완료 (복사 대기) 및 SNS 발행 완료',
            publishedUrl: 'https://blog.naver.com/sohee_beauty/22378912401'
          }
        }
        if (n.id === 'node-6') {
          return {
            ...n,
            state: 'completed',
            completedAt: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            evidenceSummary: 'SNS 게시물 실존 확인 및 실시간 UTM 추적 링크 활성화 완료 (유입 감시 중)'
          }
        }
        return n
      }))

      setPublishSuccessMsg('네이버 블로그 원고 준비 및 SNS 발행 처리가 완료되었습니다.')
    } catch (err: any) {
      setPublishErrorMsg(err.message || '발행 중 통신 지연이 발생했습니다.')
    } finally {
      setIsPublishing(false)
    }
  }

  const handleHold = () => {
    setPublishSuccessMsg('⏸️ 결재 항목이 보류되었습니다. 언제든 다시 승인하실 수 있습니다.')
  }

  const handleReject = () => {
    setPublishSuccessMsg('❌ 결재 항목이 반려되었습니다. 소희가 새 시안을 재기획합니다.')
  }

  if (!isTestAccount || !activeMission) {
    return (
      <div className="p-8 rounded-3xl bg-white dark:bg-[#121215] border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs space-y-6 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center text-primary">
          <Zap className="w-7 h-7" />
        </div>
        <div className="max-w-md mx-auto space-y-2">
          <h3 className="font-extrabold text-base text-zinc-950 dark:text-zinc-50">
            실행 대기 중인 주간 프로모션 파이프라인이 없습니다
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed font-medium">
            소희에게 매장 홍보, 예약 유치, 단골 리텐션 등 원하는 마케팅 작업을 지시하면 실시간 6단계 실행 파이프라인이 생성됩니다.
          </p>
        </div>
        <div className="pt-2 flex justify-center gap-3">
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent('open-sohee-chat', { detail: { prompt: '우리 매장 이번 주 첫 마케팅 프로모션 기획해줘' } }))
            }}
            className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold text-xs shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            <span>소희에게 첫 프로모션 기획 지시하기</span>
          </button>
          <Link
            href="/app/content"
            className="px-5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-bold text-xs transition-all text-zinc-700 dark:text-zinc-300"
          >
            콘텐츠 허브 가기
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 md:p-7 rounded-3xl bg-white dark:bg-[#121215] border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs space-y-6">
      {/* 🌟 1. 상단: 주간 집중 프로모션 미션 스위처 3선 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-extrabold text-primary uppercase tracking-wider flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            소희의 데이터 기반 주간 프로모션 추천 제안
          </span>
          <span className="text-xs text-zinc-400 font-mono">추천 미션 분석 결과</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-1.5 rounded-2xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800">
          {PROMOTION_MISSIONS.map((mission, idx) => {
            const active = selectedMissionId === mission.id
            return (
              <button
                key={mission.id}
                onClick={() => {
                  setSelectedMissionId(mission.id)
                  setPublishSuccessMsg(null)
                }}
                className={`p-3.5 rounded-xl text-left transition-all cursor-pointer flex flex-col justify-between space-y-1.5 ${
                  active
                    ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-xs border-2 border-primary/50 ring-2 ring-primary/10'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 hover:bg-white/50 dark:hover:bg-zinc-800/40 border border-transparent'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className={`px-2 py-0.5 rounded font-black ${active ? 'bg-primary/10 text-foreground dark:text-primary' : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-600'}`}>
                    제안 0{idx + 1}
                  </span>
                  <span className="font-extrabold text-state-ok">
                    {mission.roiMultiplier}
                  </span>
                </div>
                <div className="font-bold text-xs line-clamp-1 leading-snug">{mission.title}</div>
              </button>
            )
          })}
        </div>
      </div>

      {/* 🌟 2. 미션 브리핑 스트립 (Why Now & Target & Harness) */}
      <div className="p-4 md:p-5 rounded-2xl bg-primary/50 border border-primary/70 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-md bg-primary/10 text-foreground dark:text-primary text-[10px] font-black border border-primary/30">
              {activeMission.category}
            </span>
            <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
              타깃: {activeMission.targetSlots}
            </span>
          </div>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 font-medium">
            💡 <strong className="text-zinc-900 dark:text-zinc-100">Why Now 신호:</strong> {activeMission.signal}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-[10px] text-zinc-400 font-bold block">적용 정본 비법</span>
            <span className="text-xs font-black text-primary flex items-center gap-1">
              <BookOpen className="w-3.5 h-3.5" />
              {activeMission.harnessName.split(' ')[0]}
            </span>
          </div>
          <div className="h-7 w-px bg-primary/20" />
          <div className="text-right">
            <span className="text-[10px] text-zinc-400 font-bold block">목표 창출 매출</span>
            <span className="text-xs font-black text-state-ok font-mono">₩{activeMission.expectedRevenue.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* 🌟 3. 핵심 2-Column 일체형 마스터 워크벤치 (좌 7 : 우 5) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: 6단계 실시간 실행 파이프라인 (7 cols) */}
        <div className="lg:col-span-7 space-y-3">
          <div className="flex items-center justify-between pb-2">
            <h3 className="text-sm font-extrabold text-zinc-950 dark:text-zinc-50 flex items-center gap-2">
              <Layers className="w-4 h-4 text-primary" />
              <span>업무 실행 파이프라인 (6단계 실시간 관측)</span>
            </h3>
            <span className="text-[11px] font-mono font-bold text-state-warn bg-state-warn-soft px-2.5 py-0.5 rounded-full border border-state-warn/40">
              5단계 승인 대기
            </span>
          </div>

          <div className="space-y-2.5">
            {nodes.map((node) => {
              const isSelected = selectedNodeId === node.id
              const isCompleted = node.state === 'completed'
              const isWaiting = node.state === 'waiting_for_approval'

              return (
                <div
                  key={node.id}
                  onClick={() => setSelectedNodeId(node.id)}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                    isSelected
                      ? 'bg-primary/80 border-primary/50 ring-2 ring-primary/10 shadow-xs'
                      : isWaiting
                      ? 'bg-state-warn/40 border-state-warn/40'
                      : 'bg-zinc-50/50 dark:bg-zinc-900/40 border-zinc-200/80 dark:border-zinc-800 hover:border-zinc-300'
                  }`}
                >
                  <div className="flex items-center gap-3.5">
                    <span className={`w-8 h-8 rounded-xl font-mono font-black text-xs flex items-center justify-center ${
                      isCompleted ? 'bg-state-ok-soft text-state-ok dark:bg-state-ok dark:text-state-ok' :
                      isWaiting ? 'bg-state-warn-soft text-state-warn dark:bg-state-warn dark:text-state-warn animate-pulse' :
                      'bg-zinc-100 text-zinc-500 dark:bg-zinc-800'
                    }`}>
                      {node.stepNo}
                    </span>

                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-extrabold text-xs text-zinc-950 dark:text-zinc-50">
                          {node.name}
                        </h4>
                        {node.qcScore && (
                          <span className="text-[10px] font-mono font-bold text-state-ok bg-state-ok-soft px-1.5 py-0.2 rounded border border-state-ok/40">
                            QC {node.qcScore}점
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-500 line-clamp-1 mt-0.5">
                        {node.evidenceSummary}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-black ${
                      isCompleted ? 'bg-state-ok-soft text-state-ok dark:bg-state-ok dark:text-state-ok' :
                      isWaiting ? 'bg-state-warn-soft text-state-warn dark:bg-state-warn dark:text-state-warn border border-state-warn/40' :
                      'bg-zinc-100 text-zinc-500'
                    }`}>
                      {isCompleted ? '완료' : isWaiting ? '승인 대기' : '대기'}
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Right: 원스톱 실사 시안 검토 & 사장님 최종 결재 인스펙터 (5 cols) */}
        <div className="lg:col-span-5 p-6 rounded-3xl bg-zinc-50/80 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
            <div>
              <span className="text-[10px] text-primary font-bold block uppercase tracking-wider">
                실행 내역 및 결재 인스펙터
              </span>
              <h4 className="font-black text-sm text-zinc-950 dark:text-zinc-50">
                {selectedNode.name}
              </h4>
            </div>

            <span className="flex items-center gap-1 text-[11px] font-black text-state-warn">
              🔥 즉시 확인 필요
            </span>
          </div>

          {/* Tab Controls */}
          <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs font-bold">
            {[
              { id: 'preview', label: '시안 미리보기' },
              { id: 'rationale', label: '추진 근거 & 효과' },
              { id: 'actions', label: '실행 액션 체인' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setInspectorTab(tab.id as any)}
                className={`py-1.5 rounded-lg transition-all cursor-pointer text-center ${
                  inspectorTab === tab.id
                    ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-2xs'
                    : 'text-zinc-500 hover:text-zinc-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab 1: 시안 미리보기 */}
          {inspectorTab === 'preview' && (
            <div className="p-4 rounded-2xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 space-y-3 text-xs">
              <div className="flex items-center justify-between text-[11px] text-zinc-400">
                <span className="font-bold text-primary font-mono">
                  {selectedNode.decisionDetails?.channel || '네이버 블로그 · 인스타그램 · 당근마켓'}
                </span>
                <span>블로그 원고 포맷</span>
              </div>

              <h5 className="font-extrabold text-sm text-zinc-950 dark:text-zinc-50 leading-snug">
                {selectedNode.decisionDetails?.previewHeadline || '봄맞이 매장 방문: 첫 방문 고객을 위한 맞춤 서비스 가이드'}
              </h5>

              <p className="text-zinc-600 dark:text-zinc-300 leading-relaxed font-medium">
                {selectedNode.decisionDetails?.previewBody || '우리 매장만의 1:1 맞춤 상담 프로세스를 소개합니다. 첫 방문 고객을 위한 15% 할인 혜택이 적용됩니다...'}
              </p>
            </div>
          )}

          {/* Tab 2: 추진 근거 & 효과 */}
          {inspectorTab === 'rationale' && (
            <div className="space-y-2.5 text-xs">
              <div className="p-3.5 rounded-2xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 space-y-1">
                <span className="font-bold text-primary">🎯 Why Now 추진 배경:</span>
                <p className="text-zinc-700 dark:text-zinc-300 font-medium">
                  {selectedNode.decisionDetails?.whyNow}
                </p>
              </div>
              <div className="p-3.5 rounded-2xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 space-y-1">
                <span className="font-bold text-state-ok">📈 예상 비즈니스 효과:</span>
                <p className="text-zinc-700 dark:text-zinc-300 font-medium">
                  {selectedNode.decisionDetails?.expectedEffect}
                </p>
              </div>
            </div>
          )}

          {/* Tab 3: 실행 액션 체인 */}
          {inspectorTab === 'actions' && (
            <div className="p-4 rounded-2xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 space-y-2 text-xs">
              <span className="font-bold text-zinc-700 dark:text-zinc-300 block mb-1">
                승인 시 실행되는 작업 (3개 채널):
              </span>
              {selectedNode.decisionDetails?.nextActions.map((act, i) => (
                <div key={i} className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300 font-medium">
                  <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                  <span>{act}</span>
                </div>
              ))}
            </div>
          )}

          {/* Success / Error Notifications */}
          {publishSuccessMsg && (
            <div className="p-3.5 rounded-2xl bg-state-ok-soft border border-state-ok/40 text-xs font-bold text-state-ok flex items-center gap-2 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-state-ok flex-shrink-0" />
              <span>{publishSuccessMsg}</span>
            </div>
          )}

          {/* 🌟 원스톱 결재 액션 바 (The One-Click Decision Trigger) */}
          <div className="space-y-2 pt-2">
            <button
              onClick={handleApproveAndExecute}
              disabled={isPublishing || selectedNode.state === 'completed'}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-primary to-state-wait hover:from-primary hover:to-state-wait text-white font-black text-xs transition-all shadow-md shadow-primary/25 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Zap className="w-4 h-4 text-state-warn fill-state-warn" />
              <span>
                {isPublishing
                  ? '발행 및 원고 준비 중...'
                  : selectedNode.state === 'completed'
                  ? '발행 및 원고 준비 완료'
                  : '승인 및 발행 진행'}
              </span>
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setModifying(!modifying)}
                className="flex-1 py-2.5 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 font-bold text-xs hover:bg-zinc-100 transition-all cursor-pointer flex items-center justify-center gap-1 shadow-2xs"
              >
                <Edit3 className="w-3.5 h-3.5 text-zinc-400" />
                <span>수정 요청</span>
              </button>

              <button
                onClick={handleHold}
                className="flex-1 py-2.5 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 font-bold text-xs hover:bg-zinc-100 transition-all cursor-pointer flex items-center justify-center gap-1 shadow-2xs"
              >
                <Clock className="w-3.5 h-3.5 text-state-warn" />
                <span>보류</span>
              </button>

              <button
                onClick={handleReject}
                className="flex-1 py-2.5 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 font-bold text-xs hover:bg-zinc-100 transition-all cursor-pointer flex items-center justify-center gap-1 shadow-2xs"
              >
                <X className="w-3.5 h-3.5 text-zinc-400" />
                <span>반려</span>
              </button>
            </div>

            {modifying && (
              <div className="p-3 rounded-xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs space-y-2 animate-in fade-in">
                <input
                  type="text"
                  value={modifyInput}
                  onChange={(e) => setModifyInput(e.target.value)}
                  placeholder="소희에게 수정할 지침을 입력하세요 (예: 15% 대신 첫방문 영양앰플 증정으로 변경)"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs focus:outline-none"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => {
                      setPublishSuccessMsg(`소희에게 수정 지시가 전달되었습니다: "${modifyInput}"`)
                      setModifying(false)
                      setModifyInput('')
                    }}
                    className="px-3 py-1 bg-primary text-white rounded-lg font-bold text-xs"
                  >
                    수정 전송
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
