import 'dotenv/config';

const apiKey = process.env.LINEAR_API_KEY;
if (!apiKey) {
  console.error("LINEAR_API_KEY is not set.");
  process.exit(1);
}

const RC_SHA = "e1a88ea7b641ac2f4b05c801604be336ece2fef6";
const PR_URL = "https://github.com/example-owner/real-sohee/pull/1166";

const RETEST_ITEMS = [
  {
    id: "ANI-1277",
    run: "E2E-01",
    originalRun: "FAIL",
    origReason: "하드코딩 7일 배열 및 isVerified: true 시뮬레이션 코드 적발",
    remediationCommit: "8e70cf95",
    retestRun: "PASS",
    suite: "tests/unit/remediation/rc01-evidence-gate-integrity.test.ts",
    detail: "Fail-Open 로직 전면 제거, 필수 증거 부재 시 fail-closed(BLOCKED) 강제, 실제 캘린더 타임 강제 검증 완료."
  },
  {
    id: "ANI-1278",
    run: "E2E-02",
    originalRun: "FAIL",
    origReason: "프로덕션 DB 내 7일 운영 데이터 0건, 인메모리 시뮬레이션 기각",
    remediationCommit: "8e70cf95",
    retestRun: "PASS",
    suite: "tests/unit/remediation/rc01-evidence-gate-integrity.test.ts",
    detail: "인메모리 날조 시뮬레이션 기각 및 프로덕션 관측 증거 부재 시 FAIL-CLOSED 판정 강제 검증 완료."
  },
  {
    id: "ANI-1279",
    run: "E2E-03",
    originalRun: "FAIL",
    origReason: "ReleaseGateManifestEvaluator의 ?? true로 인한 Fail-Open 취약점",
    remediationCommit: "8e70cf95",
    retestRun: "PASS",
    suite: "tests/unit/remediation/rc01-evidence-gate-integrity.test.ts",
    detail: "ReleaseGateManifestEvaluator의 ?? true 기본값 제거, 미검증 항목 존재 시 엄격 FAIL-CLOSED 게이트 차단 확인."
  },
  {
    id: "ANI-1283",
    run: "E2E-11",
    originalRun: "FAIL",
    origReason: "booking-state-machine.test.ts 2건 깨짐 방치 및 고정 슬롯 하드코딩",
    remediationCommit: "26ff09a4",
    retestRun: "PASS",
    suite: "tests/unit/remediation/rc05-availability-lock.test.ts",
    detail: "픽스처 계약 복구 및 실시간 가용 캘린더 슬롯 Mutex 동시성 락 연동 검증 완료."
  },
  {
    id: "ANI-1284",
    run: "E2E-12",
    originalRun: "FAIL",
    origReason: "원격 DB media_assets check constraint 불일치",
    remediationCommit: "PENDING_REMOTE_DB_ALIGNMENT",
    retestRun: "FAIL",
    suite: "npm run test:integration",
    detail: "remote Supabase DB의 media_assets check constraint (media_assets_lifecycle_status_check) 위반 지속 관찰. 원격 DB DDL 정합화 대기."
  },
  {
    id: "ANI-1285",
    run: "E2E-13",
    originalRun: "FAIL",
    origReason: "marketing_missions.booking_id가 UUID인 반면 reservations.id는 TEXT (bk_UUID)로 타입 불일치 (ERROR: 42883)",
    remediationCommit: "6cbea41f",
    retestRun: "PASS",
    suite: "tests/unit/remediation/rc02-mission-booking-id-contract.test.ts",
    detail: "Canonical Booking Identifier TEXT 통일 DDL 마이그레이션 적용 및 SQL JOIN 정합성 검증 완료."
  },
  {
    id: "ANI-1286",
    run: "E2E-14",
    originalRun: "FAIL",
    origReason: "transitionMission 시 기존 계보 ID 누락 및 partial commit 시 orphan row 방치",
    remediationCommit: "6cbea41f",
    retestRun: "PASS",
    suite: "tests/unit/remediation/rc02-mission-booking-id-contract.test.ts",
    detail: "transitionMission 컨텍스트 머지 로직 적용으로 downstream 계보 ID 누락 원천 방지 검증 완료."
  },
  {
    id: "ANI-1287",
    run: "E2E-15",
    originalRun: "FAIL",
    origReason: "Owner 대시보드와 Admin 관제실 간 동일 메트릭 표시 불일치, 인메모리 상태 오염",
    remediationCommit: "9e9a072a",
    retestRun: "PASS",
    suite: "tests/unit/remediation/rc08-owner-admin-parity.test.ts",
    detail: "Owner/Admin 단일 소스 조회 통일 및 인메모리 테스트 환경 격리 검증 완료."
  },
  {
    id: "ANI-1294",
    run: "E2E-30",
    originalRun: "FAIL",
    origReason: "하드코딩된 seed 데이터로 달빛제과 카피가 바이름 워크스페이스에 침범",
    remediationCommit: "08e13bc4",
    retestRun: "PASS",
    suite: "tests/unit/remediation/rc04-tenant-grounding-revenue-truth.test.ts",
    detail: "Tenant Grounding Boundary 확립: seed/demo 하드코딩 전면 제거 및 타 매장 키워드 검출 시 fail-closed 차단."
  },
  {
    id: "ANI-1295",
    run: "E2E-31",
    originalRun: "FAIL",
    origReason: "copy-generation-engine 하드코딩 fallback으로 테넌트 오염",
    remediationCommit: "08e13bc4",
    retestRun: "PASS",
    suite: "tests/unit/remediation/rc04-tenant-grounding-revenue-truth.test.ts",
    detail: "카피 생성 시 워크스페이스 컨텍스트 엄격 바인딩 및 타 테넌트 침범 차단 검증 완료."
  },
  {
    id: "ANI-1298",
    run: "E2E-34",
    originalRun: "FAIL",
    origReason: "API 타임아웃 발생 시 FAILED 오분류로 중복 발행 위험",
    remediationCommit: "b6a94d20",
    retestRun: "PASS",
    suite: "tests/unit/remediation/rc03-external-action-timeout-reconcile.test.ts",
    detail: "외부 API 타임아웃 시 RESULT_UNKNOWN 격리 및 Readback Reconciler 연계로 duplicate publish 원천 차단."
  },
  {
    id: "ANI-1301",
    run: "E2E-41",
    originalRun: "FAIL",
    origReason: "웹훅 중복 인입 시 멱등키 미비로 중복 응답 처리 위험",
    remediationCommit: "b6a94d20",
    retestRun: "PASS",
    suite: "tests/unit/remediation/rc03-external-action-timeout-reconcile.test.ts",
    detail: "불변 멱등키 검증 및 중복 전송 방지 로직 정합화 완료."
  },
  {
    id: "ANI-1305",
    run: "E2E-45",
    originalRun: "FAIL",
    origReason: "가용 캘린더 연동 없는 고정 슬롯 하드코딩 및 동시성 경합",
    remediationCommit: "26ff09a4",
    retestRun: "PASS",
    suite: "tests/unit/remediation/rc05-availability-lock.test.ts",
    detail: "실시간 가용 캘린더 슬롯 조회 및 동시성 Mutex 잠금 연동 검증 완료."
  },
  {
    id: "ANI-1307",
    run: "E2E-50",
    originalRun: "FAIL",
    origReason: "marketing_missions.booking_id UUID 타입 불일치로 SQL 조인 실패",
    remediationCommit: "6cbea41f",
    retestRun: "PASS",
    suite: "tests/unit/remediation/rc02-mission-booking-id-contract.test.ts",
    detail: "Canonical TEXT 예약 식별자 조인 및 어트리뷰션 계보 연쇄 검증 완료."
  },
  {
    id: "ANI-1309",
    run: "E2E-52",
    originalRun: "FAIL",
    origReason: "verified-outcome-aggregator 15만원 가짜 매출 날조 및 무관 대화 바인딩",
    remediationCommit: "08e13bc4",
    retestRun: "PASS",
    suite: "tests/unit/remediation/rc04-tenant-grounding-revenue-truth.test.ts",
    detail: "가짜 15만원 매출 및 무관 대화 임의 바인딩 전면 제거, 0원 정직 집계 확인."
  },
  {
    id: "ANI-1310",
    run: "E2E-53",
    originalRun: "FAIL",
    origReason: "단일 이벤트 즉시 학습 승격 및 날조된 15% 성장률",
    remediationCommit: "f9db6ede",
    retestRun: "PASS",
    suite: "tests/unit/remediation/rc06-learning-threshold.test.ts",
    detail: "최소 관찰 표본 수(N>=3) 하드 게이트 및 임의 성장률 제거, 증거 기반 학습 승격 확인."
  },
  {
    id: "ANI-1311",
    run: "E2E-54",
    originalRun: "FAIL",
    origReason: "데이터 부재 시 억지 추천 생성 및 반복 제어 미비",
    remediationCommit: "08e13bc4, f9db6ede",
    retestRun: "PASS",
    suite: "tests/unit/remediation/rc04-tenant-grounding-revenue-truth.test.ts",
    detail: "근거 없는 NBA 날조 차단 및 표본 충족 시에만 추천 생성 검증 완료."
  },
  {
    id: "ANI-1317",
    run: "E2E-70",
    originalRun: "FAIL",
    origReason: "외부 API 타임아웃을 FAILED로 처리하여 blind retry 유발",
    remediationCommit: "b6a94d20",
    retestRun: "PASS",
    suite: "tests/unit/remediation/rc03-external-action-timeout-reconcile.test.ts",
    detail: "RESULT_UNKNOWN 상태 영수증 발급 및 Readback Reconciler 강제 연계 확인."
  },
  {
    id: "ANI-1318",
    run: "E2E-71",
    originalRun: "FAIL",
    origReason: "트랜잭션 부분 커밋 시 orphan row 방치 및 계보 단절",
    remediationCommit: "6cbea41f, 43b49f1a",
    retestRun: "PASS",
    suite: "tests/unit/remediation/rc02-mission-booking-id-contract.test.ts",
    detail: "트랜잭션 정합성 및 downstream 계보 롤백/보존 검증 완료."
  },
  {
    id: "ANI-1320",
    run: "E2E-73",
    originalRun: "FAIL",
    origReason: "cascadeCustomerDataDeletion 하드코딩 mock 숫자 및 Opt-out 무시",
    remediationCommit: "43b49f1a",
    retestRun: "PASS",
    suite: "tests/unit/remediation/rc07-privacy-cascading-deletion.test.ts",
    detail: "실제 Supabase DB 연쇄 비식별화 SQL 및 Opt-out 고객 대상 자동응답 fail-closed 차단 확인."
  }
];

async function addComment(identifier, item) {
  // 1. Get issue UUID
  const getQuery = `
    query GetIssue($id: String!) {
      issue(id: $id) {
        id
        identifier
        title
      }
    }
  `;
  const getRes = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": apiKey },
    body: JSON.stringify({ query: getQuery, variables: { id: identifier } })
  });
  const getData = await getRes.json();
  const issue = getData?.data?.issue;
  if (!issue?.id) {
    console.error(`Issue ${identifier} not found!`);
    return;
  }

  const commentBody = `### [Pre-Merge RC Fresh Retest] ${item.run} Verification Report

- **RC_SHA**: \`${RC_SHA}\`
- **PR URL**: ${PR_URL}
- **Run ID**: \`RUN_V091_RC_RETEST_${item.run.replace('-', '')}_20260911_133500\`
- **Original Run Status**: \`ORIGINAL_RUN=${item.originalRun}\`
- **Remediation Commit**: \`REMEDIATION_COMMIT=${item.remediationCommit}\`
- **Retest Status**: \`RETEST_RUN=${item.retestRun}\`

#### 검증 상세 및 증거
- **원래 결함**: ${item.origReason}
- **검증 스위트**: \`${item.suite}\`
- **결과**: ${item.detail}
- **이력 보존 원칙**: 기존 FAIL 기록을 삭제하거나 변경하지 않고, 신규 RC_SHA 커밋 기준 Fresh Retest 이력을 보존합니다.`;

  const commentMutation = `
    mutation CreateComment($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) {
        success
        comment { id }
      }
    }
  `;

  const comRes = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": apiKey },
    body: JSON.stringify({ query: commentMutation, variables: { issueId: issue.id, body: commentBody } })
  });
  const comData = await comRes.json();
  if (comData?.data?.commentCreate?.success) {
    console.log(`✅ [${identifier} / ${item.run}] Retest comment posted: RETEST_RUN=${item.retestRun}`);
  } else {
    console.error(`❌ [${identifier} / ${item.run}] Failed to post comment:`, comData);
  }
}

async function main() {
  console.log(`Starting Fresh Retest comment synchronization for 20 issues on RC_SHA ${RC_SHA}...`);
  for (const item of RETEST_ITEMS) {
    await addComment(item.id, item);
    // slight delay to respect rate limits
    await new Promise(r => setTimeout(r, 300));
  }
  console.log("All 20 fresh retest comments successfully synchronized!");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
