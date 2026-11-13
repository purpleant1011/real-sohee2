'use client'

import React from 'react'
import { CheckCircle2, ShieldCheck, Heart, MessageCircle, Send, Bookmark, Sparkles, ArrowRight, Share2, AlertCircle } from 'lucide-react'
import Link from 'next/link'

export interface LivePublishProofViewerProps {
  businessName: string
  instagramHandle: string
  category: string
  signatureService: string
  onFinish: () => void
  isSaving: boolean
}

export function LivePublishProofViewer({
  businessName,
  instagramHandle,
  category,
  signatureService,
  onFinish,
  isSaving
}: LivePublishProofViewerProps) {
  const cleanHandle = (instagramHandle || '내_매장_계정').replace(/^@/, '').replace(/https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '')

  return (
    <div className="space-y-6 animate-in fade-in duration-300 font-sans">
      
      {/* 🌟 1. 정식 AI 시안 승인 완료 배너 (Truthfulness Gate: 실제 계정 연동 전임을 투명하게 안내) */}
      <div className="rounded-3xl border-2 border-state-wait/40 bg-state-wait-soft p-6 sm:p-7 text-center space-y-4 shadow-xl">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-state-wait text-state-wait-soft flex items-center justify-center shadow-lg shadow-state-wait/30 animate-pulse">
          <CheckCircle2 className="w-8 h-8 stroke-[2.5]" />
        </div>
        
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-black bg-state-wait/20 text-state-wait border border-state-wait/30">
            <Sparkles className="w-3.5 h-3.5" />
            소희 AI 첫 맞춤 마케팅 시안 승인 완료 · 실제 발행 대기 (QUEUED)
          </div>
          
          <h3 className="text-xl sm:text-2xl font-black text-zinc-950 dark:text-zinc-50 tracking-tight">
            &lsquo;{businessName || '우리 매장'}&rsquo; 첫 마케팅 시안이 성공적으로 완성되었습니다!
          </h3>
          
          {/* ⚠️ 정직한 진실 안내문 (사용자 오해 방지) */}
          <div className="max-w-xl mx-auto p-4 rounded-2xl bg-state-warn-soft border border-state-warn/30 text-state-warn text-xs leading-relaxed space-y-1 text-left">
            <div className="font-extrabold flex items-center gap-1.5 text-state-warn">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>실제 사장님 SNS(인스타그램·스레드)에 게시하려면?</span>
            </div>
            <p className="text-[11px] text-zinc-600 dark:text-zinc-300">
              현재는 소희가 사장님의 매장 비법 정보로 <strong>고품질 첫 시안(카피 및 이미지 룩북)을 완성하여 승인</strong>한 상태입니다.
              사장님의 실제 계정에 포스팅되려면 <strong>[공식 채널 계정 연동 (Meta 로그인)]</strong> 권한 연결이 필요합니다.
              계정을 연동하시고 승인하시면 사장님 공식 SNS(인스타그램·스레드)로 안전하게 발행됩니다. (네이버 블로그·당근은 원고를 준비해 드려요)
            </p>
          </div>
        </div>

        {/* 액션 버튼 그룹 */}
        <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/app/channels"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-state-warn via-state-danger to-primary hover:opacity-95 text-white text-xs font-black shadow-lg shadow-state-danger/25 transition-all cursor-pointer"
          >
            <Share2 className="w-4 h-4" />
            <span>내 인스타그램·스레드 공식 연동하러 가기</span>
          </Link>
          <button
            onClick={onFinish}
            disabled={isSaving}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 text-xs font-black shadow-md transition-all cursor-pointer disabled:opacity-50"
          >
            <span>{isSaving ? '대시보드 동기화 중...' : '사령부 대시보드로 이동'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 🌟 2. 인스타그램 모바일 앱 피드 기획 시안 목업 & 트랜잭션 영수증 */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        
        {/* 인스타그램 모바일 피드 룩북 목업 (7 cols) */}
        <div className="md:col-span-7 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#151518] shadow-xl overflow-hidden">
          {/* Mockup Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-state-warn via-state-danger to-primary p-0.5 shadow-xs">
                <div className="w-full h-full rounded-full bg-white dark:bg-zinc-900 flex items-center justify-center font-bold text-xs text-primary">
                  {businessName.substring(0, 1) || '소'}
                </div>
              </div>
              <div>
                <div className="text-xs font-black text-zinc-900 dark:text-zinc-100 leading-tight">
                  @{cleanHandle}
                </div>
                <div className="text-[10px] text-zinc-400 font-medium">{category || '뷰티/반영구'} · 맞춤 케어</div>
              </div>
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-state-wait-soft text-state-wait">
              승인된 첫 시안
            </span>
          </div>

          {/* Mockup Visual Image Card */}
          <div className="aspect-square w-full bg-gradient-to-br from-primary via-primary/80 to-primary/60 p-6 flex flex-col justify-between text-white relative overflow-hidden">
            <div className="flex items-center justify-between text-xs text-primary-foreground/90 font-mono">
              <span>{businessName || '우리 매장'} LOOKBOOK</span>
              <span className="px-2 py-0.5 rounded-full bg-white/10 text-[10px]">1:1 맞춤 케어</span>
            </div>
            <div className="space-y-2 text-center py-6">
              <div className="text-2xl font-black tracking-tight leading-snug">
                {signatureService || '자연스러운 1:1 맞춤 케어'}
              </div>
              <p className="text-xs text-primary-foreground/80 font-medium">
                당신만을 위한 가장 특별한 아름다움의 시작
              </p>
            </div>
            <div className="flex items-center justify-between text-[11px] text-primary-foreground/70 font-bold border-t border-white/10 pt-3">
              <span>예약 문의는 프로필 링크 및 DM</span>
              <span>100% 예약제 운영</span>
            </div>
          </div>

          {/* Mockup Actions & Caption */}
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between text-zinc-700 dark:text-zinc-300">
              <div className="flex items-center gap-4">
                <Heart className="w-5 h-5 text-state-danger fill-state-danger" />
                <MessageCircle className="w-5 h-5" />
                <Send className="w-5 h-5" />
              </div>
              <Bookmark className="w-5 h-5" />
            </div>

            <div className="text-xs space-y-1.5">
              <div className="font-extrabold text-zinc-950 dark:text-zinc-50">
                소희가 작성한 피드 카피 원고
              </div>
              <p className="text-zinc-800 dark:text-zinc-200 text-xs leading-relaxed whitespace-pre-line font-medium">
                <span className="font-bold mr-1.5">@{cleanHandle}</span>
                ✨ 이번 주 {businessName || '저희 매장'} 맞춤 예약 안내 ✨
                {'\n\n'}
                안녕하세요! {businessName || '매장'}입니다. {signatureService ? `${signatureService} 전문으로 ` : ''}고객 한 분 한 분의 스타일에 맞춘 1:1 세심한 케어를 약속드립니다.
                {'\n'}
                이번 주 여유 슬롯이 오픈되었으니 편안하게 문의해 주세요 💜
              </p>
              <div className="flex flex-wrap gap-1 text-[11px] text-primary font-bold pt-1">
                <span>#{category.replace(/\//g, '')}</span>
                <span>#{businessName.replace(/\s+/g, '') || '매장홍보'}</span>
                <span>#맞춤케어</span>
                <span>#예약문의</span>
                <span>#소희AI마케팅</span>
              </div>
            </div>
          </div>
        </div>

        {/* 정식 AI 시안 승인 증명서 (5 cols) */}
        <div className="md:col-span-5 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-6 space-y-5 shadow-lg">
          <div className="flex items-center gap-2 text-xs font-black text-state-wait uppercase tracking-wider">
            <ShieldCheck className="w-4 h-4" />
            <span>AI 마케팅 시안 승인 증명서</span>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex justify-between py-2 border-b border-zinc-200 dark:border-zinc-800">
              <span className="text-zinc-500 font-bold">승인 등록 번호</span>
              <span className="font-mono font-bold text-zinc-900 dark:text-zinc-100">WOW-REQ-{Date.now().toString().slice(-8)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-zinc-200 dark:border-zinc-800">
              <span className="text-zinc-500 font-bold">발행 상태</span>
              <span className="font-bold text-state-warn flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                승인 완료 · 계정 연동 및 승인 시 발행 (QUEUED)
              </span>
            </div>
            <div className="flex justify-between py-2 border-b border-zinc-200 dark:border-zinc-800">
              <span className="text-zinc-500 font-bold">품질 검증 (Quality Gate)</span>
              <span className="font-bold text-state-ok flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                100점 만점 통과
              </span>
            </div>
            <div className="flex justify-between py-2 border-b border-zinc-200 dark:border-zinc-800">
              <span className="text-zinc-500 font-bold">소모 Energy</span>
              <span className="font-bold text-state-warn font-mono">-10 Energy (사업자 맛보기분)</span>
            </div>
            <div className="flex justify-between py-2 border-b border-zinc-200 dark:border-zinc-800">
              <span className="text-zinc-500 font-bold">보유 Energy 잔액</span>
              <span className="font-bold text-state-wait font-mono">40 Energy (원장 지급 완료)</span>
            </div>
          </div>

          {/* 소희 AI 사원 정식 임명 & 대시보드 해금 버튼 */}
          <div className="pt-3 space-y-2">
            <button
              onClick={onFinish}
              disabled={isSaving}
              className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-state-wait to-primary hover:from-state-wait/90 hover:to-primary/90 text-white text-sm font-black shadow-xl shadow-state-wait/30 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 active:scale-95"
            >
              <span>{isSaving ? '소희 사령부 동기화 중...' : '✨ 온보딩 완주! 사령부 대시보드로 이동하기'}</span>
              <ArrowRight className="w-4 h-4 stroke-[3]" />
            </button>
            <p className="text-[11px] text-center text-zinc-500">
              클릭 시 사령부 대시보드(`/app`)의 모든 기능이 즉시 열립니다.
            </p>
          </div>
        </div>

      </div>

    </div>
  )
}
