# V0.93 모바일·PC E2E 계획 및 Ego 브라우저 골격 (ANI-1635)

- **버전**: `v093-e2e-plan-1`
- **상태**: 골격 및 순수 계약 검증 완료 (`tests/e2e-v093/**`), 실제 브라우저 E2E는 **NOT_VERIFIED**
- **대상 브랜치**: `claude/v093-w3-tenant-security-6f814f`
- **실측 Git Provenance**:
  - `observedHeadSha`: `742ee9accb784afb48368ae3c2b919a45f0f5b7d`
  - `isWorkingTreeDirty`: true (`UNATTESTED_WORKTREE`)
- **작업 범위**: `tests/e2e-v093/**` 및 `.claude/w3-e2e-*` 신규 골격만 (src/SQL/package/기존 설정 수정 0)

---

## 1. 아키텍처 및 핵심 불변식

1. **12단계 고객 여정 매니페스트 (`manifest.ts`)**:
   - `E093-01` ~ `E093-12`: 홈 진입부터 사진 권리, 사실 확인, 원고 수정, 정확 승인, 게시 분기, 문의 답변, 고객 수락, 원자적 예약, 성과 보고(Same Truth 5-View), 새로고침 복원, 교차 테넌트 격리까지 정의.
   - 뷰포트: Mobile (`375×812`) 및 PC (`1440×900`).
   - **Anti-Optimism 집계 불변식**:
     - 24개 관측 슬롯(12단계 × 2개 뷰포트)은 관측 단위일 뿐 실업무 검증 성공 수가 아님.
     - `countContractCompletedSteps`: Canonical 12단계 whitelist, 정확한 Mobile 1개 + PC 1개 슬롯, 둘 다 PASS, 필수 evidenceRef 존재, 유효한 ISO timestamp 존재 시에만 계약 완료로 집계 (중복, 결측, unknown step 차단).
     - `countVerifiedBusinessTasks`: 실 E2E가 연동되지 않은 골격/단위 테스트 단계에서는 허위 승격을 방지하기 위해 엄격히 **0**을 반환.

2. **사전 검증 보안 가드 (`preflight.ts`)**:
   - 정확한 loopback origin(`http://localhost:*`, `http://127.0.0.1:*`, `http://[::1]:*`)만 허용.
   - URL 내 자격증명(`user:pass@`), 외부 도메인, 유사 호스트네임(`*.attacker.com`, `*.nip.io`) 차단.
   - `ACTUAL`, `SHOWCASE_DEMO`, `UNKNOWN` 데이터셋 모드는 fail-closed 차단.
   - **독립 Attestor 경계**: 클라이언트의 임의 해시나 boolean만으로 검증 완료 처리하지 않음. 신뢰된 서버 Attestor가 현재 unbound이므로 `ENV_ATTESTATION_UNBOUND`로 차단 (`allowed: false`).
   - **Privacy 보장**: URL 구문 오류나 데이터셋 차단 시 원본 URL, 에러 메시지, 토큰을 reason에 누출하지 않고 고정 constant code만 반환.

3. **상태 대조 및 크로스 디바이스 Parity 계약 (`state-contract.ts`)**:
   - `stepId` 필수 지정 (미지정 시 `NOT_VERIFIED`).
   - 동일 제어 액션의 canonical epoch 일치가 선행된 후에만 단계별 필수 필드를 대조 (상이한 epoch는 `NOT_VERIFIED`).
   - **에러 및 NULL 일치 금지**: 두 화면이 모두 `ERROR`이거나 필수 참조가 모두 `NULL`인 것을 parity PASS로 취급하지 않음 (`FAIL`).
   - **amountProvenance 검증**: empty object `{}`, non-finite/negative 금액, 미지원 통화·미관측/오류/알 수 없는 상태는 `FAIL`. 이 테스트 계약은 KRW와 `PENDING_SETTLEMENT`/`SETTLED`만 허용하며 관측 0원을 구분한다. 이 태그는 fixture 계약 값이지 실제 수납/정산 receipt 검증이 아니다.
   - **순서 및 타입 보존**: `imageReferences`는 승인 순서가 load-bearing이므로 정렬(sort)을 금지하고 원본 배열 순서 및 string 타입을 엄격히 비교.
   - **타임스탬프 및 식별자**: timezone이 없는 timestamp, 공백 source, 공백 workspaceAlias는 즉시 `FAIL`.
   - **명시적 미생성**: E01과 같은 단계의 workref 미생성은 `creationState: "NOT_CREATED"`가 명시된 경우에만 합법적으로 허용하며, unconfirmed undefined 2개 일치는 `FAIL`.
   - **Privacy 보장**: diffs 및 reason에 raw payload 값, 해시, 비밀번호, 에러 원문을 노출하지 않고 `DIFF_FIELD: <field>` 고정 코드만 출력.
   - **교차 사업장 격리**: `A !== B`인 유효 관측 하에서 403 또는 404 거부만 허용하며, 동일 테넌트 pair, 200 빈 목록(침묵 은폐), 데이터 누출은 거부/FAIL.

4. **공식 Ego 브라우저 규약 준수 (`ego-adapter.ts`)**:
   - 설치 CLI 공식 가이드 v2.1.0의 규약을 기준으로 준비했다(`evidence/ego-guide-receipt.md`, 전문은 로컬 보존). 실제 SDK 실행은 아직 미검증:
     - 1 goal 당 1 TaskSpace 생성 및 `task.spaceId` 재사용 (`const task = await taskSpace(...)`).
     - 기본 탭(`task.page("p1")`)과 신규 탭(`task.newPage()`) 구분.
     - 여정 성공 시 단 1회 `await task.finish({ keep: [] })`.
     - 사용자의 직접 동작이 필요하면 공식 `task.handOff()` 규약을 따르고 턴을 종료한다. 이미 사용자 제어권 전환/권한 확인이 감지되면 이후 action/정리를 임의 실행하지 않고 중단한다. 현재 골격은 이 lifecycle을 실제 실행하지 않았다.
   - **Factory Thunk 패턴**: 드라이버 생성자를 지연 호출 함수로 감싸서, PLAN_ONLY 골격 인스턴스화 시 실제 브라우저 프로세스나 SDK side effect가 실행되지 않도록 원천 차단.
   - 셀렉터, fixture loader, reader 미바인딩 시 `UNBOUND -> NOT_VERIFIED` 반환.

5. **실행 러너 및 라이브 승인 게이트 (`runner-skeleton.ts`)**:
   - 기본 모드: `PLAN_ONLY`. 브라우저/HTTP/DB 호출 0건, duration: null, screenshot: null, 24개 관측 슬롯 전원 `NOT_VERIFIED`.
   - 어댑터 인스턴스가 주어져도 PLAN_ONLY에서는 어떠한 어댑터 메서드(`isReady()`, `executeStep()`)도 호출하지 않음 (0 호출).
   - `testedSha`는 하드코딩되지 않고 실제 git provenance가 제공될 때만 기록되며, 미제공 시 `NOT_OBSERVED`.
   - `LIVE_ALLOWLIST` 시도 시 단순 JSON 플래그(`userApproved: true`)로는 우회 불가하며 필수 승인 이슈(`ANI-1598`, `ANI-1604`, `ANI-1613`) 누락 시 차단.

---

## 2. 검증 실행 방법 및 결과

### 1) 단위 테스트 스위트 (19개 전원 통과)
프로젝트에 이미 설치된 도구만 사용 (`--no-install` 준수):
```bash
npx --no-install vitest run tests/e2e-v093/e2e-v093.test.ts
```
- 결과: `19 passed (19)` (Exit code: 0)

### 2) Standalone PLAN_ONLY Dry-Run (재현 실행)
외부 패키지나 tsx 없이 순수 Node.js로 실행:
```bash
node tests/e2e-v093/run-plan-only.mjs
```
- 결과: `tests/e2e-v093/evidence/execution-summary.json` 생성.
- **종료 코드**: `Exit code: 2` (E2E 미실행 및 준비도 미검증 상태를 명시적으로 나타내며 허위 승격 exit 0 방지).
- actionsAttempted: 0
- notVerifiedSlotsCount: 24 (24/24)
- verifiedBusinessTasksCount: 0

### 3) TypeScript & ESLint 정적 분석
전역 직렬 락(`heavy.sh`) 경유 실행 (Heap 3GB direct):
```bash
"/Volumes/Development/소희 프로젝트/docs/v093-orchestration/heavy.sh" node --max-old-space-size=3072 node_modules/typescript/bin/tsc --noEmit
```

- TypeScript: 최신 코드 2차 직렬 실행 **Exit 0 완료**. 표준 heap6GB npm wrapper가 아니라 **heap3GB 직접 호출**이다.

```bash
"/Volumes/Development/소희 프로젝트/docs/v093-orchestration/heavy.sh" npx --no-install eslint tests/e2e-v093
```

- 타깃 ESLint: 직렬 실행 **Exit 0 완료**, 오류0/경고0. 전체 repository 경고0으로 확대하지 않는다.
- Gemini가 실행하고 Sol이 완료된 raw job 종료코드를 읽어 검토했다. 타입/lint 통과는 실제 브라우저·서버·provider 통합 PASS가 아니다.

---

## 3. 미검증 범위 (NOT_VERIFIED) 및 운영 경계

1. **실제 브라우저 E2E 미실행**: 본 작업은 통합 후 실행을 위한 계획 및 골격 준비 작업이며, 실제 Chromium 프로세스 실행, 탭 조작, 스크린샷 캡처는 수행하지 않음.
2. **실제 서버 및 DB 호출 0건**: Supabase 운영 DB 조회/수정 0건, Cloudflare Workers 배포 0건.
3. **외부 프로바이더 API 쓰기 0건**: Instagram Graph API, Meta DM, PG 결제, 카카오 알림톡 등 외부 API 호출 0건.
4. **비밀값 및 개인정보 0건**: 토큰, 세션 쿠키, 서명된 URL, 실고객 원문 데이터 포함 0건.
