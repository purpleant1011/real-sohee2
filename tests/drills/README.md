# V0.93 예외 복구 훈련 v2 (ANI-1640 / ANI-1641)

기준: `origin/integration/v093` @ `8e03b7b9`  
설계: `docs/security/v093-drill-v2-design.md` (W4 v2 승인·대사 계약 반영)  
구현·실행: Gemini 3.8 Flash (High 추론)

## 1. 개요 및 v2 계약 갱신

본 테스트 스위트는 W4 v2 승인·대사 계약에 맞추어 `tests/drills` 하네스를 전면 갱신한 훈련 결과다.
과거 v1 반환 계약(승인 DTO 없이 실행하던 레거시 가정)에서 발생하던 9건의 `CONTEXT_REQUIRED` 실패를 해소하고, 엄격한 v2 계약을 강제한다:

1. **진짜 유효한 v2 ApprovedReplyDto 사용**:
   `schemaVersion: 2`, 비어있지 않은 `facts`, 유효한 `offer`, `validUntil`, `approvedReplyFingerprint`로 계산된 SHA-256 지문을 갖춘 DTO를 필수 검증.
2. **이중 검증 (SEND_REQUESTED 후 재조회)**:
   `SEND_REQUESTED` 영속화 직후 `loadApprovedReply`를 재호출하여 최신 상태와 지문이 어긋나면 즉시 `HUMAN_REVIEW`(`stepKind: STALE_BEFORE_SEND`)로 격리 전이 후 `VERSION_CONFLICT` 반환 (send 0회).
3. **독립 Readback 엄격 대조**:
   `isLive: true`뿐만 아니라 `messageId`, `text`, `recipientRef`, `senderId`, `requestedAt <= observedAt <= now`를 전수 재대조하여 하나라도 불일치하면 `SEND_VERIFIED` 승격을 영구 거절하고 `RESULT_UNKNOWN` 유지.
4. **대사 경계 회귀 (AttemptedSendEvidence 결속)**:
   `reconcileOutboxItem`은 유효한 `AttemptedSendEvidence`(`reply`, `senderId`, `requestedAt`, 검증된 `actor`)가 존재하고 `source_event_key`가 일치할 때만 `readbackFetcher`를 호출. 전이 actor는 zero UUID가 아닌 실제 인증 actor(`attempted.actor`)를 사용. 예산(3회) 소진 시 근거가 없으면 `RECONCILE_MANUAL_EVIDENCE_REQUIRED`를 throw.
5. **모든 실패 경로에 양성 대조(Positive Control) 짝 구성**:
   정상 입력 시 실제로 `SEND_VERIFIED` 및 `AWAITING_CUSTOMER`로 정상 전이됨을 입증하여 약한 계약/항상 실패로 인한 거짓 통과 차단.

## 2. 시나리오별 판정 (D093-01 ~ D093-12)

| ID | 전역 판정 | 관측한 엄격 v2 계약 | 양성 대조 | 남은 검증 / 한계 |
|---|---|---|---|---|
| D093-01 | NOT_VERIFIED | 401/403→RESULT_UNKNOWN, scope누락→POLICY_BLOCKED, DTO미주입→CONTEXT_REQUIRED, 자동 재호출 0회 | 정상 자격증명/DTO 시 AWAITING_CUSTOMER 완료, send 1, readback 1 | PII logger spy 미검증, 실제 Meta Graph API 미연결 |
| D093-02 | NOT_VERIFIED | 429→RESULT_UNKNOWN 강등, outbox 적재(UNKNOWN), 무단 즉시 재전송 0 | 정상 응답 시 성공 | 실제 프로바이더 Retry-After 헤더 대사 미검증 |
| D093-03 | NOT_VERIFIED | 500/502/503/504→RESULT_UNKNOWN, 오류를 EMPTY/성공으로 마스킹 안 함 | 정상 응답 시 성공 | 실제 네트워크 게이트웨이 타임아웃 미검증 |
| D093-04 | NOT_VERIFIED | 1단계 타임아웃(send 1, sideEffect 1, outbox 적재) → 2단계 outbox 대사로 send 추가 0회, AttemptedSendEvidence actor로 RESOLVED_VERIFIED 승격, outbox FINISHED | 양성 2단계 완주 | 실제 분산 네트워크 타임아웃 미검증 |
| D093-05 | NOT_VERIFIED | send+readback 성공 후 finishStep 실패 시 성공 은폐 차단, RESULT_UNKNOWN 반환, 재전송 0 | 정상 DB commit 시 성공 | 실제 PostgreSQL 트랜잭션 롤백 미검증 |
| D093-06 | NOT_VERIFIED | lease 선점 충돌 시 VERSION_CONFLICT(send 0), 동일 웹훅 중복 수신 시 duplicate 반환 | 단계 미선점 시 send 성공 | mock repo 기반, 실제 DB 레벨 분산 락 및 PostgreSQL lease 경합 미검증 |
| D093-07 | NOT_VERIFIED | (a) 새 고객 메시지 (b) draft 수정 (c) 지문 불일치 (d) proposal 필드 불일치 (e) 만료 DTO (f) SEND_REQUESTED 후 재조회 불일치 시 모두 send 0, VERSION_CONFLICT 반환 | 정상 승인/제안 시 성공 | 실제 DB CAS 트랜잭션 미검증 |
| D093-08 | NOT_VERIFIED | booking confirm 충돌 시 adapter VERSION_CONFLICT 반환 확인 | - | 실제 2건 동시 트랜잭션 경합 격리 DB 미실행으로 NOT_VERIFIED |
| D093-09 | NOT_VERIFIED | 하네스 연결 대상 아님 | - | 영속 PG 원장 및 멱등키 미검증 |
| D093-10 | NOT_VERIFIED | 하네스 연결 대상 아님 | - | 환불 파이프라인 미검증 |
| D093-11 | NOT_VERIFIED | isLive:false, messageId/recipient/text/sender 불일치, 과거·미래 observedAt, 예외 발생 시 SEND_VERIFIED 전이 0회, RESULT_UNKNOWN 유지 | 모든 필드 일치 시 SEND_VERIFIED 전이 | 실제 Meta API 회선 지연 미검증 |
| D093-12 | NOT_VERIFIED | 3회 예산 소진 시 유효 근거 존재하면 HUMAN_REVIEW(RECONCILE_EXHAUSTED) 전이 및 attempted.actor 감사 기록, 근거 부재 시 RECONCILE_MANUAL_EVIDENCE_REQUIRED throw | 3회 미만 시 RETRY_SCHEDULED | 실제 DB 상태 저장 미검증 |

*참고: 기본 `verificationLevel`은 불변식 8에 따라 모두 `NOT_VERIFIED`를 유지한다.*

## 3. 실행 증거

### Vitest 단위 및 경계 테스트 (50 tests, ALL PASS)

1. `tests/drills/fake-provider.test.ts`: **5 PASS (exit 0)**
   - recipient/text/sender 불일치, 필수 인자 누락, sourceEventKey prefix 불일치 거부 및 양성 대조 확인.
2. `tests/drills/baseline-reconcile-gap.test.ts`: **9 PASS (exit 0)**
   - 유효 attemptedSend 상태에서 악의적 `verified: true` + 필드 불일치(recipient/text/sender/msgId/과거·미래 observedAt) 시 readbackFetcher는 호출되나 RESOLVED_VERIFIED 승격 거부.
   - 근거 부재 시 readbackFetcher 호출 차단.
   - 양성 대조 시 attempted.actor 및 payload fingerprint 전이 확인.
3. `tests/drills/provider-recovery.test.ts`: **36 PASS (exit 0)**
   - D01~D07, D08, D11, D12 및 시나리오별 양성 대조 전수 통과.

### v1 Baseline 기록 보존 (W3 6bbd9648 기준)

과거 v1 하네스에서 관측되었던 RED 원문:
- `tests/drills/provider-recovery.test.ts`: 9 failed / 1 passed (D01~D07, D11: `expected 'CONTEXT_REQUIRED' to be 'RESULT_UNKNOWN' / 'VERSION_CONFLICT'`, D12: `RECONCILE_CONTEXT_MISMATCH`).
- `tests/drills/baseline-reconcile-gap.test.ts`: 1 failed (exit 1).
이 결함 기록은 `tests/drills/evidence/execution-evidence.txt`에 v1 baseline으로 분리 보존되어 있다.

## 4. 정적 품질 게이트

- 전체 TypeScript 타입체크 (`heavy.sh node --max-old-space-size=3072 node_modules/typescript/bin/tsc --noEmit`): 직렬 락 실행
- 신규 타깃 린트 (`heavy.sh npx --no-install eslint tests/drills`): 직렬 락 실행
