import { buildSoheeContext, type SoheeContextBundle } from './context-builder'

const factId = 'b17e0000-0000-4000-8000-000000000001'
const ruleId = 'b17e0000-0000-4000-8000-000000000002'

export function buildByreumCompatibilityContext(input: {
  workspaceId: string
  threadId: string
}): SoheeContextBundle {
  return buildSoheeContext({
    workspace: {
      id: input.workspaceId,
      name: '바이름 테스트 작업공간',
      timezone: 'Asia/Seoul',
    },
    threadId: input.threadId,
    knowledgeFacts: [{
      id: factId,
      workspaceId: input.workspaceId,
      category: 'image_generation_harness',
      content: [
        '바이름 이미지 생성은 BYREUM_RECOMMENDED_HARNESS_V1.0만 사용한다.',
        '인스타그램, 스레드, 네이버 블로그용 결과는 글자, 로고, 워터마크가 없는 4:5 PNG 초안으로 준비한다.',
        '21~38세의 서로 다른 합성 한국 성인, 흰색 3단 주름 마스크, 자연스러운 회갈색 눈썹, 실제 휴대전화 촬영 질감을 유지한다.',
        '실제 고객 결과나 전후 사례로 주장하지 않고 원장 승인 전 DRAFT_OWNER_APPROVAL_PENDING 상태로 둔다.',
      ].join(' '),
      status: 'active',
    }],
    harnessRules: [{
      id: ruleId,
      workspaceId: input.workspaceId,
      ruleKey: 'byreum-recommended-image-v1',
      title: '바이름 추천 이미지 하네스 V1.0',
      description: '인스타그램, 스레드, 네이버 블로그용 바이름 이미지 생성 규칙',
      status: 'active',
      version: 1,
    }],
    workItems: [],
    schedules: [],
    recentMessages: [],
  })
}
