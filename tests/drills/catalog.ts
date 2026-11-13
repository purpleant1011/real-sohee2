/**
 * V0.93 Failure Injection Drill Catalog (ANI-1640 / ANI-1641 v2)
 *
 * Defines D093-01 ~ D093-12 scenarios, specifications, boundaries,
 * and current verification levels under the W4 v2 approval/reconcile contract.
 *
 * Ground Truth:
 * - docs/security/v093-drill-v2-design.md
 * - CHARTER §2, §10, §12
 */

export type DrillVerificationLevel = 'CONTRACT_PASS' | 'NOT_VERIFIED' | 'FAIL';

export interface DrillScenario {
  id: string;
  title: string;
  given: string;
  when: string;
  then: string;
  forbiddenActions: readonly string[];
  targetSeams: readonly string[];
  verificationLevel: DrillVerificationLevel;
  narrowContractScope?: string;
  limitations: string;
}

export const DRILL_CATALOG: readonly DrillScenario[] = [
  {
    id: 'D093-01',
    title: '토큰 만료 · 401/403 명시 거절 및 스코프/컨텍스트 부재',
    given: '외부 채널 자격증명이 만료되었거나 권한이 박탈되었거나 필수 스코프/승인 DTO가 결여된 상태',
    when: '답장 전송(approveAndSendReply) 실행 시 401/403 수신, 권한 스코프 누락, 또는 loadApprovedReply 부재',
    then: '401/403은 RESULT_UNKNOWN, 스코프 누락은 POLICY_BLOCKED, loadApprovedReply 부재는 CONTEXT_REQUIRED로 강등, 자동 transport 재호출 0회',
    forbiddenActions: ['자동 transport 재호출', '자격증명 로그 노출', '실패를 성공으로 표시'],
    targetSeams: ['approveAndSendReply', 'loadChannelCredential'],
    verificationLevel: 'NOT_VERIFIED',
    narrowContractScope: '401/403 거절(RESULT_UNKNOWN), 권한 스코프 누락(POLICY_BLOCKED), DTO 부재(CONTEXT_REQUIRED) 반환 및 send 0~1회 확인',
    limitations: 'PII/자격증명 로거 스파이 미검증, 실제 Meta Graph API 미연결',
  },
  {
    id: 'D093-02',
    title: '429 Rate Limit (요청 폭주 제한)',
    given: '채널 프로바이더에서 요청 한도(429 Rate Limit) 초과 응답 반환',
    when: '메시지 발송 요청 실행',
    then: 'RESULT_UNKNOWN으로 강등되어 outbox 큐에 적재, 사장님 승인 없는 무단 즉시 재전송 0건',
    forbiddenActions: ['자동 즉시 재발송 루프', '오류를 빈 성공으로 마스킹'],
    targetSeams: ['approveAndSendReply', 'reconcileOutboxItem'],
    verificationLevel: 'NOT_VERIFIED',
    narrowContractScope: '429 수신 시 RESULT_UNKNOWN 강등 및 outbox 큐 적재(UNKNOWN) 계약 확인',
    limitations: '인메모리 mock 의존, 실제 프로바이더 rate limit 헤더(Retry-After) 대사 미검증',
  },
  {
    id: 'D093-03',
    title: '5xx 서버 장애 · 실행 여부 불명',
    given: '프로바이더 서버에서 500/502/503/504 장애 응답 반환',
    when: '메시지 전송 요청 실행',
    then: 'RESULT_UNKNOWN으로 안전 강등, outbox에 unknown 적재, 오류를 EMPTY/성공으로 표시하지 않음',
    forbiddenActions: ['성공으로 간주', '자동 중복 발송', '오류를 EMPTY 목록으로 왜곡'],
    targetSeams: ['approveAndSendReply'],
    verificationLevel: 'NOT_VERIFIED',
    narrowContractScope: '500/502/503/504 수신 시 RESULT_UNKNOWN 강등 및 성공 은폐 차단 계약 확인',
    limitations: '실제 네트워크 게이트웨이 타임아웃 미검증',
  },
  {
    id: 'D093-04',
    title: 'Provider 기록 후 응답 Timeout 및 2단계 대사',
    given: '프로바이더 내부에서는 메시지가 정상 기록되었으나 네트워크 타임아웃 발생 후 복구',
    when: '호출자가 타임아웃 예외를 수신 후 outbox 대사 워커(reconcileOutboxItem) 실행',
    then: '1단계 RESULT_UNKNOWN 강등 후 outbox 적재, 2단계 유효한 attempted send evidence 기반 readback 수행하여 send 증가 0회로 RESOLVED_VERIFIED 승격',
    forbiddenActions: ['재시작 후 즉시 재발송 (중복 발송)', 'readback 없이 성공 승격', 'zero UUID로 감사 전이 조작'],
    targetSeams: ['approveAndSendReply', 'reconcileOutboxItem'],
    verificationLevel: 'NOT_VERIFIED',
    narrowContractScope: '전송 타임아웃 후 유효 AttemptedSendEvidence 기반 대사 성공 시 transport 추가 호출 없이 RESOLVED_VERIFIED 승격 확인',
    limitations: '모의 테스트 환경 한정, 실제 프로바이더/DB 분산 지연 미검증으로 NOT_VERIFIED 유지',
  },
  {
    id: 'D093-05',
    title: 'Provider 성공 후 DB Commit 실패',
    given: '프로바이더 전송 및 readback까지 성공했으나 후속 DB 상태 영속화(finishStep 등) 실패',
    when: '데이터베이스 연결 끊김 또는 락 타임아웃 발생',
    then: '성공으로 은폐하지 않고 RESULT_UNKNOWN 반환, 새 원고 재생성 또는 자동 resend 0건',
    forbiddenActions: ['영속화 실패를 무시하고 UI에 완료 표시', '새 원고 자동 재생성 및 중복 발송'],
    targetSeams: ['approveAndSendReply'],
    verificationLevel: 'NOT_VERIFIED',
    narrowContractScope: 'finishStep 실패 시 RESULT_UNKNOWN 반환 및 오류 메시지 보존 계약 확인',
    limitations: '실제 PostgreSQL 트랜잭션 롤백 및 보상 트랜잭션 미검증',
  },
  {
    id: 'D093-06',
    title: '동일 Webhook 반복 · Lease 중복',
    given: '이미 처리된 동일 provider event id 웹훅 또는 이미 선점(CLAIMED)된 작업 단계 lease',
    when: '중복 수신 또는 동시 워커가 동일 단계 획득 시도',
    then: '중복 웹훅은 duplicate 상태 반환 및 메시지 중복 삽입 차단, 중복 lease는 VERSION_CONFLICT로 외부 transport 호출 0회',
    forbiddenActions: ['중복 단계 실행으로 인한 다중 발송', '인메모리 Map만으로 영속 DB exactly-once 주장'],
    targetSeams: ['ingestDmMessage', 'approveAndSendReply'],
    verificationLevel: 'NOT_VERIFIED',
    narrowContractScope: 'claimStep 거절 시 VERSION_CONFLICT, insertMessageIfAbsent 중복 시 duplicate 반환 확인',
    limitations: 'mock repo 반환값 검증일 뿐, 실제 DB 레벨 분산 락, PostgreSQL lease 경합, 영속 exactly-once 미검증',
  },
  {
    id: 'D093-07',
    title: '가격/수신자/원문 변경 후 Stale 승인',
    given: '사장님 승인 후 고객의 새 발화 수신, 원문 수정, 승인 지문 불일치, 또는 SEND_REQUESTED 후 재조회 불일치',
    when: '과거 승인 토큰/지문으로 발송 시도하거나 시작 직후 데이터 변경 감지',
    then: 'VERSION_CONFLICT 반환, 외부 transport 호출 0건, 사전 시작 시 HUMAN_REVIEW 전이 격리',
    forbiddenActions: ['변경된 고객 메시지 무시하고 발송', '지문 불일치 무시하고 이전 원고 발송', 'stale 감지 시 발송 강행'],
    targetSeams: ['approveAndSendReply', 'validateApprovedReply'],
    verificationLevel: 'NOT_VERIFIED',
    narrowContractScope: '문안 수정, 제안 필드 불일치, 만료 DTO, stale 재조회 시 VERSION_CONFLICT 반환 확인',
    limitations: '실제 DB CAS 트랜잭션 검증 부재',
  },
  {
    id: 'D093-08',
    title: '슬롯 충돌 · 동시 확정 거절 (RPC 어댑터 계약 vs 실제 동시 DB 경합)',
    given: '이미 다른 고객에게 예약된 슬롯 또는 동일 슬롯에 대한 동시 예약 확정 시도',
    when: '예약 확정(confirmRecoveryBooking) 요청 실행',
    then: '어댑터는 VERSION_CONFLICT를 반환하여 안전하게 거절. 단 실제 2건 동시 트랜잭션 경합 1건 승자 배타성은 격리 DB 미실행으로 NOT_VERIFIED',
    forbiddenActions: ['충돌 슬롯 이중 예약 허용', '프로세스 메모리 락으로 DB 원자성 대체'],
    targetSeams: ['confirmRecoveryBooking'],
    verificationLevel: 'NOT_VERIFIED',
    narrowContractScope: 'confirmRecoveryBooking 어댑터의 VERSION_CONFLICT 반환 계약 확인',
    limitations: '어댑터 에러 계약은 확인되었으나 실제 2건 동시 트랜잭션 경합 1건 승자 배타성은 격리 PostgreSQL 실행 증거가 없어 NOT_VERIFIED 유지',
  },
  {
    id: 'D093-09',
    title: '중복 PG 결제 Webhook',
    given: '동일 PG 결제 이벤트 웹훅 재수신',
    when: '결제 웹훅 핸들러 실행',
    then: '수납 중복 및 중복 크레딧 배정 방지',
    forbiddenActions: ['중복 결제 승인', '인메모리 Set을 영속 DB 원장으로 주장'],
    targetSeams: ['PgPaymentWebhookHandler'],
    verificationLevel: 'NOT_VERIFIED',
    limitations: '본 drill 테스트 하네스에 검증된 영속 PG 원장 및 DB 결속 멱등키가 연결되지 않음 (본 drill scope 밖 / 미검증)',
  },
  {
    id: 'D093-10',
    title: '늦은/부분 환불 · 응답 불명',
    given: 'PG 환불 요청 후 응답 불명 또는 지연/부분 환불 발생',
    when: '환불 대사 또는 상태 확인 실행',
    then: '이미 환불되었다고 추정하지 않고 원장/영수증 대사, 자동 중복 환불 0건',
    forbiddenActions: ['추정 환불 완료 처리', '자동 중복 환불 실행'],
    targetSeams: ['payment-refund-ledger'],
    verificationLevel: 'NOT_VERIFIED',
    limitations: '본 drill 테스트 하네스에 검증된 영속 환불 계약 및 PG 영수증 원장 파이프라인이 연결되지 않음 (본 drill scope 밖 / 미검증)',
  },
  {
    id: 'D093-11',
    title: 'Readback 불일치 (다른 Workspace/수신자/본문/시각)',
    given: '프로바이더 전송 성공 후 독립 readback에서 메시지 ID 불일치, 수신자 상이, 본문 불일치, 시각 역전/미래, 또는 isLive=false 응답',
    when: '전송 직후 readback 또는 대사 워커(reconcileOutboxItem) 실행',
    then: '검증 승격(SEND_VERIFIED) 0건, RESULT_UNKNOWN 유지, 오류를 isLive=true로 덮지 않음',
    forbiddenActions: ['불일치 readback을 성공으로 승격', '조회 실패를 성공으로 간주'],
    targetSeams: ['approveAndSendReply', 'reconcileOutboxItem', 'getInstagramDirectMessageReadback'],
    verificationLevel: 'NOT_VERIFIED',
    narrowContractScope: 'readback 불일치(text, recipient, sender, msgId, observedAt, isLive:false, exception) 시 RESULT_UNKNOWN 강등 및 승격 차단 확인',
    limitations: '실제 채널 API 연동 및 네트워크 회선 지연 미검증으로 NOT_VERIFIED 유지',
  },
  {
    id: 'D093-12',
    title: '대사 예산 소진 · 상태 저장 실패',
    given: '대사 재시도 최대 횟수(3회) 초과 또는 대사 중 상태 영속화 실패',
    when: 'reconcileOutboxItem 실행',
    then: '유효 근거 존재 시 HUMAN_REVIEW(RECONCILE_EXHAUSTED)로 강등되어 사장님 확인으로 이관, outbox 상태 UNKNOWN 유지, 근거 부재 시 RECONCILE_MANUAL_EVIDENCE_REQUIRED 예외 throw',
    forbiddenActions: ['예산 소진 후 무한 자동 재시도', '완료(FINISHED)로 잘못 표시', '근거 없는 임의 전이'],
    targetSeams: ['reconcileOutboxItem'],
    verificationLevel: 'NOT_VERIFIED',
    narrowContractScope: '3회 시도 초과 시 status: MOVED_TO_HUMAN_REVIEW 반환 및 RECONCILE_MANUAL_EVIDENCE_REQUIRED throw 확인',
    limitations: '실제 DB 실행 증거 부재로 NOT_VERIFIED 유지',
  },
] as const;

export function getDrillScenario(id: string): DrillScenario | undefined {
  return DRILL_CATALOG.find((s) => s.id === id);
}
