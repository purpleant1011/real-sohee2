# V0.93 Golden Task · ANI-1632

정본: Drive 문서 12 §2. 기획 12개 전체를 manifest.json에 버전 관리한다. 각 항목에 Given/When/Then, 필수 outcome 체크, 실패 시나리오, 허용 tool 목록, 금지 행동, provider 계약 조건을 정의했다. 모델/프롬프트/도구/커밋/rubric 변경은 기존 trace를 무효화한다.

## 의미와 임계값

- `CONTRACT_PASS`: **오프라인 rubric 계약만 통과**. 실제 게시·예약·수납·브라우저 업무 완료가 아니다.
- `FAIL`: 관측된 실패 또는 금지 trajectory. 평균점수로 상쇄하지 않는다. P0 허용 건수 **0**.
- `NOT_VERIFIED`: trace·outcome·버전·계약 증거 미확보. pending/skip/PASS로 치환하지 않는다.
- `NOT_VERIFIED_APPROVED`: **증거가 아니라 사람의 승인**이다. `live` 요구가 있는 check에 한해, 이름이 있는 승인자가 사유·추적 이슈·파일럿 계획·만료일을 남긴 경우에만 붙는다. `CONTRACT_PASS`로 승격되지 않고, `FAIL`을 덮지 못하며, 테스트 미실행·파일 누락에는 붙을 수 없다. 승인 파일은 `tests/golden/approvals.json` 한 곳에서만 읽는다(`approvals.ts` 스키마 검증).
- 필수 task **12/12**, 필수 체크 **ALL**, critical violations **0**. 태스크별 독립 DB/provider/browser 증거 없이는 출시 판정이 없다.

`engine.ts`는 테스트 전용 offline rubric이다. service_role이나 외부 실행 API를 제공하지 않는다. 입력 trace의 authorization/outcome 태그는 신뢰된 테스트 recorder가 관측한 계약 입력이며, 이 태그나 evidenceRef 문자열 자체가 실제 영수증 검증은 아니다. 따라서 fixture가 전부 통과하거나 LIVE_ALLOWLIST라는 문자열을 넣어도 이 모듈은 **RELEASE_READY를 반환하지 않는다**. summarize는 승인 입력도 live 증거도 받지 않으므로 항상 NO_GO이며 `verdictBasis: 'TRACE_RUBRIC_EXCLUDED_FROM_RELEASE'`로 그 이유를 밝힌다. 독립 검증기·승인 절차를 붙이기 전에는 코드/PR 통과를 운영 green으로 승격할 수 없다.

### 릴리스 판정 규칙 (ANI-1655)

`releaseVerdict`는 `coverage.ts computeReleaseVerdict`가 계산한다.

- `GO`: FAIL 0 **그리고** 모든 check가 `CONTRACT_PASS` 또는 `NOT_VERIFIED_APPROVED`.
- `NO_GO`: 그 외 전부. 특히 **FAIL 1건**이면 승인이 몇 건이든 `NO_GO`, 승인 파일에 형식 오류가 1건이라도 있으면 파일 전체가 무효(`approvalsApplied: 0`)이고 `NO_GO`.
- 승인 파일이 없으면 `NOT_VERIFIED`는 그대로 `NOT_VERIFIED`다. 승인 없이 승격되는 경로는 존재하지 않는다.
- **exit code는 여전히 1 또는 2뿐이다.** GO여도 0을 내지 않는다 — 파이프라인이 승인 파일 존재만으로 자동 green이 되지 않게 하기 위해서다. CI는 `releaseVerdict`를 읽어야 한다.

## Eval ID와 BDD

각 manifest task에 대해 ID를 다음처럼 생성한다.

- `G093-XX:success:v093-golden-1`
- `G093-XX:failure:v093-golden-1`
- `G093-XX:trajectory:v093-golden-1`

manifest.json의 `checks`가 최종 outcome 계약, `failureScenarios`가 반례 데이터 세트다. 허용 tool 외 호출·cross workspace read/write·무권한 호출·잘못된 승인 지문/수신자·중복 side effect·UNKNOWN 이후 추가 쓰기는 FAIL이다. 보고서에는 원시 trace/payload/고객 정보/키를 출력하지 않고 task ID·고정 이유 코드만 남긴다.

## 실행

평가기 단위 계약 + 현재 브랜치의 실제 승인 함수 import 회귀:

```bash
npm test -- tests/golden/engine.test.ts tests/golden/domain-probes.test.ts
```

실업무 증거 상태 보고(외부 호출 없음, Node 22 strip-types 사용):

```bash
node --experimental-strip-types tests/golden/run.mjs
```

현재 결과는 **12개 NOT_VERIFIED / NO_GO / exit2**가 정상적인 정직한 보고다. 0은 미검증을 통과로 취급하는 exit code가 아니다. 단위 테스트 green과 이 readiness command의 exit2를 분리해서 기록한다. CI에 연결할 때 exit2를 `|| true`로 숨기거나 skip으로 바꾸지 않는다. 실제 실패가 관측되면 1, 미검증이면 2로 판정한다.

전체 typecheck/lint/build/npm test는 `heavy.sh` 전역 직렬 락을 사용한다. 위 소수 파일 단위 Vitest는 별도 락이 필요 없다.

## TDD·실행 증거

- 평가 함수 stub(명시 NOT_IMPLEMENTED)에서 **66개 행동 테스트 RED** 관찰.
- 최소 구현 후 **66개 rubric + 19개 실제 승인 tuple mutation = 85/85 PASS**.
- domain-probes는 G093-06 source message/가격 catalog/recipient 변경과 G093-07 예약 workspace/슬롯/금액/수락/버전 결속만 검증한다. 이 결과로 DM 전달·DB 동시성·실계정 Golden 성공을 주장하지 않는다.
- 추가 교차 검토에서 `acceptance-boundary.test.ts` **1개 실제 RED**를 발견·유지한다: 단일14시 제안에 '15시로 예약할게요'가 accepted로 처리됨. W4 PR1722 source에도 같은 분기, 소유자에 교정 요청. 위 85개 PASS는 **선택한 두 파일의 rubric/hash 계약**이지 전체 Golden green이 아니다.
- `npm test -- tests/golden`은 위 실제 수락 반례도 포함한다. skip/todo·기대 실패로 숨기지 않는다. W4 교정의 승인된 통합 전에는 이 테스트가 FAIL이다.
- readiness.json은 별도로 실행한 **독립 trace 미제공** 기준선이다. 이 CLI의 NOT_VERIFIED와 별개로 관측된 수락 반례 FAIL도 출시 차단이다. provider credentials·실고객 데이터 없음.
- 후속 추가분 typecheck/lint를 `heavy.sh` 전역 직렬 락으로 실제 실행해 **typecheck=0 / lint=0** 확인. TypeScript 진단0건, lint0 errors/1409 warnings. 이 게이트 통과는 위 수락 반례 FAIL을 해소하지 않는다.
- 기존 tenant SQL3 및 Vault7 증거는 tests/tenant-isolation/EVIDENCE.md에서 별도로 추적한다. 반복하여 이번 Golden 12종 완료 수로 계산하지 않는다.

## 통합 경계

다른 창 소유 코드는 import만 한다. W9/W4/W5 변경이 타 브랜치에 있다는 보고만으로 여기 Golden 결과를 바꾸지 않는다. 승인된 통합 후 해당 SHA에서 원본 CRM 반례·슬롯 경쟁 DB·동의 철회 race·외부 readback·모바일/데스크톱을 다시 실행해야 한다.

G093-09/10의 계약 미확보는 optional 업무의 가동 범위를 제한할 뿐, 해당 Golden을 성공/skip으로 세는 근거가 아니다. 예약금 없는 예약·수동 안내를 제공하려면 그 분기의 별도 실제 증거를 남긴다.

## 커버리지 맵과 체크별 판정 (ANI-1632 보강)

`coverage.json`은 manifest의 모든 check를 (a) 결정적 오프라인 `contractTests`와 (b) 실DB·브라우저·provider·계약이 있어야만 확정되는 `live` 요구로 나눈다. `coverage.ts`가 체크별 → 태스크별로 판정한다.

- 연결된 테스트가 실패/누락 → 해당 check `FAIL` (태스크 FAIL이 우선, 평균으로 상쇄 안 됨).
- `live` 요구가 있으면 계약 테스트가 전부 green이어도 `NOT_VERIFIED` (사유 `LIVE_REQUIRED:<종류>`).
- 계약 테스트도 live 요구도 없으면 `NOT_VERIFIED`. 테스트를 안 돌렸으면 `NOT_VERIFIED`(`CONTRACT_TESTS_NOT_RUN`).
- `CONTRACT_PASS`는 live 요구 없는 순수 규칙 check가 전부 green일 때만. exit code는 실패 1 / 그 외 2 (0 없음). 릴리스 판정 규칙은 위 §릴리스 판정 규칙 참고.

```bash
node --experimental-strip-types tests/golden/run.mjs              # 테스트 미실행: 전부 NOT_VERIFIED, exit 2
node --experimental-strip-types tests/golden/run.mjs --run-tests  # 연결된 결정적 테스트 실행 후 체크별 판정
npm test -- tests/golden/coverage.test.ts                         # 맵 완전성·판정 규칙·승인 검증 (CI 포함, 결정적)
```

CI(`npm test`)에는 `tests/golden/*.test.ts`만 포함된다. `--run-tests`는 연결된 47개 기존 테스트 파일을 다시 실행하는 증거 수집용 명령이며 워크플로를 수정하지 않았다.
Doc 12 §4의 모바일 360/375px·네트워크 단절/PWA 재개는 `coverage.json`의 `commonScenarios`에 `NOT_VERIFIED`로 기록하고 오프라인 테스트로 대체하지 않는다.
