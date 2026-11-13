'use client'

import React, { useState } from 'react'
import { AgentActivityTimeline } from '@/components/agent-activity/agent-activity-timeline'
import { AgentReasonSummary } from '@/components/agent-activity/agent-reason-summary'
import { AgentArtifactPlanCard } from '@/components/agent-activity/agent-artifact-plan-card'
import type { AgentActivityEvent } from '@/features/agent-activity/activity-event'
import type { PlanCardData } from '@/lib/agent-os/agent-orchestrator'

const MOCK_WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const MOCK_RUN_ID = '22222222-2222-4222-8222-222222222222'

// D10 / M19: 정상 작업 및 근거 조회 완료 시안
const NORMAL_EVENTS: AgentActivityEvent[] = [
  {
    event_id: '00000000-0000-4000-8000-000000000001',
    workspace_id: MOCK_WORKSPACE_ID,
    mission_id: null,
    run_id: MOCK_RUN_ID,
    step_id: null,
    sequence: 1,
    observed_at: '2026-10-27T10:00:00.000Z',
    kind: 'request_received',
    lifecycle: 'queued',
    user_visible_summary: '요청을 접수했습니다.',
    sensitivity_level: 'public',
    simulated: true,
  },
  {
    event_id: '00000000-0000-4000-8000-000000000002',
    workspace_id: MOCK_WORKSPACE_ID,
    mission_id: null,
    run_id: MOCK_RUN_ID,
    step_id: '1',
    sequence: 2,
    observed_at: '2026-10-27T10:01:00.000Z',
    kind: 'tool_read_started',
    lifecycle: 'running',
    user_visible_summary: '연결된 도구에서 정보를 조회하고 있습니다.',
    sensitivity_level: 'public',
    simulated: true,
  },
  {
    event_id: '00000000-0000-4000-8000-000000000003',
    workspace_id: MOCK_WORKSPACE_ID,
    mission_id: null,
    run_id: MOCK_RUN_ID,
    step_id: '1',
    sequence: 3,
    observed_at: '2026-10-27T10:02:00.000Z',
    kind: 'tool_read_verified',
    lifecycle: 'verified',
    user_visible_summary: '도구의 정보 조회가 확인되었습니다.',
    sensitivity_level: 'public',
    simulated: true,
  },
  {
    event_id: '00000000-0000-4000-8000-000000000004',
    workspace_id: MOCK_WORKSPACE_ID,
    mission_id: null,
    run_id: MOCK_RUN_ID,
    step_id: '2',
    sequence: 4,
    observed_at: '2026-10-27T10:03:00.000Z',
    kind: 'externally_verified',
    lifecycle: 'verified',
    user_visible_summary: '외부 서비스의 독립 조회로 실행 결과를 확인했습니다.',
    sensitivity_level: 'public',
    simulated: true,
  },
  {
    event_id: '00000000-0000-4000-8000-000000000005',
    workspace_id: MOCK_WORKSPACE_ID,
    mission_id: null,
    run_id: MOCK_RUN_ID,
    step_id: null,
    sequence: 5,
    observed_at: '2026-10-27T10:04:00.000Z',
    kind: 'approval_needed',
    lifecycle: 'approval_needed',
    user_visible_summary: '실행 전 사장님의 승인이 필요합니다.',
    sensitivity_level: 'public',
    simulated: true,
  },
]

// M21: 실패/불명확 상태 시안
const FAILED_UNKNOWN_EVENTS: AgentActivityEvent[] = [
  {
    event_id: '00000000-0000-4000-8000-000000000011',
    workspace_id: MOCK_WORKSPACE_ID,
    mission_id: null,
    run_id: MOCK_RUN_ID,
    step_id: null,
    sequence: 1,
    observed_at: '2026-10-27T10:00:00.000Z',
    kind: 'tool_read_started',
    lifecycle: 'running',
    user_visible_summary: '연결된 도구에서 정보를 조회하고 있습니다.',
    sensitivity_level: 'public',
    simulated: true,
  },
  {
    event_id: '00000000-0000-4000-8000-000000000012',
    workspace_id: MOCK_WORKSPACE_ID,
    mission_id: null,
    run_id: MOCK_RUN_ID,
    step_id: '1',
    sequence: 2,
    observed_at: '2026-10-27T10:01:00.000Z',
    kind: 'provider_accepted',
    lifecycle: 'running',
    user_visible_summary: '외부 서비스가 요청을 접수했습니다. 결과 확인이 필요합니다.',
    sensitivity_level: 'public',
    simulated: true,
  },
  {
    event_id: '00000000-0000-4000-8000-000000000013',
    workspace_id: MOCK_WORKSPACE_ID,
    mission_id: null,
    run_id: MOCK_RUN_ID,
    step_id: '1',
    sequence: 3,
    observed_at: '2026-10-27T10:02:00.000Z',
    kind: 'result_unknown',
    lifecycle: 'result_unknown',
    user_visible_summary: '실행 결과를 아직 확인하지 못했습니다.',
    sensitivity_level: 'public',
    simulated: true,
  },
]

// D11 / M20: 실행 계획 데이터 시안
const MOCK_PLAN: PlanCardData = {
  planId: 'plan-fixture-01',
  title: '가을 신규 헤어 클리닉 혜택 안내 인스타그램 피드 게시',
  steps: [
    {
      name: '홍보 피드 이미지 및 캡션 생성',
      sc: 10,
      risk: 'LOW',
      riskLabel: '안전',
    },
    {
      name: '인스타그램 피드 발행 승인 대기',
      sc: 5,
      risk: 'MEDIUM',
      riskLabel: '주의',
    },
  ],
  totalSC: 15,
  requiresApproval: true,
}

export function AgentActivityDevPreview() {
  const [activeTab, setActiveTab] = useState<'normal' | 'failed' | 'artifact'>('normal')
  const [caption, setCaption] = useState('가을철 건조해진 모발을 위한 수분 클리닉 20% 특별 혜택!')

  return (
    <div className="space-y-6">
      <div className="flex gap-2 border-b border-border pb-3">
        <button
          type="button"
          onClick={() => setActiveTab('normal')}
          className={`min-h-11 rounded-lg px-3.5 text-xs font-semibold transition ${
            activeTab === 'normal'
              ? 'bg-purple-600 text-white'
              : 'bg-muted text-muted-foreground hover:text-foreground'
          }`}
        >
          D10/M19 정상 활동 & 근거
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('failed')}
          className={`min-h-11 rounded-lg px-3.5 text-xs font-semibold transition ${
            activeTab === 'failed'
              ? 'bg-purple-600 text-white'
              : 'bg-muted text-muted-foreground hover:text-foreground'
          }`}
        >
          M21 실패·불명확 안내
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('artifact')}
          className={`min-h-11 rounded-lg px-3.5 text-xs font-semibold transition ${
            activeTab === 'artifact'
              ? 'bg-purple-600 text-white'
              : 'bg-muted text-muted-foreground hover:text-foreground'
          }`}
        >
          D11/M20 초안 및 계획 검토
        </button>
      </div>

      {activeTab === 'normal' && (
        <div className="space-y-4">
          <AgentActivityTimeline
            events={NORMAL_EVENTS}
            filterWorkspaceId={MOCK_WORKSPACE_ID}
            filterRunId={MOCK_RUN_ID}
            title="소희의 작업 활동 (시안)"
          />
          <AgentReasonSummary
            events={NORMAL_EVENTS}
            filterWorkspaceId={MOCK_WORKSPACE_ID}
            filterRunId={MOCK_RUN_ID}
          />
        </div>
      )}

      {activeTab === 'failed' && (
        <div className="space-y-4">
          <AgentActivityTimeline
            events={FAILED_UNKNOWN_EVENTS}
            filterWorkspaceId={MOCK_WORKSPACE_ID}
            filterRunId={MOCK_RUN_ID}
            title="소희의 작업 활동 (불명확 시안)"
          />
          <AgentReasonSummary
            events={FAILED_UNKNOWN_EVENTS}
            filterWorkspaceId={MOCK_WORKSPACE_ID}
            filterRunId={MOCK_RUN_ID}
          />
        </div>
      )}

      {activeTab === 'artifact' && (
        <div className="space-y-4">
          <AgentArtifactPlanCard
            plan={MOCK_PLAN}
            workspaceId={MOCK_WORKSPACE_ID}
            runId={MOCK_RUN_ID}
            isSimulation={true}
            initialCaption={caption}
            onSaveCaption={async (newCaption) => {
              setCaption(newCaption)
            }}
          />
        </div>
      )}
    </div>
  )
}
