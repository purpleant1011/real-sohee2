'use client'

import React, { useState } from 'react'
import { HarnessAsset } from '@/types/harness'

interface MobileOwnerCompanionHarnessProps {
  assets: HarnessAsset[]
  onApproveDecision?: (harnessId: string, action: string) => void
}

export function MobileOwnerCompanionHarness({
  assets,
  onApproveDecision
}: MobileOwnerCompanionHarnessProps) {
  const [selectedAsset, setSelectedAsset] = useState<HarnessAsset | null>(assets[0] || null)
  const [isBottomSheetOpen, setIsBottomSheetOpen] = useState(false)
  const [isApproved, setIsApproved] = useState(false)

  const activeCount = assets.filter(a => a.overallStatus === 'READY').length

  const handleQuickApprove = () => {
    setIsApproved(true)
    if (selectedAsset && onApproveDecision) {
      onApproveDecision(selectedAsset.id, 'APPROVE_24H_BATCH')
    }
    setTimeout(() => {
      setIsBottomSheetOpen(false)
      setIsApproved(false)
    }, 800)
  }

  return (
    <div className="w-full bg-[#13141b] border border-[#2a2c3d] rounded-2xl p-4 text-white space-y-4 shadow-xl">
      {/* 1. 상단 24h 예상 SC & 하네스 상태 위젯 */}
      <div className="flex items-center justify-between pb-3 border-b border-[#222436]">
        <div>
          <span className="text-[11px] font-semibold tracking-wider text-[#8b8fa3] uppercase block">
            사장님 맞춤 비법 • 하루 운영 상태
          </span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold text-[#e1e4ea] tracking-tight">
              정상 운영
            </span>
            <span className="text-xs font-semibold text-[#8b5cf6]">자동 지원</span>
          </div>
        </div>
        <div className="text-right">
          <span className="text-[11px] text-[#8b8fa3] block">가동 중 비법</span>
          <div className="flex items-center gap-1.5 justify-end mt-1">
            <span className="w-2 h-2 rounded-full bg-[#10b981] animate-pulse" />
            <span className="text-sm font-semibold text-[#10b981]">
              {activeCount}개 사용 중
            </span>
          </div>
        </div>
      </div>

      {/* 2. 하네스 카드 리스트 */}
      <div className="space-y-2">
        {assets.map((asset) => (
          <div
            key={asset.id}
            onClick={() => {
              setSelectedAsset(asset)
              setIsBottomSheetOpen(true)
            }}
            className="flex items-center justify-between p-3 rounded-xl bg-[#1a1c29] hover:bg-[#202234] border border-[#2e3146] transition-all cursor-pointer active:scale-[0.98]"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#272a3e] flex items-center justify-center text-sm font-bold text-[#c7cbdb]">
                {asset.platform === 'instagram' ? '📸' : asset.platform === 'naver_blog' ? '🟢' : '🧵'}
              </div>
              <div>
                <h4 className="text-sm font-semibold text-[#f1f3f9] line-clamp-1">{asset.title}</h4>
                <span className="text-[11px] text-[#8e92a8]">v{asset.activeVersionNo} • 자동 운영 지원</span>
              </div>
            </div>
            <div className="text-right">
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-[#10b981]/20 text-[#34d399] border border-[#10b981]/30">
                준비 완료
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* 3. 20초 원클릭 승인 바텀시트 모달 */}
      {isBottomSheetOpen && selectedAsset && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-[#161722] border border-[#2a2c3d] rounded-t-3xl sm:rounded-3xl p-6 space-y-5 shadow-2xl animate-in slide-in-from-bottom duration-250">
            <div className="flex items-center justify-between pb-2 border-b border-[#25283b]">
              <div className="flex items-center gap-2">
                <span className="text-lg">⚡</span>
                <h3 className="text-base font-bold text-white">빠른 오늘 운영 확인</h3>
              </div>
              <button
                onClick={() => setIsBottomSheetOpen(false)}
                className="text-[#8e92a8] hover:text-white text-sm p-1"
              >
                ✕
              </button>
            </div>

            <div className="bg-[#1c1e2d] rounded-xl p-4 border border-[#2c3046] space-y-2 text-xs text-[#c4c8dc]">
              <div className="flex justify-between font-medium">
                <span className="text-[#8e92a8]">선택 비법:</span>
                <span className="text-white font-bold">{selectedAsset.title}</span>
              </div>
              <div className="flex justify-between font-medium">
                <span className="text-[#8e92a8]">오늘 활동 예정:</span>
                <span className="text-[#a78bfa] font-bold">소희 맞춤 게시 및 문의 응대</span>
              </div>
              <div className="flex justify-between font-medium">
                <span className="text-[#8e92a8]">자율 실행 모드:</span>
                <span className="text-[#34d399] font-bold">자동 운영 중</span>
              </div>
              <p className="pt-2 text-[11px] text-[#71758e] border-t border-[#25283b]">
                • 소희가 매장 비법노트와 안전 지침을 지키며 오늘 게시물을 작성합니다.
              </p>
            </div>

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setIsBottomSheetOpen(false)}
                className="flex-1 py-3 rounded-xl bg-[#222538] hover:bg-[#2b2e46] text-xs font-semibold text-[#a6abc2] transition-colors"
              >
                닫기
              </button>
              <button
                onClick={handleQuickApprove}
                disabled={isApproved}
                className="flex-2 py-3 rounded-xl bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] hover:from-[#4f46e5] hover:to-[#7c3aed] text-xs font-bold text-white shadow-lg shadow-[#6366f1]/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                {isApproved ? '✓ 승인 완료됨' : '⚡ 오늘 자동 운영 승인'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
