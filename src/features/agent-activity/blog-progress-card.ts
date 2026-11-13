import { isActivityId } from './activity-event'
import type { TaskTimelineItem, TaskTimelineMessageArtifact } from '@/features/chat/stream-events'

const STAGES = {
  keyword_lookup: '키워드 조회',
  benchmark: '벤치마크 조사',
  topic_suggestion: '주제 제안',
  draft_writing: '원고 작성',
  image_generation: '이미지 생성',
} as const
// Public labels come only from this allowlist; free-form source text is never forwarded.
const SOURCES = {
  naver_search: '네이버 검색',
  naver_datalab: '네이버 데이터랩',
  naver_searchad: '네이버 검색광고',
  own_blog: '내 블로그',
  business_facts: '확인된 가게 정보',
} as const
const STATUS_LABEL = { started: '진행 중', verified: '확인됨', failed: '실패', partial: '일부만 확인' } as const
const PROVENANCE = ['server_record', 'fixture', 'simulated'] as const

export type BlogStage = keyof typeof STAGES
export type BlogSourceId = keyof typeof SOURCES

/** A fact recorded by the server for one blog research/writing stage. */
export interface BlogStageFact {
  eventId: string
  workspaceId: string
  runId: string
  sequence: number
  observedAt: string
  stage: BlogStage
  status: keyof typeof STATUS_LABEL
  provenance: typeof PROVENANCE[number]
  sourceId: BlogSourceId
  sampleSize?: number
  coverage?: { covered: number; total: number }
}

const kst = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false })

function valid(fact: unknown): fact is BlogStageFact {
  if (!fact || typeof fact !== 'object') return false
  const f = fact as Record<string, unknown>
  const c = f.coverage as { covered?: unknown; total?: unknown } | undefined
  return isActivityId(f.eventId) && isActivityId(f.workspaceId) && isActivityId(f.runId)
    && Number.isSafeInteger(f.sequence) && (f.sequence as number) >= 1
    && typeof f.observedAt === 'string' && Number.isFinite(Date.parse(f.observedAt))
    && typeof f.stage === 'string' && Object.hasOwn(STAGES, f.stage)
    && typeof f.status === 'string' && Object.hasOwn(STATUS_LABEL, f.status)
    && (PROVENANCE as readonly unknown[]).includes(f.provenance)
    && typeof f.sourceId === 'string' && Object.hasOwn(SOURCES, f.sourceId)
    && (f.sampleSize === undefined || (Number.isSafeInteger(f.sampleSize) && (f.sampleSize as number) >= 0))
    && (c === undefined || (Number.isSafeInteger(c.covered) && Number.isSafeInteger(c.total)
      && (c.covered as number) >= 0 && (c.covered as number) <= (c.total as number) && (c.total as number) > 0))
}

/**
 * Projects server-recorded blog stage facts into the shared task timeline. Only a verified
 * server record counts as completed; fixtures, started-without-outcome and partial results do not.
 */
export function projectBlogProgress(
  facts: readonly unknown[],
  scope: { workspaceId: string; runId: string; live: boolean },
): TaskTimelineMessageArtifact | null {
  const latest = new Map<BlogStage, BlogStageFact>()
  const seen = new Set<string>()
  for (const raw of facts) {
    if (!valid(raw) || raw.workspaceId !== scope.workspaceId || raw.runId !== scope.runId || seen.has(raw.eventId)) continue
    seen.add(raw.eventId)
    const current = latest.get(raw.stage)
    if (!current || raw.sequence >= current.sequence) latest.set(raw.stage, raw)
  }
  const steps: TaskTimelineItem[] = [...latest.values()].sort((a, b) => a.sequence - b.sequence).map(f => {
    const practice = f.provenance !== 'server_record'
    const detail = [
      SOURCES[f.sourceId], kst.format(new Date(f.observedAt)),
      ...(f.sampleSize !== undefined ? [`표본 ${f.sampleSize}건`] : []),
      ...(f.coverage ? [`범위 ${f.coverage.covered}/${f.coverage.total}`] : []),
    ].join(' · ')
    return {
      id: `blog-${f.stage}`,
      title: `${practice ? '시안·연습 · ' : ''}${STAGES[f.stage]} · ${STATUS_LABEL[f.status]} (${detail})`,
      status: practice ? 'unknown'
        : f.status === 'verified' ? 'completed'
        : f.status === 'failed' ? 'failed'
        : f.status === 'started' && scope.live ? 'in_progress'
        : 'unknown',
    }
  })
  if (!steps.length) return null
  return {
    id: `blog-progress-${scope.runId}`, kind: 'task_timeline', title: '블로그 조사·작성 진행', steps,
    totalSteps: steps.length, completedSteps: steps.filter(s => s.status === 'completed').length, isLive: scope.live,
  }
}
