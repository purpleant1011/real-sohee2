import { describe, expect, it } from 'vitest'
import {
  type TaskTimelineMessageArtifact,
} from './stream-events'
import { parseEvent } from './conversation-client'

describe('StreamEvent and MessageArtifact task timeline contract', () => {
  it('defines valid TaskTimelineMessageArtifact structure', () => {
    const artifact: TaskTimelineMessageArtifact = {
      id: 'timeline-1',
      kind: 'task_timeline',
      title: '마케팅 작업 계획',
      totalSteps: 3,
      completedSteps: 1,
      steps: [
        { id: 'step-1', title: '스레드 및 인스타 반응 스캔', status: 'completed', durationMs: 500 },
        { id: 'step-2', title: '고객 의도 및 감정 분석 중', status: 'in_progress' },
        { id: 'step-3', title: '답변 초안 작성 및 검토', status: 'pending' },
      ],
      isLive: true,
    }

    expect(artifact.kind).toBe('task_timeline')
    expect(artifact.steps).toHaveLength(3)
    expect(artifact.steps[0].status).toBe('completed')
    expect(artifact.steps[1].status).toBe('in_progress')
    expect(artifact.steps[2].status).toBe('pending')
  })

  it('parses task_progress StreamEvent via parseEvent', () => {
    const rawEvent = {
      type: 'task_progress',
      messageId: 'msg-123',
      timeline: {
        id: 'timeline-msg-123',
        kind: 'task_timeline',
        title: '블로그 발행 계획',
        totalSteps: 2,
        completedSteps: 1,
        steps: [
          { id: 'step-1', title: '원고 초안 생성', status: 'completed' },
          { id: 'step-2', title: '이미지 슬롯 생성', status: 'in_progress' },
        ],
        isLive: true,
      },
    }

    const parsed = parseEvent(rawEvent)
    expect(parsed).not.toBeNull()
    expect(parsed?.type).toBe('task_progress')
    if (parsed && parsed.type === 'task_progress') {
      expect(parsed.timeline.title).toBe('블로그 발행 계획')
      expect(parsed.timeline.steps).toHaveLength(2)
      expect(parsed.timeline.completedSteps).toBe(1)
    }
  })
})
