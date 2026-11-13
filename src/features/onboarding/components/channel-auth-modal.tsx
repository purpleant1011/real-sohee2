'use client'

import { useState } from 'react'
import { CheckCircle2, ShieldCheck, X, Lock, ExternalLink } from 'lucide-react'

interface ChannelAuthModalProps {
  isOpen: boolean
  channelType: 'instagram' | 'threads' | 'naver' | 'daangn'
  channelName?: string
  currentValue?: string
  onClose: () => void
  onSave: (handle: string, isVerified: boolean) => void
}

export function ChannelAuthModal({
  isOpen,
  channelType,
  currentValue = '',
  onClose,
  onSave,
}: ChannelAuthModalProps) {
  const [handle, setHandle] = useState(currentValue)
  const [agreedTerms, setAgreedTerms] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  if (!isOpen) return null

  const isMetaChannel = channelType === 'instagram' || channelType === 'threads'

  const handleStartOAuth = () => {
    if (!agreedTerms) {
      alert('마케팅 채널 연동 및 발행 지원 약관에 동의해 주세요.')
      return
    }
    const returnPath = typeof window !== 'undefined' ? window.location.pathname : '/app/onboarding'
    window.location.href = `/api/channels/${channelType}/connect?returnPath=${encodeURIComponent(returnPath)}`
  }

  const handleSaveDraftHandle = async () => {
    if (!handle.trim()) {
      alert('계정 아이디 또는 URL을 입력해 주세요.')
      return
    }
    if (!agreedTerms) {
      alert('마케팅 채널 연동 및 발행 지원 약관에 동의해 주세요.')
      return
    }

    setIsSaving(true)
    try {
      const channelId = channelType === 'instagram' ? 'INSTAGRAM' : channelType === 'threads' ? 'THREADS' : 'NAVER_BLOG'
      await fetch('/api/channels/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId,
          accountLabel: handle.trim(),
        })
      })
      onSave(handle.trim(), false)
      onClose()
    } catch {
      onSave(handle.trim(), false)
      onClose()
    } finally {
      setIsSaving(false)
    }
  }

  const getChannelDetails = () => {
    switch (channelType) {
      case 'instagram':
        return {
          title: 'Meta Instagram Graph API 공식 연동',
          logo: 'IG',
          logoBg: 'bg-gradient-to-tr from-state-warn via-state-danger to-primary text-white',
          inputLabel: '인스타그램 비즈니스/크리에이터 계정 아이디 또는 프로필 URL',
          placeholder: '예: https://instagram.com/my_store_official 또는 @my_store_official',
          permissions: [
            '승인된 피드 이미지 게시 권한 (instagram_business_content_publish)',
            '팔로워 문의 및 댓글 알림 수신 (instagram_business_manage_comments)',
            '지역 상권 도달 및 인사이트 통계 조회 (instagram_business_manage_insights)'
          ]
        }
      case 'threads':
        return {
          title: 'Meta Threads API 공식 연동',
          logo: 'TH',
          logoBg: 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900',
          inputLabel: '스레드(Threads) 계정 아이디 또는 프로필 URL',
          placeholder: '예: https://threads.net/@my_store_official 또는 @my_store_official',
          permissions: [
            '승인된 텍스트 및 이미지 포스트 발행 (threads_content_publish)',
            '고객 멘션 및 답글 상호작용 (threads_manage_replies)',
            '게시물 반응 인사이트 조회 (threads_manage_insights)'
          ]
        }
      case 'naver':
        return {
          title: '네이버 블로그 원고 작성 지원',
          logo: 'N',
          logoBg: 'bg-state-ok text-state-ok-soft',
          inputLabel: '네이버 아이디 또는 블로그 URL',
          placeholder: '예: https://blog.naver.com/my_store 또는 네이버 아이디',
          permissions: [
            '네이버 블로그 맞춤 원고 및 이미지 준비',
            '블로그 포스팅용 키워드 및 소개글 준비',
            '네이버 검색 노출 키워드 참고 분석'
          ]
        }
      case 'daangn':
        return {
          title: '당근 비즈프로필 소식 지원',
          logo: '🥕',
          logoBg: 'bg-state-warn text-state-warn-soft',
          inputLabel: '당근 비즈프로필 웹 URL 또는 매장 상호명',
          placeholder: '예: https://town.daangn.com/bp/12345 또는 매장 상호명',
          permissions: [
            '동네 소식 및 단골 쿠폰 원고 준비',
            '당근 비즈프로필 홍보 문구 및 이미지 미리보기',
            '지역 상권 반경 타깃 홍보 아이디어 제안'
          ]
        }
    }
  }

  const details = getChannelDetails()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-3xl bg-white dark:bg-[#151518] border border-zinc-200 dark:border-zinc-800 shadow-2xl p-6 sm:p-7 space-y-5 text-zinc-900 dark:text-zinc-100">
        
        {/* Header */}
        <div className="flex items-start justify-between border-b border-zinc-100 dark:border-zinc-800 pb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-2xl ${details.logoBg} flex items-center justify-center font-black text-sm shadow-md`}>
              {details.logo}
            </div>
            <div>
              <h3 className="text-base font-extrabold text-zinc-950 dark:text-zinc-50">{details.title}</h3>
              <p className="text-xs text-zinc-500 font-medium">비밀번호/토큰을 직접 입력받지 않는 공식 프로토콜</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Input */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">{details.inputLabel}</label>
          <input
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder={details.placeholder}
            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-4 py-3 text-xs text-zinc-900 dark:text-zinc-100 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Permissions list */}
        <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 space-y-2.5">
          <div className="flex items-center gap-1.5 text-xs font-extrabold text-zinc-900 dark:text-zinc-100">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <span>요청되는 공식 권한 범위 (Scope)</span>
          </div>
          <ul className="space-y-1.5 text-[11px] text-zinc-600 dark:text-zinc-400">
            {details.permissions.map((perm, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-state-ok shrink-0 mt-0.5" />
                <span>{perm}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Terms Agreement Accordion */}
        <div className="p-3.5 rounded-2xl bg-primary/10 border border-primary/30 space-y-2">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={agreedTerms}
              onChange={(e) => setAgreedTerms(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded text-primary focus:ring-primary border-zinc-300 dark:border-zinc-700 cursor-pointer"
            />
            <div className="text-xs text-zinc-800 dark:text-zinc-200 font-bold leading-tight">
              [필수] 마케팅 채널 연동 및 발행 지원 약관에 동의합니다.
            </div>
          </label>
          <div className="text-[10px] text-zinc-500 dark:text-zinc-400 pl-6 leading-relaxed">
            • 본 권한은 사장님이 승인한 마케팅 콘텐츠 게시에만 사용되며, 언제든 [나의 소희 ➔ 채널 관리]에서 1클릭으로 연동을 즉시 해제할 수 있습니다.
          </div>
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-between gap-2.5 pt-2 border-t border-zinc-100 dark:border-zinc-800">
          <button
            type="button"
            onClick={handleSaveDraftHandle}
            disabled={isSaving}
            className="px-4 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-bold hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            {isSaving ? '저장 중...' : '계정 정보만 먼저 입력'}
          </button>

          {isMetaChannel ? (
            <button
              type="button"
              onClick={handleStartOAuth}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold shadow-md shadow-primary/20 transition-all cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Meta 공식 로그인으로 즉시 연결</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSaveDraftHandle}
              disabled={isSaving}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-state-ok text-state-ok-soft hover:bg-state-ok/90 text-xs font-bold shadow-md transition-all cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>연동 정보 등록하기</span>
            </button>
          )}
        </div>

      </div>
    </div>
  )
}
