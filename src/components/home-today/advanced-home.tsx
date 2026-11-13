'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SoheeLiveWorkboard } from '@/components/agent-os/sohee-live-workboard'
import { MissionConsole } from '@/components/v088/work/mission-console'
import { CampaignExperimentView } from '@/components/v088/work/campaign-experiment-view'
import { RunningTasksView, WaitingTasksView, CompletedTasksView } from '@/components/v088/work/work-tab-views'
import type { WorkspaceCanonicalReadModel } from '@/features/canonical-read-model/types'

type Tab = 'pipeline' | 'campaigns' | 'running' | 'waiting' | 'completed'
const tabs: { id: Tab; title: string }[] = [
  { id: 'pipeline', title: '주간 업무 단계' }, { id: 'campaigns', title: '캠페인' },
  { id: 'running', title: '진행 중인 일' }, { id: 'waiting', title: '발행 대기' }, { id: 'completed', title: '완료된 일' },
]

export function AdvancedHome({ workspaceId, readModel }: { workspaceId: string; readModel: WorkspaceCanonicalReadModel | null }) {
  const [tab, setTab] = useState<Tab>('pipeline')
  const pendingCount = readModel?.inbox?.filter((item) => item.status === 'approval_required').length ?? 0
  const channelsCount = readModel?.channels?.filter((channel) => channel.isAuthorized).length ?? 0
  return (
    <div className="space-y-6">
      <SoheeLiveWorkboard workspaceId={workspaceId} />
      <section aria-label="업무 현황" className="grid gap-3 sm:grid-cols-3">
        <Card className="gap-2 py-4"><CardHeader className="px-4"><CardTitle>확인할 일</CardTitle></CardHeader><CardContent className="px-4 text-sm text-muted-foreground">{pendingCount}건 대기 중</CardContent></Card>
        <Card className="gap-2 py-4"><CardHeader className="px-4"><CardTitle>최근 작업</CardTitle></CardHeader><CardContent className="px-4 text-sm text-muted-foreground">{readModel?.recentActionsCount ?? 0}건 기록됨</CardContent></Card>
        <Card className="gap-2 py-4"><CardHeader className="px-4"><CardTitle>연결된 채널</CardTitle></CardHeader><CardContent className="px-4 text-sm text-muted-foreground">{channelsCount}개 연결됨</CardContent></Card>
      </section>
      <section aria-label="업무 기록" className="space-y-4">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="업무 기록 종류">
          {tabs.map((entry) => <Button key={entry.id} role="tab" aria-selected={tab === entry.id} aria-controls="advanced-work-panel" onClick={() => setTab(entry.id)} variant={tab === entry.id ? 'default' : 'outline'}>{entry.title}</Button>)}
        </div>
        <div id="advanced-work-panel" role="tabpanel" aria-label={tabs.find((entry) => entry.id === tab)?.title}>
          {tab === 'pipeline' && <MissionConsole isTestAccount={false} />}
          {tab === 'campaigns' && <CampaignExperimentView isTestAccount={false} />}
          {tab === 'running' && <RunningTasksView isTestAccount={false} />}
          {tab === 'waiting' && <WaitingTasksView isTestAccount={false} />}
          {tab === 'completed' && <CompletedTasksView isTestAccount={false} />}
        </div>
      </section>
    </div>
  )
}
