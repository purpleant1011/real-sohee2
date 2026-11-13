type JsonSchema = Readonly<{
  type: 'object'
  properties: Readonly<Record<string, unknown>>
  required: readonly string[]
  additionalProperties: false
}>

export type SoheeToolDefinition = Readonly<{
  type: 'function'
  name: string
  description: string
  parameters: JsonSchema
  strict: true
}>

function tool(name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): SoheeToolDefinition {
  return Object.freeze({
    type: 'function',
    name,
    description,
    parameters: Object.freeze({ type: 'object', properties: Object.freeze(properties), required: Object.freeze(required), additionalProperties: false }),
    strict: true,
  })
}

const idProperty = Object.freeze({ type: 'string', format: 'uuid' })
const queryProperty = Object.freeze({ type: 'string', minLength: 1, maxLength: 500 })

export const soheeToolDefinitions: readonly SoheeToolDefinition[] = Object.freeze([
  tool('get_workspace_brief', '현재 작업공간의 확인된 요약을 읽습니다.'),
  tool('get_approved_profile_facts', '승인된 프로필 사실과 출처 식별자만 읽습니다.'),
  tool('search_approved_knowledge', '승인된 지식 사실만 검색합니다.', { query: queryProperty }, ['query']),
  tool('get_work_item', '현재 작업공간의 업무 상태를 읽습니다.', { id: idProperty }, ['id']),
  tool('get_content_version', '요청한 콘텐츠 버전과 승인 상태를 읽습니다.', { id: idProperty }, ['id']),
  tool('get_report_metrics', '확인된 리포트 지표를 읽습니다.'),
  tool('get_customer_conversation_summary', '비식별화된 고객 대화 요약을 읽습니다.', { id: idProperty }, ['id']),
  tool('propose_content_plan', '외부 전송 없이 검토할 콘텐츠 계획을 제안합니다.', { topic: queryProperty }, ['topic']),
  tool('propose_schedule_options', '확정하지 않고 검토할 일정 선택지를 제안합니다.', { contentId: idProperty }, ['contentId']),
  tool('propose_harness_rule', '활성화하지 않고 검토할 하네스 규칙을 제안합니다.', { instruction: queryProperty }, ['instruction']),
  tool('get_credit_balance', '현재 작업공간의 설명 가능한 크레딧 잔액을 읽습니다.'),
  tool('propose_period_plan', '저장하거나 크레딧을 확보하지 않고 기간별 다섯 채널 계획과 예상 비용을 제안합니다.', {
    periodStart: Object.freeze({ type: 'string', format: 'date' }), periodEnd: Object.freeze({ type: 'string', format: 'date' }), timezone: queryProperty, goal: queryProperty,
  }, ['periodStart', 'periodEnd', 'timezone', 'goal']),
  tool('propose_automation_rule', '활성화하지 않고 자동화 규칙을 검토용으로 제안합니다.', { instruction: queryProperty }, ['instruction']),
  tool('save_automation_rule', '승인 전 비활성 자동화 규칙만 저장합니다.', { id: idProperty }, ['id']),
  tool('pause_automation_rule', '승인된 자동화 규칙을 일시 정지로 제안합니다.', { id: idProperty }, ['id']),
  tool('resume_automation_rule', '검토와 승인이 필요한 자동화 재개를 제안합니다.', { id: idProperty }, ['id']),
  tool('request_direction_discussion', '외부 실행 없이 다음 방향을 검토할 대화를 요청합니다.', { instruction: queryProperty }, ['instruction']),
  tool('review_learning_candidate', '학습 후보를 자동 활성화하지 않고 검토 결정을 요청합니다.', { id: idProperty }, ['id']),
])
