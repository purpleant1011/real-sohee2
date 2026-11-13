export type GateBlocker =
  | 'ROLE' | 'FEATURE_OFF' | 'KILL_SWITCH' | 'WORKSPACE_NOT_ALLOWED' | 'PROVIDER_NOT_READY'
  | 'TOKEN_EXPIRED' | 'SCOPE_MISSING' | 'POLICY_WINDOW_EXPIRED' | 'COST_UNACKNOWLEDGED'
  | 'CONSENT_MISSING' | 'SOURCE_STALE' | 'ALREADY_SENT' | 'IDEMPOTENCY_IN_FLIGHT' | 'DATASET_NOT_ACTUAL'

export interface ExecutionGate { enabled: boolean; blockers: GateBlocker[]; userMessage: string; evaluatedAt: string }

/** Every field is tri-state: anything other than an explicit safe value blocks (fail-closed). */
export interface GateFacts {
  role: 'owner' | 'manager' | 'member' | string | null
  featureEnabled: boolean | null
  killSwitchActive: boolean | null
  workspaceAllowed: boolean | null
  providerReady: boolean | null
  tokenValid: boolean | null
  scopeGranted: boolean | null
  policyWindowOpen: boolean | null
  costRequired: boolean | null
  costAcknowledged: boolean | null
  consentsSatisfied: boolean | null
  sourceFresh: boolean | null
  alreadySent: boolean | null
  inFlight: boolean | null
  datasetMode: 'ACTUAL' | 'SHOWCASE_DEMO' | 'TEST' | 'UNKNOWN' | null
}

const MESSAGES: Record<GateBlocker, string> = {
  ROLE: '이 작업을 실행할 권한이 없어요.',
  FEATURE_OFF: '아직 이 기능으로 보내지 않아요. 내용 검토만 할 수 있어요.',
  KILL_SWITCH: '안전을 위해 실행이 잠시 멈춰 있어요.',
  WORKSPACE_NOT_ALLOWED: '이 사업장은 아직 실행이 열려 있지 않아요.',
  PROVIDER_NOT_READY: '채널 연결을 확인하지 못해 보낼 수 없어요.',
  TOKEN_EXPIRED: '채널 연결이 만료돼 보낼 수 없어요. 다시 연결해 주세요.',
  SCOPE_MISSING: '보내기 권한이 승인되지 않았어요.',
  POLICY_WINDOW_EXPIRED: '답장 가능 시간이 지났어요. 문안을 복사해 직접 보내 주세요.',
  COST_UNACKNOWLEDGED: '예상 비용을 먼저 확인해 주세요.',
  CONSENT_MISSING: '필요한 동의가 확인되지 않았어요.',
  SOURCE_STALE: '고객의 새 메시지가 있을 수 있어요. 최신 내용을 다시 확인해 주세요.',
  ALREADY_SENT: '이미 보낸 내용이에요.',
  IDEMPOTENCY_IN_FLIGHT: '전송 요청을 처리하고 있어요. 결과를 확인해 주세요.',
  DATASET_NOT_ACTUAL: '실제 데이터가 아니라 실행할 수 없어요.',
}

export function evaluateExecutionGate(facts: GateFacts, now: () => string = () => new Date().toISOString()): ExecutionGate {
  const blockers: GateBlocker[] = []
  const add = (b: GateBlocker) => { if (!blockers.includes(b)) blockers.push(b) }
  if (facts.role !== 'owner' && facts.role !== 'manager') add('ROLE')
  if (facts.featureEnabled !== true) add('FEATURE_OFF')
  if (facts.killSwitchActive !== false) add('KILL_SWITCH')
  if (facts.workspaceAllowed !== true) add('WORKSPACE_NOT_ALLOWED')
  if (facts.providerReady !== true) add('PROVIDER_NOT_READY')
  if (facts.tokenValid !== true) add('TOKEN_EXPIRED')
  if (facts.scopeGranted !== true) add('SCOPE_MISSING')
  if (facts.policyWindowOpen !== true) add('POLICY_WINDOW_EXPIRED')
  // Unknown cost applicability cannot be cleared by acknowledgement alone.
  if (facts.costRequired !== false && (facts.costRequired !== true || facts.costAcknowledged !== true)) add('COST_UNACKNOWLEDGED')
  if (facts.consentsSatisfied !== true) add('CONSENT_MISSING')
  if (facts.sourceFresh !== true) add('SOURCE_STALE')
  if (facts.alreadySent !== false) add('ALREADY_SENT')
  if (facts.inFlight !== false) add('IDEMPOTENCY_IN_FLIGHT')
  if (facts.datasetMode !== 'ACTUAL') add('DATASET_NOT_ACTUAL')
  return { enabled: blockers.length === 0, blockers, userMessage: blockers.length ? MESSAGES[blockers[0]] : '', evaluatedAt: now() }
}
