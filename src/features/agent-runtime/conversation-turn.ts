export interface ConversationTurn {
  id: string
  workspaceId: string
  conversationId: string
  userMessage: string
  agentResponseText: string
  createdMissionIds: string[]
  createdActionRunIds: string[]
  decisionIds: string[]
  outcomeIds: string[]
  createdAt: string
}

export interface MissionObject {
  id: string
  workspaceId: string
  title: string
  goalCategory: string
  status: 'DRAFT' | 'PLANNING' | 'READY' | 'RUNNING' | 'WAITING_DECISION' | 'WAITING_CREDIT' | 'BLOCKED' | 'VERIFICATION_PENDING' | 'VERIFIED' | 'PARTIAL' | 'FAILED' | 'STOPPED'
  createdFromConversationTurnId?: string
  planSummary: string
  targetChannel?: string
  estimatedCredits: number
  settledCredits?: number
  actionRunIds: string[]
  externalArtifactUrl?: string
  verifiedAt?: string
  createdAt: string
  updatedAt: string
}

/**
 * 대화 입력(Prompt)으로부터 영속 Mission 및 ActionRun 생성 (Command Plane)
 */
export function createMissionFromConversation(
  workspaceId: string,
  conversationId: string,
  userPrompt: string
): { turn: ConversationTurn; mission: MissionObject } {
  const turnId = `turn-${Date.now()}`
  const missionId = `mission-${Date.now()}`
  const now = new Date().toISOString()

  const mission: MissionObject = {
    id: missionId,
    workspaceId,
    title: userPrompt.length > 30 ? userPrompt.slice(0, 30) + '...' : userPrompt,
    goalCategory: 'MARKETING_PROMOTION',
    status: 'READY',
    createdFromConversationTurnId: turnId,
    planSummary: `사용자 지시사항: "${userPrompt}"에 따른 마케팅 미션 기획 및 자동화 실행`,
    estimatedCredits: 350,
    actionRunIds: [`act-${Date.now()}-1`],
    createdAt: now,
    updatedAt: now,
  }

  const turn: ConversationTurn = {
    id: turnId,
    workspaceId,
    conversationId,
    userMessage: userPrompt,
    agentResponseText: `지시하신 업무("${userPrompt}")를 확인하여 마케팅 미션 [${mission.title}]을(를) 생성했습니다. 승인 후 실행을 진행할 수 있습니다.`,
    createdMissionIds: [missionId],
    createdActionRunIds: mission.actionRunIds,
    decisionIds: [],
    outcomeIds: [],
    createdAt: now,
  }

  return { turn, mission }
}
