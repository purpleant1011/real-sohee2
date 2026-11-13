'use client'

import { useCallback, useState } from 'react'
import { FourChannelStudio } from '@/features/channel-studio/ui/four-channel-studio'

const BUSINESSES = [
  { key: 'cafe', label: '성수동 모모 카페 (가격 정보 없음)' },
  { key: 'nail', label: '연남동 라온 네일 (기본 젤 55,000원 확인됨)' },
  { key: 'academy', label: '목동 새빛 수학학원 (수강료 정보 없음)' },
] as const

/** 개발 전용: 선택한 샘플 가게의 '확인된 정보'로 실제 Gemini 글을 만들어 스튜디오를 직접 써 보는 화면. */
export function LiveStudio() {
  const [biz, setBiz] = useState<(typeof BUSINESSES)[number]['key']>('cafe')
  const fetcher = useCallback<typeof fetch>((input, init) => {
    const url = String(input).replace(/^\/api\/workspaces\/[^/]+\/channel-drafts/, `/api/dev/channel-studio?biz=${biz}`)
    return fetch(url, init)
  }, [biz])

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div className="rounded-2xl border bg-accent/40 p-4 text-sm">
        <p className="font-semibold">개발용 라이브 화면 · 실제 AI로 글을 만들어요</p>
        <p className="mt-1 text-muted-foreground">로그인 없이 샘플 가게 정보만 사용해요. 실제 SNS에는 올라가지 않고, 보관도 하지 않아요.</p>
        <label className="mt-3 flex flex-col gap-1.5 text-xs font-medium sm:flex-row sm:items-center">
          샘플 가게
          <select
            value={biz}
            onChange={(event) => setBiz(event.target.value as typeof biz)}
            className="min-h-11 rounded-xl border bg-background px-3 text-sm"
          >
            {BUSINESSES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </label>
      </div>
      <FourChannelStudio key={biz} workspaceId="dev-live" fetcher={fetcher} />
    </div>
  )
}
