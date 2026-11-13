import { describe, expect, it } from 'vitest'
import {
  requestsConversationKnowledgeProposal,
  shouldUsePreparedConversationAgent,
  isConversationAgentRuntimeEnabled,
  requestsConversationInteractionDraft,
  getPreparedConversationReadRequirements,
  isTeachConversationMarker,
  hasActiveTeachingInterview,
} from './prepared-conversation-routing'

describe('prepared business-agent routing', () => {
  it.each([
    ['월요일은 휴무라고 기억해줘', true],
    ['운영 규칙으로 제안해줘', true],
    ['지식에 저장해줘', true],
    ['지식에 저장하지 마', false],
    ['기억해 두지 말고 이번에만 참고해', false],
    ['가게 지식을 확인해줘', false],
  ])('requires explicit candidate persistence intent: %s', (message, expected) => {
    expect(requestsConversationKnowledgeProposal(message)).toBe(expected)
    if (expected) expect(shouldUsePreparedConversationAgent(message)).toBe(true)
  })
  it('requires native automation observations for saved routine reads without treating them as writes', () => {
    expect(shouldUsePreparedConversationAgent('저장된 자동화 설정을 확인해줘')).toBe(true)
    expect(getPreparedConversationReadRequirements('저장된 자동화 설정을 확인해줘')).toContain('automation.list')
    expect(getPreparedConversationReadRequirements('보고 루틴은 조회하지 말고 댓글만 확인해줘')).not.toContain('automation.list')
  })
  it('requires both sources for a compound read without confusing reservation inquiries with the booking ledger', () => {
    expect(getPreparedConversationReadRequirements('댓글과 예약을 확인해줘')).toEqual(['reservation.list', 'interaction.list'])
    expect(getPreparedConversationReadRequirements('예약 문의 댓글만 확인해줘')).toEqual(['interaction.list'])
    expect(getPreparedConversationReadRequirements('예약 장부는 조회하지 말고 DM만 확인해줘')).toEqual(['interaction.list'])
  })
  it('keeps an explicit read follow-up tied to the previous user-requested business scope', () => {
    expect(shouldUsePreparedConversationAgent('그 자료를 다시 확인해줘', '예약 장부를 확인해줘')).toBe(true)
    expect(getPreparedConversationReadRequirements('그 자료를 다시 확인해줘', '예약 장부를 확인해줘')).toEqual(['reservation.list'])
    expect(shouldUsePreparedConversationAgent('그 자료를 다시 확인해줘', '인스타그램 게시물 만들어줘')).toBe(false)
  })
  it.each([
    ['받은 DM을 확인하고 답변 초안을 제안해줘. 발송은 하지 마.', true],
    ['고객 댓글 답변 초안을 만들어줘', true],
    ['오늘 댓글과 DM만 확인해줘', false],
    ['댓글 초안은 만들지 말고 조회만 해줘', false],
    ['DM 초안을 작성하지 마', false],
    ['블로그 글 초안을 만들어줘', false],
  ])('only offers reply draft writes for an explicit preparation request: %s', (message, expected) => {
    expect(requestsConversationInteractionDraft(message)).toBe(expected)
  })
  it('supports a narrow verification stage and an explicit all-account rollout without wildcard widening', () => {
    const env = { CONVERSATION_AGENT_RUNTIME_ENABLED: '1', CONVERSATION_AGENT_RUNTIME_WORKSPACE_ALLOWLIST: 'workspace-a' }
    expect(isConversationAgentRuntimeEnabled('workspace-a', env)).toBe(true)
    expect(isConversationAgentRuntimeEnabled('workspace-b', env)).toBe(false)
    expect(isConversationAgentRuntimeEnabled('workspace-b', { ...env, CONVERSATION_AGENT_RUNTIME_WORKSPACE_ALLOWLIST: '*' })).toBe(false)
    expect(isConversationAgentRuntimeEnabled('workspace-b', { ...env, CONVERSATION_AGENT_RUNTIME_ROLLOUT: 'all' })).toBe(true)
    expect(isConversationAgentRuntimeEnabled('', { ...env, CONVERSATION_AGENT_RUNTIME_ROLLOUT: 'all' })).toBe(false)
    expect(isConversationAgentRuntimeEnabled('workspace-a', { ...env, CONVERSATION_AGENT_RUNTIME_ENABLED: '0' })).toBe(false)
  })

  it.each([
    '오늘 고객 댓글과 예약 문의를 확인해줘',
    'DM에서 예약 가능 시간을 묻는 고객에게 답변 초안을 제안해줘',
    '우리 가게 지식과 최근 문의를 참고해서 다음 주 프로모션을 기획해줘',
    '예약 장부를 확인하고 이번 주 가능한 시간을 정리해줘',
    '이번 주 성과와 다음 마케팅 계획을 비교해줘',
  ])('selects real business-data work: %s', text => {
    expect(shouldUsePreparedConversationAgent(text)).toBe(true)
  })

  it.each([
    '안녕하세요',
    '고마워',
    '네이버 블로그 글 작성해줘',
    '인스타그램 게시물 3개 만들어줘',
    '사진 2장 만들어줘',
    '예약 문의 회수해줘',
  ])('preserves general answers and existing specialized flows: %s', text => {
    expect(shouldUsePreparedConversationAgent(text)).toBe(false)
  })

  describe('teaching conversation continuity', () => {
    const topicTeachPrompt = "우리 가게의 '영업시간·위치'에 대해 가르쳐주고 싶어. 궁금한 점을 한 번에 하나씩 차근차근 질문해줘. 사장님이 직접 확인하고 승인하기 전까지는 어떤 정보도 저장되지 않으니, 저장하기 전에 확인한 사실을 먼저 되짚어서 확인해줘."
    const modeTeachPrompt = "우리 가게에 대해 소희가 알아야 할 것을 가르치고 싶어. 궁금한 것부터 하나씩 질문해줘."

    it('identifies teach prompt markers correctly', () => {
      expect(isTeachConversationMarker(topicTeachPrompt)).toBe(true)
      expect(isTeachConversationMarker(modeTeachPrompt)).toBe(true)
      expect(isTeachConversationMarker('저장하기 전에 확인해줘')).toBe(true)
      expect(isTeachConversationMarker('월요일은 쉬어요')).toBe(false)
      expect(isTeachConversationMarker('안녕하세요')).toBe(false)
    })

    it('routes initial teach prompts to the prepared agent', () => {
      expect(shouldUsePreparedConversationAgent(topicTeachPrompt)).toBe(true)
      expect(shouldUsePreparedConversationAgent(modeTeachPrompt)).toBe(true)
      expect(shouldUsePreparedConversationAgent('가게 소개에 대해 가르쳐주고 싶어. 저장하기 전에 확인해줘.')).toBe(true)
    })

    it('routes follow-up answers like "월요일은 쉬어요" when previousUserMessage was a teach prompt', () => {
      expect(shouldUsePreparedConversationAgent('월요일은 쉬어요', topicTeachPrompt)).toBe(true)
      expect(shouldUsePreparedConversationAgent('10시부터 8시까지예요', modeTeachPrompt)).toBe(true)
      expect(shouldUsePreparedConversationAgent('월요일은 쉬어요', '안녕하세요')).toBe(false)
    })

    it('routes follow-up answers when thread recentMessages show an active teaching interview', () => {
      const recentMessages = [
        { role: 'user', content: topicTeachPrompt },
        { role: 'sohee', content: '영업시간과 휴무일은 어떻게 되나요?' },
      ]
      expect(hasActiveTeachingInterview(recentMessages)).toBe(true)
      expect(shouldUsePreparedConversationAgent('월요일은 쉬어요', undefined, { recentMessages })).toBe(true)
      expect(shouldUsePreparedConversationAgent('월요일은 쉬어요', undefined, recentMessages)).toBe(true)
      expect(shouldUsePreparedConversationAgent('월요일은 쉬어요', undefined, { teachingActive: true })).toBe(true)
    })

    it('소희 답변의 문구만으로는 가르치기가 시작된 것으로 보지 않는다(사장님이 시작 문구를 보낸 경우만)', () => {
      const recentMessages = [
        { role: 'sohee', content: '우리 매장 가르치기를 시작할게요. 저장하기 전에 확인한 사실을 먼저 되짚어 드릴게요. 휴무일은 언제인가요?' },
      ]
      expect(hasActiveTeachingInterview(recentMessages)).toBe(false)
      expect(shouldUsePreparedConversationAgent('월요일은 쉬어요', undefined, { recentMessages })).toBe(false)
    })

    it('rejects post/image requests even within an active teaching thread', () => {
      const recentMessages = [
        { role: 'user', content: topicTeachPrompt },
        { role: 'sohee', content: '영업시간과 휴무일은 어떻게 되나요?' },
      ]
      expect(shouldUsePreparedConversationAgent('인스타그램 게시물 3개 만들어줘', undefined, { recentMessages })).toBe(false)
      expect(shouldUsePreparedConversationAgent('사진 2장 만들어줘', undefined, { recentMessages })).toBe(false)
      expect(shouldUsePreparedConversationAgent('네이버 블로그 글 작성해줘', undefined, { recentMessages })).toBe(false)
    })
  })
})

describe('가르치기 연속성 범위 (리뷰 반영)', () => {
  const teachStart = { role: 'user', content: "우리 가게의 '가격'에 대해 가르쳐주고 싶어. 궁금한 점을 한 번에 하나씩 차근차근 질문해줘. 사장님이 직접 확인하고 승인하기 전까지는 어떤 정보도 저장되지 않으니, 저장하기 전에 확인한 사실을 먼저 되짚어서 확인해줘." }
  it('소희의 답변에 흔한 문구("저장하기 전에")가 있어도 가르치기로 보지 않는다', () => {
    expect(hasActiveTeachingInterview([{ role: 'assistant', content: '저장하기 전에 확인해 주세요' }])).toBe(false)
  })
  it('가르치기 시작 후 한참 지난(최근 8개 밖) 대화는 가르치기로 보지 않는다', () => {
    const filler = Array.from({ length: 9 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `잡담 ${i}` }))
    expect(hasActiveTeachingInterview([teachStart, ...filler])).toBe(false)
    expect(hasActiveTeachingInterview([teachStart, { role: 'assistant', content: '가격은 어떻게 되나요?' }])).toBe(true)
  })
})
