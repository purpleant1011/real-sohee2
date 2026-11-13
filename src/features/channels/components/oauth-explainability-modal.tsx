'use client'

import React from 'react'
import {
  ShieldCheck,
  Lock,
  ExternalLink,
  ArrowRight,
  X,
  CheckCircle2,
  Info,
} from 'lucide-react'
import {
  getOAuthExplainabilityDetails,
  type SupportedChannel,
  type NormalizationResult,
} from '@/features/channels/channel-handle-normalizer'

export interface OAuthExplainabilityModalProps {
  isOpen: boolean
  channel: SupportedChannel
  normalizedResult?: NormalizationResult | null
  connectUri: string
  onClose: () => void
}

export function OAuthExplainabilityModal({
  isOpen,
  channel,
  normalizedResult,
  connectUri,
  onClose,
}: OAuthExplainabilityModalProps) {
  if (!isOpen) return null

  const details = getOAuthExplainabilityDetails(channel)
  const isInstagram = channel === 'instagram'

  const handleProceedOAuth = () => {
    if (typeof window !== 'undefined') {
      window.location.href = connectUri
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="oauth-explainability-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/70 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-lg rounded-3xl bg-zinc-950 border border-zinc-800 text-zinc-100 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-start justify-between p-6 border-b border-zinc-800/80 bg-zinc-900/40">
          <div className="flex items-center gap-3">
            <div
              className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-sm shrink-0 ${
                isInstagram
                  ? 'bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 text-white shadow-md shadow-pink-500/20'
                  : 'bg-zinc-800 border border-zinc-700 text-white'
              }`}
            >
              {isInstagram ? 'IG' : 'TH'}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 border border-indigo-500/20">
                  공식 {details.officialProviderName}
                </span>
              </div>
              <h2
                id="oauth-explainability-title"
                className="text-lg font-black text-white tracking-tight mt-0.5"
              >
                {details.channelDisplayName} 연동 안내
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800/80 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs text-zinc-300">
          {/* Target Intent Preview if entered */}
          {normalizedResult && normalizedResult.isValid && (
            <div className="p-4 rounded-2xl bg-zinc-900/80 border border-zinc-800 space-y-1.5">
              <span className="text-[11px] font-bold text-zinc-400 flex items-center gap-1">
                <Info className="w-3.5 h-3.5 text-indigo-400" />
                <span>연결 대상 프로필 (사전 입력 확인)</span>
              </span>
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-black text-white">
                  {normalizedResult.displayHandle}
                </span>
                <a
                  href={normalizedResult.canonicalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 font-semibold transition"
                >
                  <span>프로필 방문</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <p className="text-[11px] text-zinc-500">
                실제 연동은 Meta 공식 계정 로그인 창에서 선택한 공식 계정과 일치해야 합니다.
              </p>
            </div>
          )}

          {/* Reasons List */}
          <div className="space-y-3">
            <h3 className="text-xs font-black text-white flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>소희가 요청하는 권한과 필요 이유</span>
            </h3>
            <div className="space-y-2">
              {details.reasons.map((r, idx) => (
                <div
                  key={idx}
                  className="p-3.5 rounded-2xl bg-zinc-900/50 border border-zinc-800/80 space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-zinc-200">{r.title}</span>
                    {r.scopeKey && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                        {r.scopeKey}
                      </span>
                    )}
                  </div>
                  <p className="text-zinc-400 leading-relaxed">{r.description}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Security Guarantees Box */}
          <div className="p-4 rounded-2xl bg-indigo-950/20 border border-indigo-900/40 space-y-2.5">
            <div className="flex items-center gap-2 text-indigo-300 font-bold text-xs">
              <Lock className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>소희의 엄격한 보안 및 비밀번호 미저장 원칙</span>
            </div>
            <ul className="space-y-1.5 text-[11px] text-zinc-400">
              {details.securityGuarantees.map((g, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <span className="leading-snug">{g}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-5 border-t border-zinc-800/80 bg-zinc-900/40 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-300 text-xs font-bold transition cursor-pointer"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleProceedOAuth}
            className={`px-5 py-2.5 rounded-xl text-white font-black text-xs shadow-lg transition flex items-center gap-2 cursor-pointer ${
              isInstagram
                ? 'bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 hover:from-pink-500 hover:to-indigo-500 shadow-pink-500/20'
                : 'bg-zinc-100 hover:bg-white text-zinc-950 font-black shadow-zinc-800/30'
            }`}
          >
            <span>공식 Meta 계정으로 계속하기</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
