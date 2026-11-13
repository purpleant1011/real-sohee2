import { describe, expect, it } from 'vitest'
import {
  advanceContentInterview,
  contentInterviewView,
  createInitialContentInterview,
} from './content-interview'
import { buildSoheeContext } from './context-builder'
import { journalSourceKinds, journalSourceTypes, KNOWLEDGE_JOURNAL_NOTICE } from '@/features/sohee-studio/knowledge-journal'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const otherWorkspaceId = '22222222-2222-4222-8222-222222222222'
const threadId = '33333333-3333-4333-8333-333333333333'

function input() {
  return {
    workspace: { id: workspaceId, name: '소희 테스트', timezone: 'Asia/Seoul' },
    threadId,
    knowledgeFacts: [
      { id: '40000000-0000-4000-8000-000000000001', workspaceId, category: '브랜드', content: '승인된 어조', status: 'active' },
      { id: '40000000-0000-4000-8000-000000000002', workspaceId, category: '브랜드', content: '후보 어조', status: 'candidate' },
      { id: '40000000-0000-4000-8000-000000000003', workspaceId: otherWorkspaceId, category: '브랜드', content: '다른 작업공간 지식', status: 'active' },
    ],
    harnessRules: [
      { id: '50000000-0000-4000-8000-000000000001', workspaceId, ruleKey: 'tone', title: '존댓말', description: '짧고 분명하게', status: 'active', version: 2 },
      { id: '50000000-0000-4000-8000-000000000002', workspaceId, ruleKey: 'draft-tone', title: '후보 규칙', description: null, status: 'candidate', version: 1 },
      { id: '50000000-0000-4000-8000-000000000003', workspaceId: otherWorkspaceId, ruleKey: 'foreign', title: '다른 규칙', description: null, status: 'active', version: 1 },
    ],
    workItems: [
      { id: '60000000-0000-4000-8000-000000000001', workspaceId, title: '오늘 초안', summary: '검토 필요', status: 'review_required', priority: 'high', dueAt: null },
      { id: '60000000-0000-4000-8000-000000000002', workspaceId, title: '닫힌 작업', summary: null, status: 'archived', priority: 'normal', dueAt: null },
      { id: '60000000-0000-4000-8000-000000000003', workspaceId: otherWorkspaceId, title: '다른 작업', summary: null, status: 'drafting', priority: 'normal', dueAt: null },
    ],
    schedules: [
      { id: '70000000-0000-4000-8000-000000000001', workspaceId, contentId: '80000000-0000-4000-8000-000000000001', publishAt: '2026-08-11T00:00:00.000Z', timezone: 'Asia/Seoul', status: 'scheduled' },
      { id: '70000000-0000-4000-8000-000000000002', workspaceId, contentId: '80000000-0000-4000-8000-000000000002', publishAt: '2026-08-12T00:00:00.000Z', timezone: 'Asia/Seoul', status: 'cancelled' },
      { id: '70000000-0000-4000-8000-000000000003', workspaceId: otherWorkspaceId, contentId: '80000000-0000-4000-8000-000000000003', publishAt: '2026-08-13T00:00:00.000Z', timezone: 'Asia/Seoul', status: 'scheduled' },
    ],
    recentMessages: [
      { id: '90000000-0000-4000-8000-000000000001', workspaceId, threadId, role: 'user', content: '오늘 일정을 알려줘', status: 'completed', workItemId: null, createdAt: '2026-08-10T01:00:00.000Z', completedAt: '2026-08-10T01:00:00.000Z' },
      { id: '90000000-0000-4000-8000-000000000002', workspaceId, threadId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'user', content: '다른 스레드', status: 'completed', workItemId: null, createdAt: '2026-08-10T02:00:00.000Z', completedAt: '2026-08-10T02:00:00.000Z' },
      { id: '90000000-0000-4000-8000-000000000003', workspaceId: otherWorkspaceId, threadId, role: 'user', content: '다른 작업공간 대화', status: 'completed', workItemId: null, createdAt: '2026-08-10T03:00:00.000Z', completedAt: '2026-08-10T03:00:00.000Z' },
    ],
  } as const
}

function collectingClarification() {
  const initial = createInitialContentInterview({
    originalPrompt: '이번 주 콘텐츠를 준비해 줘.',
    channels: ['instagram'],
    requestedImageCounts: { instagram: 1 },
    referenceMediaIds: [],
  })
  const state = advanceContentInterview(initial, { value: 'consultation', source: 'option' })
  return contentInterviewView(state)
}

describe('buildSoheeContext', () => {
  it('과거 지시 일지를 승인 지식과 분리하고 다른 가게 일지는 거부한다', () => {
    const journal = { workspaceId, observedAt: '2026-10-30T00:00:00Z', entries: [],
      sources: journalSourceTypes.map(sourceType => ({ sourceType, kind: journalSourceKinds[sourceType], state: 'confirmed_empty', returnedCount: 0 })), partial: false, notice: KNOWLEDGE_JOURNAL_NOTICE }
    const context = buildSoheeContext({ ...input(), knowledgeJournal: journal })
    expect(context.knowledgeJournal).toEqual(journal)
    expect(context.approvedFacts).toHaveLength(1)
    expect(() => buildSoheeContext({ ...input(), knowledgeJournal: { ...journal, workspaceId: otherWorkspaceId } })).toThrow('KNOWLEDGE_JOURNAL_SCOPE_MISMATCH')
  })
  it('keeps business profiles scoped and distinct from approved facts', () => {
    const base = input()
    const businessContext = { workspaceId, business: { name: '프로필 가게', industry: '뷰티', location: null, summary: '맞춤 상담' }, brand: null, truncated: false }
    const context = buildSoheeContext({ ...base, businessContext })
    expect(context.businessContext).toEqual(businessContext)
    expect(context.approvedFacts.map(fact => fact.content)).not.toContain('맞춤 상담')
    expect(() => buildSoheeContext({ ...base, businessContext: { ...businessContext, workspaceId: otherWorkspaceId } })).toThrow('BUSINESS_CONTEXT_SCOPE_MISMATCH')
  })
  it('excludes expired and future facts while preserving current and undated approved knowledge', () => {
    const base = input()
    const fact = base.knowledgeFacts[0]
    const context = buildSoheeContext({ ...base, observedAt: '2026-10-30T00:00:00Z', knowledgeFacts: [
      { ...fact, content: '상시 정보' },
      { ...fact, content: '만료된 할인', validUntil: '2026-10-29T00:00:00Z' },
      { ...fact, content: '미래 행사', validFrom: '2026-11-01T00:00:00Z' },
      { ...fact, content: '현재 행사', validFrom: '2026-10-01T00:00:00Z', validUntil: '2026-11-01T00:00:00Z' },
    ] })
    expect(context.approvedFacts.map(value => value.content)).toEqual(['상시 정보', '현재 행사'])
    expect(context.approvedFacts.at(-1)?.validUntil).toBe('2026-11-01T00:00:00Z')
  })
  it('동일 트랜잭션 시각의 질문을 답변보다 먼저 모델 문맥에 배치한다', () => {
    const base = input()
    const question = base.recentMessages[0]
    const answer = { ...question, id: '90000000-0000-4000-8000-000000000004', role: 'sohee' as const, content: '정본 조회 결과 1건입니다.' }
    const context = buildSoheeContext({ ...base, recentMessages: [answer, question] })
    expect(context.recentMessages.map(message => message.role)).toEqual(['user', 'sohee'])
  })
  it('승인 지식·활성 하네스·현재 업무·현재 스레드만 남긴다', () => {
    const context = buildSoheeContext(input())

    expect(context.approvedFacts.map((fact) => fact.content)).toEqual(['승인된 어조'])
    expect(context.activeHarnessRules.map((rule) => rule.title)).toEqual(['존댓말'])
    expect(context.currentWork.map((work) => work.title)).toEqual(['오늘 초안'])
    expect(context.currentSchedules.map((schedule) => schedule.id)).toEqual(['70000000-0000-4000-8000-000000000001'])
    expect(context.recentMessages.map((message) => message.content)).toEqual(['오늘 일정을 알려줘'])
    expect(JSON.stringify(context)).not.toContain('다른 작업공간')
    expect(JSON.stringify(context)).not.toContain('후보')
  })

  it('최근 메시지를 20개와 총 16,000자 이내로 제한한다', () => {
    const base = input()
    const recentMessages = Array.from({ length: 30 }, (_, index) => ({
      id: `${String(index + 1).padStart(8, '0')}-0000-4000-8000-000000000000`,
      workspaceId,
      threadId,
      role: 'user' as const,
      content: `${index}:` + 'a'.repeat(997),
      status: 'completed' as const,
      workItemId: null,
      createdAt: new Date(Date.UTC(2026, 7, 10, 0, index)).toISOString(),
      completedAt: new Date(Date.UTC(2026, 7, 10, 0, index)).toISOString(),
    }))

    const context = buildSoheeContext({ ...base, recentMessages })

    expect(context.recentMessages).toHaveLength(16)
    expect(context.recentMessages.reduce((total, message) => total + message.content.length, 0)).toBeLessThanOrEqual(16_000)
    expect(context.recentMessages.at(-1)?.content.startsWith('29:')).toBe(true)
  })

  it('이미지 산출물이 연결된 최근 메시지는 내부 자산 식별자를 제외하고 문맥에 포함한다', () => {
    const base = input()
    const recentMessages = [{
      ...base.recentMessages[0],
      artifact: {
        type: 'media_asset' as const,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    }]

    const context = buildSoheeContext({ ...base, recentMessages })

    expect(context.recentMessages).toHaveLength(1)
    expect(context.recentMessages[0]?.content).toBe('오늘 일정을 알려줘')
    expect(context.recentMessages[0]).not.toHaveProperty('artifact')
  })

  it('복원된 인터뷰 clarification은 다음 문맥을 깨뜨리지 않고 모델 문맥에서 제거한다', () => {
    const base = input()
    const recentMessages = [{
      ...base.recentMessages[0],
      clarification: collectingClarification(),
    }]

    const context = buildSoheeContext({ ...base, recentMessages })

    expect(context.recentMessages).toHaveLength(1)
    expect(context.recentMessages[0]).not.toHaveProperty('clarification')
    expect(JSON.stringify(context.recentMessages)).not.toContain('content_interview')
  })

  it('저장 멱등성 식별자는 입력에서 허용하고 모델 문맥에서는 제거한다', () => {
    const base = input()
    const context = buildSoheeContext({
      ...base,
      recentMessages: [{
        ...base.recentMessages[0],
        clientMessageId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }],
    })

    expect(context.recentMessages).toHaveLength(1)
    expect(context.recentMessages[0]).not.toHaveProperty('clientMessageId')
  })

  it('activeGoals가 생략된 기존 호출자라도 빈 배열로 정상 호환된다', () => {
    const base = input()
    const context = buildSoheeContext(base)

    expect(context.activeGoals).toBeDefined()
    expect(context.activeGoals).toEqual([])
  })

  it('activeGoals 중 현재 작업공간의 active 목표만 선별하고 paused/draft 및 타 작업공간은 제외한다', () => {
    const base = input()
    const context = buildSoheeContext({
      ...base,
      activeGoals: [
        {
          id: 'a0000000-0000-4000-8000-000000000001',
          workspaceId,
          title: '네이버 예약 20% 증대',
          desiredOutcome: '신규 고객 유입 및 주말 예약 극대화',
          priority: 'high',
          status: 'active',
        },
        {
          id: 'a0000000-0000-4000-8000-000000000002',
          workspaceId,
          title: '인스타 릴스 주 3회 발행',
          desiredOutcome: '매장 인지도 개선',
          priority: 'normal',
          status: 'paused', // 제외 대상
        },
        {
          id: 'a0000000-0000-4000-8000-000000000003',
          workspaceId,
          title: '단골 리콜 캠페인',
          desiredOutcome: '재방문율 15% 상승',
          priority: 'low',
          status: 'draft', // 제외 대상
        },
        {
          id: 'a0000000-0000-4000-8000-000000000004',
          workspaceId: otherWorkspaceId, // 타 작업공간 제외 대상
          title: '타 매장 목표',
          desiredOutcome: '타 매장 성과',
          priority: 'high',
          status: 'active',
        },
      ],
    })

    expect(context.activeGoals).toHaveLength(1)
    expect(context.activeGoals[0]).toEqual({
      id: 'a0000000-0000-4000-8000-000000000001',
      title: '네이버 예약 20% 증대',
      desiredOutcome: '신규 고객 유입 및 주말 예약 극대화',
      priority: 'high',
    })
    // status나 workspaceId 등 내부 메타데이터는 노출되지 않음
    expect(context.activeGoals[0]).not.toHaveProperty('status')
    expect(context.activeGoals[0]).not.toHaveProperty('workspaceId')

    // goal ≠ fact ≠ execution permission 안전 지침 명시 확인
    expect(context.goalNotice).toBeDefined()
    expect(context.goalNotice).toContain('사실(Fact)이나 도구 자동 실행 권한(Execution Permission)이 아닙니다')
    expect(context.goalNotice).toContain('도구를 임의 실행')
  })
})
