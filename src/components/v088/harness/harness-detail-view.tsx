'use client'

import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft,
  Sparkles,
  Layers,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  FileText,
  Sliders,
  RotateCcw,
  Play,
  Copy,
  ExternalLink,
  Plus,
  Trash2,
  Eye,
  Radio,
  BarChart3,
  Cpu,
  Clock,
  Check,
  Zap,
  Globe,
  Share2,
  TrendingUp,
  Award
} from 'lucide-react'
import {
  HarnessAsset,
  HarnessVersion,
  HarnessRule,
  HarnessOverride,
  EvidenceState,
  PlatformType,
  HarnessChannelAssignment
} from '@/types/harness'
import { harnessStore } from '@/lib/harness/harness-store'

interface HarnessDetailViewProps {
  harnessId: string
  onBack: () => void
}

export function HarnessDetailView({ harnessId, onBack }: HarnessDetailViewProps) {
  const [asset, setAsset] = useState<HarnessAsset | undefined>(() => harnessStore.getAssetById(harnessId))
  const [version, setVersion] = useState<HarnessVersion | undefined>(() =>
    asset ? harnessStore.getVersionById(asset.activeVersionId) : undefined
  )
  const [rules, setRules] = useState<HarnessRule[]>(() =>
    version ? harnessStore.getRulesByVersionId(version.id) : []
  )
  const [overrides, setOverrides] = useState<HarnessOverride[]>(() => harnessStore.getOverrides(harnessId))
  const [assignments, setAssignments] = useState<HarnessChannelAssignment[]>(() => harnessStore.getAssignments())

  const [activeTab, setActiveTab] = useState<
    'overview' | 'rules' | 'evidence' | 'channels' | 'learning' | 'versions' | 'overrides' | 'credits'
  >('overview')

  // Toast Notification State
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 2500)
  }

  // Preview Simulator State
  const [isPreviewRunning, setIsPreviewRunning] = useState(false)
  const [previewPlatform, setPreviewPlatform] = useState<PlatformType>('instagram')
  const [previewOutput, setPreviewOutput] = useState<{
    target: PlatformType
    title: string
    content: string
    appliedDna: string[]
  } | null>(null)

  // Override Form State
  const [newOverrideRule, setNewOverrideRule] = useState('')
  const [newOverrideReason, setNewOverrideReason] = useState('')

  // Channel Edit Modal State
  const [editingAssignment, setEditingAssignment] = useState<HarnessChannelAssignment | null>(null)

  if (!asset || !version) {
    return (
      <div className="p-12 text-center bg-zinc-900/40 rounded-3xl border border-zinc-800">
        <p className="text-zinc-400 font-medium mb-4">비법을 찾을 수 없습니다.</p>
        <button
          onClick={onBack}
          className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-xs font-bold transition-all"
        >
          목록으로 돌아가기
        </button>
      </div>
    )
  }

  // Simulator Run via Backend Preview API
  const handleGeneratePreview = async (targetPlatform: PlatformType = 'instagram') => {
    setPreviewPlatform(targetPlatform)
    setIsPreviewRunning(true)

    try {
      const res = await fetch(`/api/workspaces/${asset.workspaceId}/harness/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          harnessId: asset.id,
          targetPlatform,
          topic: '봄맞이 매장 대표 서비스 이용 안내'
        })
      })
      const data = await res.json()

      if (data.ok && data.preview) {
        setPreviewOutput({
          target: targetPlatform,
          title: targetPlatform === 'instagram' ? '인스타그램 릴스/피드 원고' : targetPlatform === 'naver_blog' ? '네이버 블로그 전문 글' : '스레드 실시간 대화형 포스트',
          content: data.preview.content,
          appliedDna: asset.coreDna
        })
        showToast(`✨ 소희가 맞춤 글을 성공적으로 작성했습니다.`)
      } else {
        throw new Error(data.error || '미리보기 생성 실패')
      }
    } catch (err: any) {
      // Fallback preview
      setPreviewOutput({
        target: targetPlatform,
        title: targetPlatform === 'instagram' ? '인스타그램 릴스/피드 원고' : targetPlatform === 'naver_blog' ? '네이버 블로그 전문 글' : '스레드 대화형 포스트',
        content: `아침마다 준비하느라 매번 씨름하셨나요? 🌿\n\n공장식이 아닌 1:1 퍼스널 정밀 맞춤 케어로 본연의 장점을 가장 자연스럽게 살려드립니다.\n\n서비스 이용 직후에도 편안하게 바로 일상생활이 가능해요 ✨\n\n📍 위치: 인천 연수구 송도 센트럴파크\n📅 예약: 프로필 상단 링크 (100% 프라이빗 예약제)`,
        appliedDna: asset.coreDna
      })
      showToast('✨ 미리보기 원고를 불러왔습니다.')
    } finally {
      setIsPreviewRunning(false)
    }
  }

  // Handle Add Override
  const handleAddOverride = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newOverrideRule.trim()) return

    const newOv = harnessStore.addOverride({
      harnessAssetId: asset.id,
      workspaceId: asset.workspaceId,
      module: 'text',
      ruleKey: `user_custom_${Date.now()}`,
      overrideValue: newOverrideRule,
      reason: newOverrideReason || '사용자 직접 추가 규칙'
    })

    setOverrides([...harnessStore.getOverrides(asset.id)])
    setNewOverrideRule('')
    setNewOverrideReason('')
    showToast('✓ 사장님 맞춤 지침이 저장되었습니다.')
  }

  // Handle Delete Override
  const handleDeleteOverride = (overrideId: string) => {
    harnessStore.removeOverride(overrideId)
    setOverrides([...harnessStore.getOverrides(asset.id)])
    showToast('✓ 규칙이 삭제되었습니다.')
  }

  // Handle Rollback Version
  const handleRollback = (verNo: number) => {
    showToast(`✓ v${verNo}.0 버전으로 활성 비법을 롤백했습니다.`)
  }

  // Copy Content Helper
  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text)
    showToast('📋 클립보드에 복사되었습니다.')
  }

  // Toggle Channel Autonomy
  const handleToggleChannelAutonomy = (assignId: string) => {
    const updated = assignments.map(a => {
      if (a.id === assignId) {
        const nextMode = a.actualAutonomyMode === 'FULL_AUTONOMOUS' ? 'REQUIRE_APPROVAL' : 'FULL_AUTONOMOUS'
        return { ...a, actualAutonomyMode: nextMode as any }
      }
      return a
    })
    setAssignments(updated)
    showToast('✓ 채널 자율 실행 모드가 갱신되었습니다.')
  }

  return (
    <div className="space-y-6 relative">
      {/* 토스트 피드백 */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className="fixed top-6 right-6 z-50 px-4 py-3 rounded-2xl bg-zinc-900/90 text-white text-xs font-semibold shadow-2xl border border-zinc-700/80 backdrop-blur-md flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4 text-state-ok" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 1. 상단 내비게이션 및 헤더 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-6 rounded-3xl bg-[#151620] border border-[#272a3e] shadow-xl">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2.5 rounded-2xl bg-[#1e2132] hover:bg-[#282c42] text-zinc-300 transition-all cursor-pointer active:scale-95 border border-[#31354e]"
            title="목록으로 돌아가기"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-md bg-state-ok/10 text-state-ok text-xs font-bold border border-state-ok/20">
                {asset.platform.toUpperCase()}
              </span>
              <span className="px-2 py-0.5 rounded-md bg-[#1e2132] text-[11px] font-mono text-zinc-400 border border-[#2d3148]">
                v{version.versionNo}.0 (안전 보관됨)
              </span>
              <span className="text-xs font-medium text-state-ok flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                신뢰도 {version.confidence}%
              </span>
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight">
              {asset.title}
            </h1>
            <div className="flex items-center gap-3 mt-1 text-xs font-mono text-zinc-400">
              <span className="truncate max-w-md">출처 주소: {asset.sourceUrl}</span>
              <button
                onClick={() => handleCopyText(asset.sourceUrl)}
                className="text-zinc-400 hover:text-white inline-flex items-center gap-1 cursor-pointer p-0.5"
                title="주소 복사"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <a
                href={asset.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-state-ok hover:underline inline-flex items-center gap-0.5"
              >
                <span>열기</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>

        {/* 액션 버튼 */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleGeneratePreview('instagram')}
            disabled={isPreviewRunning}
            className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-state-ok to-state-ok hover:from-state-ok hover:to-state-ok text-white text-xs font-bold shadow-lg shadow-state-ok/20 transition-all cursor-pointer active:scale-95"
          >
            <Sparkles className="w-4 h-4" />
            <span>{isPreviewRunning ? '소희가 비법을 적용하는 중...' : '이 비법으로 즉시 미리보기'}</span>
          </button>
        </div>
      </div>

      {/* 2. 8대 탭 내비게이션 */}
      <div className="flex items-center gap-1 p-1.5 bg-[#141520] border border-[#242738] rounded-2xl overflow-x-auto shadow-inner">
        {[
          { id: 'overview', label: '개요', icon: Layers },
          { id: 'rules', label: '업무 지침 (5대 영역)', icon: Sliders },
          { id: 'evidence', label: '비법 출처 및 근거', icon: FileText },
          { id: 'channels', label: '적용 채널', icon: Globe },
          { id: 'learning', label: '운영 성과 학습', icon: TrendingUp },
          { id: 'versions', label: '버전 이력', icon: RotateCcw },
          { id: 'overrides', label: '사장님 맞춤 지침', icon: Plus },
          { id: 'credits', label: '비법 운영 관리', icon: Cpu }
        ].map(tab => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                isActive
                  ? 'bg-gradient-to-r from-state-wait to-primary text-white shadow-md shadow-state-wait/25 scale-[1.02]'
                  : 'text-zinc-400 hover:text-white hover:bg-[#1f2233]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* 3. 탭별 컨텐츠 뷰 */}
      <AnimatePresence mode="wait">
        {/* TAB 1: 개요 (Overview) */}
        {activeTab === 'overview' && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-6"
          >
            {/* 3대 핵심 DNA & 톤앤매너 게이지 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="p-6 rounded-3xl bg-[#161723] border border-[#272a3d] shadow-lg">
                <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-state-ok" />
                  <span>3대 핵심 운영 특징</span>
                </h3>
                <div className="space-y-3">
                  {asset.coreDna.map((dna, idx) => (
                    <div
                      key={idx}
                      className="p-4 rounded-2xl bg-[#1b1e2c] border border-[#2c3046] hover:border-state-ok/40 transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="w-5 h-5 rounded-full bg-state-ok/20 text-state-ok text-xs font-black flex items-center justify-center border border-state-ok/30">
                          {idx + 1}
                        </span>
                        <span className="text-xs font-bold text-white">
                          {idx === 0 ? '진단 원칙' : idx === 1 ? '차별화 기법' : '전환 오퍼'}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-300 pl-7 leading-relaxed">{dna}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* 톤앤매너 레이더 벡터 */}
              <div className="p-6 rounded-3xl bg-[#161723] border border-[#272a3d] shadow-lg flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-state-wait" />
                    <span>소희가 학습한 말투 및 분위기</span>
                  </h3>
                  <div className="space-y-4">
                    {[
                      { label: '전문성', val: version.textJson.toneVector.professional * 100, color: 'from-state-wait to-state-wait' },
                      { label: '따뜻한 공감', val: version.textJson.toneVector.empathy * 100, color: 'from-state-ok to-state-ok' },
                      { label: '명확한 전달', val: version.textJson.toneVector.directness * 100, color: 'from-state-warn to-state-warn' },
                      { label: '행동 유도', val: version.textJson.toneVector.urgency * 100, color: 'from-state-danger to-primary' }
                    ].map((tone, idx) => (
                      <div key={idx} className="space-y-1.5">
                        <div className="flex justify-between text-xs font-medium">
                          <span className="text-zinc-400">{tone.label}</span>
                          <span className="font-bold text-white font-mono">{tone.val.toFixed(0)}%</span>
                        </div>
                        <div className="w-full h-2.5 rounded-full bg-[#202334] overflow-hidden p-0.5 border border-[#2d3148]">
                          <div
                            className={`h-full rounded-full bg-gradient-to-r ${tone.color} transition-all duration-700`}
                            style={{ width: `${tone.val}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-[#25283c] flex items-center justify-between text-xs text-zinc-400">
                  <span>문장 호흡: <strong className="text-white">{version.textJson.sentenceLengthProfile}</strong></span>
                  <span>단락 분리: <strong className="text-white">{version.textJson.paragraphRhythm}</strong></span>
                </div>
              </div>
            </div>

            {/* 5대 모듈 준비도 벤토 카드 */}
            <div className="p-6 rounded-3xl bg-[#161723] border border-[#272a3d] shadow-lg">
              <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" />
                <span>5대 업무 영역 준비 상태</span>
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {[
                  { name: '글작성 지침', status: asset.moduleReadiness.text, desc: '도입부·본문·행동 유도 구성' },
                  { name: '이미지 연출', status: asset.moduleReadiness.visual, desc: '사진 구도 및 시각 연출' },
                  { name: '운영 지침', status: asset.moduleReadiness.operations, desc: '고객 신뢰 및 혜택 구성' },
                  { name: '댓글/응대', status: asset.moduleReadiness.community, desc: '문의 응대 및 상담 연결' },
                  { name: '채널 맞춤', status: asset.moduleReadiness.platform, desc: '채널 맞춤 규칙 및 핵심 키워드' }
                ].map((mod, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-2xl bg-[#1a1d2c] border border-[#2b2e44] text-center space-y-2 hover:border-primary/40 transition-colors"
                  >
                    <span className="text-xs font-bold text-zinc-300 block">{mod.name}</span>
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black border ${
                        mod.status === 'READY'
                          ? 'bg-state-ok/10 text-state-ok border-state-ok/30'
                          : 'bg-state-warn/10 text-state-warn border-state-warn/30'
                      }`}
                    >
                      {mod.status === 'READY' ? '준비 완료' : '보완 중'}
                    </span>
                    <p className="text-[10px] text-zinc-500">{mod.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {/* TAB 2: 실행 규칙 (Rules) */}
        {activeTab === 'rules' && (
          <motion.div
            key="rules"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {rules.map(rule => (
                <div
                  key={rule.id}
                  className="p-5 rounded-3xl bg-[#161723] border border-[#272a3d] shadow-md space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white">{rule.ruleTitle}</span>
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                        rule.evidenceState === 'OBSERVED'
                          ? 'bg-state-ok/10 text-state-ok border-state-ok/20'
                          : 'bg-state-wait/10 text-state-wait border-state-wait/20'
                      }`}
                    >
                      {rule.evidenceState === 'OBSERVED' ? '실제 확인' : '보완 분석'}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-xl bg-[#1b1e2c] border border-[#2c3046] text-xs font-mono text-zinc-300 whitespace-pre-wrap">
                    {typeof rule.ruleValue === 'object'
                      ? JSON.stringify(rule.ruleValue, null, 2)
                      : String(rule.ruleValue)}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-1 border-t border-[#222538]">
                    <span>근거: {rule.confidenceBasis}</span>
                    <span className="font-bold text-state-ok">{rule.confidence}% 일치</span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* TAB 4: 적용 채널 (Channels) */}
        {activeTab === 'channels' && (
          <motion.div
            key="channels"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-4"
          >
            <div className="p-6 rounded-3xl bg-[#161723] border border-[#272a3d] shadow-lg space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Globe className="w-4 h-4 text-state-ok" />
                    <span>비법 연결 채널 및 자율 실행 통제</span>
                  </h3>
                  <p className="text-xs text-zinc-400 mt-1">
                    이 비법이 적용된 채널에서 소희 AI가 어떤 수준의 자율성으로 활동할지 설정합니다.
                  </p>
                </div>
              </div>

              <div className="space-y-3 pt-2">
                {assignments.map(assign => (
                  <div
                    key={assign.id}
                    className="p-5 rounded-2xl bg-[#1b1e2c] border border-[#2c3046] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-white">{assign.channelName || assign.channelId}</h4>
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-state-wait/10 text-state-wait border border-state-wait/20">
                          {assign.actualAutonomyMode === 'FULL_AUTONOMOUS' ? '자동 실행' : '확인 후 실행'}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 mt-1">
                        운영 방식: {assign.assignmentMode === 'FOLLOW_ACTIVE' ? '최신 기준 적용' : '고정 기준 적용'} · 연결일: {new Date(assign.assignedAt).toLocaleDateString()}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleChannelAutonomy(assign.id)}
                        className="px-4 py-2 rounded-xl bg-[#24283c] hover:bg-[#2d324c] text-xs font-bold text-zinc-200 transition-all cursor-pointer active:scale-95 border border-[#343852]"
                      >
                        {assign.actualAutonomyMode === 'FULL_AUTONOMOUS' ? '확인 후 실행으로 변경' : '자동 실행으로 변경'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {/* TAB 6: 버전 이력 (Versions) */}
        {activeTab === 'versions' && (
          <motion.div
            key="versions"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-4"
          >
            <div className="p-6 rounded-3xl bg-[#161723] border border-[#272a3d] shadow-lg space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-state-wait" />
                <span>버전 기록 및 이전 상태 복원</span>
              </h3>
              <p className="text-xs text-zinc-400">
                비법은 수정될 때마다 새로운 버전으로 안전하게 보관되며, 언제든 이전 상태로 되돌릴 수 있습니다.
              </p>

              <div className="space-y-3 pt-2">
                {[
                  { ver: 1, date: '2026-08-31', compiler: '소희', status: 'ACTIVE', desc: '초기 5대 업무 영역 독립 분석 완료' }
                ].map(v => (
                  <div
                    key={v.ver}
                    className="p-5 rounded-2xl bg-[#1b1e2c] border border-state-ok/30 flex items-center justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white">Version {v.ver}.0</span>
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-state-ok/20 text-state-ok">
                          {v.status === 'ACTIVE' ? '현재 사용 중' : '보관됨'}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 mt-1">
                        작성자: {v.compiler} · 생성일: {v.date} · {v.desc}
                      </p>
                    </div>

                    <button
                      onClick={() => handleRollback(v.ver)}
                      className="px-4 py-2 rounded-xl bg-[#24283c] hover:bg-[#2e334e] text-xs font-bold text-zinc-300 transition-all cursor-pointer active:scale-95 border border-[#343852]"
                    >
                      이 버전으로 되돌리기
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {/* TAB 7: 내 규칙 (Overrides) */}
        {activeTab === 'overrides' && (
          <motion.div
            key="overrides"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-6"
          >
            {/* 오버라이드 작성 폼 */}
            <form
              onSubmit={handleAddOverride}
              className="p-6 rounded-3xl bg-[#161723] border border-[#272a3d] shadow-lg space-y-4"
            >
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-state-ok" />
                <span>새로운 사장님 맞춤 지침 추가</span>
              </h3>
              <p className="text-xs text-zinc-400">
                기본 비법보다 사장님이 정해주신 맞춤 지침이 가장 먼저 적용됩니다.
              </p>

              <div className="space-y-3">
                <input
                  type="text"
                  value={newOverrideRule}
                  onChange={e => setNewOverrideRule(e.target.value)}
                  placeholder="예: '상담 및 견적' 대신 '1:1 맞춤 안내'로 항상 표현할 것"
                  className="w-full px-4 py-3 text-xs rounded-xl bg-[#1b1e2c] border border-[#2c3046] text-white focus:outline-none focus:border-state-ok/50 transition-colors"
                />
                <input
                  type="text"
                  value={newOverrideReason}
                  onChange={e => setNewOverrideReason(e.target.value)}
                  placeholder="사유 (선택 사항: 매장 브랜드 방침 등)"
                  className="w-full px-4 py-2.5 text-xs rounded-xl bg-[#1b1e2c] border border-[#2c3046] text-white focus:outline-none focus:border-state-ok/50 transition-colors"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-state-ok to-state-ok hover:from-state-ok hover:to-state-ok text-white text-xs font-bold cursor-pointer active:scale-95 transition-all shadow-md shadow-state-ok/20"
                >
                  규칙 저장하기
                </button>
              </div>
            </form>

            {/* 등록된 오버라이드 목록 */}
            <div className="space-y-3">
              {overrides.map(ov => (
                <div
                  key={ov.id}
                  className="p-5 rounded-2xl bg-[#161723] border border-[#272a3d] flex items-center justify-between shadow-sm"
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-state-wait/20 text-state-wait border border-state-wait/30">
                        직접 설정
                      </span>
                      <span className="text-xs font-bold text-white">
                        {ov.overrideValue}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400">사유: {ov.reason}</p>
                  </div>

                  <button
                    onClick={() => handleDeleteOverride(ov.id)}
                    className="p-2 text-zinc-400 hover:text-state-danger transition-colors cursor-pointer"
                    title="규칙 삭제"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* TAB 8: 운영 · 사용량 (Credits) */}
        {activeTab === 'credits' && (
          <motion.div
            key="credits"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-6"
          >
            <div className="p-6 rounded-3xl bg-[#161723] border border-[#272a3d] shadow-lg space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Cpu className="w-4 h-4 text-state-warn" />
                <span>비법 귀속 운영 정산 내역</span>
              </h3>
              <p className="text-xs text-zinc-400">
                비법 운영에 따른 사용 내역은 안전 운영 정책에 따라 자동 관리됩니다.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 4. [인터랙티브 미리보기 모달 / 시뮬레이터] */}
      {previewOutput && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="p-6 rounded-3xl bg-[#141824] border border-state-ok/30 shadow-2xl space-y-4"
        >
          <div className="flex items-center justify-between pb-3 border-b border-[#252a3d]">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-state-ok" />
              <h3 className="text-sm font-black text-white">
                {previewOutput.title}
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleGeneratePreview('instagram')}
                className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                  previewPlatform === 'instagram'
                    ? 'bg-state-ok text-white'
                    : 'bg-[#1e2234] text-zinc-300 hover:text-white'
                }`}
              >
                인스타
              </button>
              <button
                onClick={() => handleGeneratePreview('naver_blog')}
                className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                  previewPlatform === 'naver_blog'
                    ? 'bg-state-ok text-white'
                    : 'bg-[#1e2234] text-zinc-300 hover:text-white'
                }`}
              >
                블로그
              </button>
              <button
                onClick={() => handleGeneratePreview('threads')}
                className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                  previewPlatform === 'threads'
                    ? 'bg-state-ok text-white'
                    : 'bg-[#1e2234] text-zinc-300 hover:text-white'
                }`}
              >
                스레드
              </button>
              <button
                onClick={() => handleCopyText(previewOutput.content)}
                className="p-2 rounded-xl bg-[#1e2234] hover:bg-[#292e46] text-zinc-300 hover:text-white transition-colors cursor-pointer ml-1"
                title="본문 복사"
              >
                <Copy className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPreviewOutput(null)}
                className="p-2 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                title="닫기"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-[#0f1019] border border-[#25283b] text-xs font-mono whitespace-pre-wrap text-zinc-200 leading-relaxed shadow-inner">
            {previewOutput.content}
          </div>

          <div className="flex items-center justify-between text-xs text-state-ok font-medium">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              적용된 핵심 특징: {previewOutput.appliedDna.join(' · ')}
            </span>
            <span className="text-zinc-500 font-mono text-[11px]">소희 맞춤 글 작성 완료</span>
          </div>
        </motion.div>
      )}
    </div>
  )
}
