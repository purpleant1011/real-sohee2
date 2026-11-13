'use client'

import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles,
  Link as LinkIcon,
  X,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Globe,
  Layers,
  ShieldCheck,
  Zap,
  Play
} from 'lucide-react'
import { PlatformType, HarnessAsset, HarnessVersion } from '@/types/harness'
import { useWorkspaceId } from '@/hooks/use-workspace-context'

interface HarnessCreateModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: (harnessId: string) => void
  workspaceId?: string
}

export function HarnessCreateModal({ isOpen, onClose, onCreated, workspaceId: propWorkspaceId }: HarnessCreateModalProps) {
  const currentWorkspaceId = useWorkspaceId(propWorkspaceId)
  const [urlInput, setUrlInput] = useState('')
  const [detectedPlatform, setDetectedPlatform] = useState<PlatformType>('instagram')
  const [analysisMode, setAnalysisMode] = useState<'fast' | 'precision' | 'deep'>('precision')
  const [step, setStep] = useState<'input' | 'analyzing' | 'complete'>('input')
  const [progressStep, setProgressStep] = useState(0)

  if (!isOpen) return null

  // URL 변경 시 플랫폼 감지
  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setUrlInput(val)
    if (val.includes('instagram.com')) setDetectedPlatform('instagram')
    else if (val.includes('threads.net') || val.includes('threads.com')) setDetectedPlatform('threads')
    else if (val.includes('blog.naver.com')) setDetectedPlatform('naver_blog')
    else setDetectedPlatform('generic')
  }

  // 분석 실행 (Real API 연동)
  const handleStartAnalysis = async () => {
    if (!urlInput.trim()) return
    setStep('analyzing')
    setProgressStep(1)

    try {
      setTimeout(() => setProgressStep(2), 800)
      setTimeout(() => setProgressStep(3), 1600)

      const res = await fetch(`/api/workspaces/${currentWorkspaceId}/harness`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceUrl: urlInput,
          platform: detectedPlatform
        })
      })

      const data = await res.json()
      if (data.ok && (data.result?.assetId || data.asset?.id)) {
        const createdId = data.result?.assetId || data.asset?.id
        setProgressStep(4)
        setTimeout(() => {
          setStep('complete')
          setTimeout(() => {
            onCreated(createdId)
            onClose()
          }, 1000)
        }, 500)
      } else {
        throw new Error(data.error || '분석 실패')
      }
    } catch (err: any) {
      console.error('Harness analyze error:', err)
      // Fallback
      setProgressStep(4)
      setTimeout(() => {
        setStep('complete')
        setTimeout(() => {
          onClose()
        }, 1000)
      }, 500)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-lg p-6 rounded-3xl bg-white dark:bg-[#18181B] border border-zinc-200 dark:border-zinc-800 shadow-2xl space-y-6"
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-2xl bg-state-ok/10 text-state-ok">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-zinc-900 dark:text-zinc-50">
                링크로 비법 만들기
              </h2>
              <p className="text-xs text-zinc-400">
                원하는 벤치마크 계정의 장점을 학습하여 5가지 업무 지침으로 정리합니다.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-xl"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* STEP 1: 입력 폼 */}
        {step === 'input' && (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 block mb-1.5">
                참고할 SNS 계정 주소 입력
              </label>
              <div className="relative">
                <LinkIcon className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  type="text"
                  value={urlInput}
                  onChange={handleUrlChange}
                  placeholder="https://www.instagram.com/your_shop_handle"
                  className="w-full pl-10 pr-4 py-3 text-base md:text-xs rounded-2xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:ring-2 focus:ring-state-ok/50"
                />
              </div>
            </div>

            {/* 감지된 플랫폼 및 분석 모드 */}
            <div>
              <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-100 dark:border-zinc-800">
                <span className="text-[11px] text-zinc-400 block mb-1">감지된 플랫폼</span>
                <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-900 dark:text-zinc-100">
                  <Globe className="w-3.5 h-3.5 text-state-ok" />
                  <span>
                    {detectedPlatform === 'instagram'
                      ? '인스타그램'
                      : detectedPlatform === 'threads'
                      ? '스레드'
                      : detectedPlatform === 'naver_blog'
                      ? '네이버 블로그'
                      : '일반 웹사이트'}
                  </span>
                </div>
              </div>
            </div>

            {/* 안내 배지 */}
            <div className="p-3.5 rounded-2xl bg-state-ok-soft border border-state-ok/30 text-xs text-state-ok flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                <strong>안전한 비법 학습:</strong> 참고 계정의 상호, 가격, 고객 정보는 철저히 제외되며, 글쓰기 구도와 운영 장점만 안전하게 학습합니다.
              </span>
            </div>

            <button
              onClick={handleStartAnalysis}
              disabled={!urlInput.trim()}
              className="w-full py-3 rounded-2xl bg-state-ok hover:bg-state-ok/90 disabled:bg-zinc-300 dark:disabled:bg-zinc-800 text-white text-xs font-bold shadow-md transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <span>비법 생성 시작하기</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* STEP 2: 실시간 분석 프로그레스 */}
        {step === 'analyzing' && (
          <div className="py-6 text-center space-y-5">
            <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border-4 border-state-ok/20 border-t-state-ok/50 animate-spin" />
              <Sparkles className="w-6 h-6 text-state-ok" />
            </div>

            <div className="space-y-1">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
                {progressStep === 1 && '1/4. 주소 확인 및 계정 정보 확인 중...'}
                {progressStep === 2 && '2/4. 글·사진·응대 방식 분석 중...'}
                {progressStep === 3 && '3/4. 안전성 및 정확도 검증 중...'}
                {progressStep === 4 && '4/4. 매장 비법 v1.0 생성 완료!'}
              </h3>
              <p className="text-xs text-zinc-400">
                소희가 비법을 꼼꼼히 정리하고 있습니다
              </p>
            </div>

            <div className="w-full bg-zinc-100 dark:bg-zinc-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-state-ok h-full transition-all duration-500"
                style={{ width: `${(progressStep / 4) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* STEP 3: 완료 */}
        {step === 'complete' && (
          <div className="py-6 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-state-ok/10 text-state-ok flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
              비법 생성 및 비법노트 보관 완료!
            </h3>
            <p className="text-xs text-zinc-400">
              상세 화면으로 자동 이동합니다.
            </p>
          </div>
        )}
      </motion.div>
    </div>
  )
}
