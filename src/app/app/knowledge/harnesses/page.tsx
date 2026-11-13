'use client'

import React, { useState } from 'react'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { HarnessLibraryView } from '@/components/v088/harness/harness-library-view'
import { HarnessDetailView } from '@/components/v088/harness/harness-detail-view'
import { HarnessCreateModal } from '@/components/v088/harness/harness-create-modal'
import { Sparkles, Layers, ShieldCheck } from 'lucide-react'

export default function HarnessesKnowledgePage() {
  const [selectedHarnessId, setSelectedHarnessId] = useState<string | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

  return (
    <V088AppShell>
      <div className="space-y-6">
        {/* 최상단 브레드크럼 & 타이틀 */}
        {!selectedHarnessId && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-zinc-400 mb-1">
                <span>비법 학습</span>
                <span>/</span>
                <span className="text-state-ok">인기 매장 비법노트</span>
              </div>
              <h1 className="text-2xl md:text-3xl font-black text-zinc-900 dark:text-zinc-50 tracking-tight">
                인기 매장 운영 비법노트
              </h1>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                잘나가는 벤치마크 계정의 글쓰기 방식과 시각 구도를 학습하여 우리 매장 마케팅에 쏙쏙 적용합니다.
              </p>
            </div>
          </div>
        )}

        {/* 뷰 전환 */}
        {selectedHarnessId ? (
          <HarnessDetailView
            harnessId={selectedHarnessId}
            onBack={() => setSelectedHarnessId(null)}
          />
        ) : (
          <HarnessLibraryView
            onSelectHarness={id => setSelectedHarnessId(id)}
            onOpenCreateModal={() => setIsCreateModalOpen(true)}
          />
        )}

        {/* 생성 모달 */}
        <HarnessCreateModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          onCreated={id => setSelectedHarnessId(id)}
        />
      </div>
    </V088AppShell>
  )
}
