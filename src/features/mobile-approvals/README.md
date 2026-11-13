# 모바일 승인 실행 코어 — ANI-1704 (W6 1차)

상태: **단위 테스트된 코어 계약**. 서버/API/UI 통합이나 외부 실행 완료가 아니다.
설계: `docs/mobile-r2/w6-comms-booking-approval-design.md`.

## 구현
- `gate.ts`: ACTUAL 전용, 권한·킬스위치·연결·정책·비용·동의·최신성의 fail-closed 평가와 사용자용 한국어 사유.
- `execute.ts`: 버전·승인 지문 검증 → 게이트 → 원자적 claim 포트 → provider → 독립 readback → 상태 저장.
- `fingerprint.ts`: 승인 종류별 지문 계산을 기존 정본 함수 하나로 위임하는 단일 디스패처. 새 해시·정규화 규칙을 만들지 않으며, 정본 지문이 없는 종류(`proposal` 등)는 실행 불가로 거절한다.
- `ports.ts`: 실행에 필요한 원장·provider 포트 계약. 실제 구현은 아직 없고 기본 동작은 fail-closed다.
- `testing/test-only-mock-provider.ts`: 테스트 전용 모의 provider. 프로덕션 경로에서 import하지 못하도록 ESLint로 격리했다.
- 접수와 검증을 구분한다. 타임아웃/불명은 RESULT_UNKNOWN, 동일 멱등키 재호출은 재발송하지 않는다.
- 테스트의 Map은 모의 원장일 뿐이며 프로덕션 정본으로 사용하지 않는다.

## 연결 전 필수 계약
- 포트는 인증된 workspace/actor에 서버에서 바인딩한다. 원시 HTTP body를 이 함수에 직접 넘기지 않는다. 런타임 strict 스키마·UUID/종류 검증·인가·no-store는 API 어댑터 책임이다.
- findByKey는 workspace + item + version + fingerprint까지 검증해야 한다. 다른 요청이 같은 멱등키를 쓰면 기존 결과를 노출하지 않고 충돌로 거절한다.
- claim은 영속 DB 트랜잭션 안에서 최신 버전·지문·게이트를 재평가하고, **서로 다른 멱등키여도 같은 항목은 한 번만** 예약해야 한다. 멱등키 UNIQUE만으로 충분하지 않다.
- send는 승인된 불변 스냅샷을 사용해야 한다. claim 이후 수정된 문안을 key로 다시 읽어서 전송하면 안 된다.
- readback은 해당 실행의 provider 식별자/수신자/내용에 바인딩된 독립 조회여야 한다. 기존 메시지가 존재한다는 사실만으로 verified를 반환하면 안 된다.
- record 실패 시 claim의 REQUESTED를 남겨 자동 재발송을 막고 원장 조정으로 회복한다. DB 실패를 성공으로 표시하지 않는다.
- provider accepted + readback not_found는 PROVIDER_ACCEPTED(확인 대기)이며 VERIFIED가 아니다.

## 아직 구현하지 않은 범위
영속 원장 어댑터 및 DB 교차·경합 테스트, 포트의 실 구현(원장 claim/store, provider send/readback), BFF/API 어댑터, 소통함·예약 읽기 모델, 모바일 UI 및 접근성/E2E, 실제 provider 연결·배포·production readback.
따라서 이 코어의 테스트 통과는 실제 중복 발송 방지나 테넌트 격리를 통합 검증했다는 의미가 아니다.

## v2 호환 계약
`contracts.ts`의 v2 검토 DTO/요청 스키마와 R1 호환 export·어댑터는 별도 계약이다. 기존 R1은 실행 불가를 유지한다. API 요약과 단일 CTA 상태 매트릭스: `docs/mobile-r2/w6-approval-api-and-cta-contract.md`.

## 로컬 검증 명령
`npx vitest run src/features/mobile-approvals src/features/mobile-decision/selectors.test.ts`
`npx eslint src/features/mobile-approvals`
`npm run typecheck`
