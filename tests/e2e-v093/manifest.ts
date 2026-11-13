/**
 * V0.93 E2E Execution Plan Manifest (ANI-1635)
 * Defines the 12 comprehensive customer journey steps across Mobile (375x812) and PC (1440x900).
 */

export type StepId =
  | "E093-01"
  | "E093-02"
  | "E093-03"
  | "E093-04"
  | "E093-05"
  | "E093-06"
  | "E093-07"
  | "E093-08"
  | "E093-09"
  | "E093-10"
  | "E093-11"
  | "E093-12";

export type ExecutionLane = "PLAN_ONLY" | "LOCAL_TEST_FIXTURE" | "LIVE_ALLOWLIST";

export type RequiredGate =
  | "NONE"
  | "LOCAL_TEST_FIXTURE"
  | "ANI-1598"
  | "ANI-1604"
  | "ANI-1613";

export interface StepBdd {
  given: string;
  when: string;
  then: string;
}

export interface ManifestStep {
  stepId: StepId;
  title: string;
  bdd: StepBdd;
  lane: ExecutionLane;
  requiredGate: RequiredGate;
  linkedGoldenIds: string[];
  requiredEvidence: string[];
  prohibitedActions: string[];
  requiredStepFields: string[];
}

export const VIEWPORTS = {
  MOBILE: { width: 375, height: 812, name: "mobile-375" },
  PC: { width: 1440, height: 900, name: "pc-1440" },
} as const;

export type ViewportKey = keyof typeof VIEWPORTS;

export const MANIFEST_STEPS: ManifestStep[] = [
  {
    stepId: "E093-01",
    title: "홈·사업장 진입 및 업무 선택",
    bdd: {
      given: "TEST A owner가 로그인되어 홈 화면에 진입한 상태",
      when: "홈에서 특정 canonical work item을 선택할 때",
      then: "동일한 workspace alias 및 canonical work ref가 로드되어야 한다",
    },
    lane: "LOCAL_TEST_FIXTURE",
    requiredGate: "LOCAL_TEST_FIXTURE",
    linkedGoldenIds: ["G093-01"],
    requiredEvidence: ["workspace-context", "canonical-work-ref"],
    prohibitedActions: ["신규 계정 임의 생성", "실제 Google 로그인 API 호출"],
    requiredStepFields: ["workspaceAlias", "canonicalWorkRef"],
  },
  {
    stepId: "E093-02",
    title: "사진 권리 확인 및 업로드",
    bdd: {
      given: "합성 소유 사진 및 권리 확인 fixture가 주어진 상태",
      when: "사진 등록 및 권리 결속을 요청할 때",
      then: "이미지 ref와 권리 digest가 정합성 있게 결속되어야 한다",
    },
    lane: "LOCAL_TEST_FIXTURE",
    requiredGate: "LOCAL_TEST_FIXTURE",
    linkedGoldenIds: ["G093-02"],
    requiredEvidence: ["image-references", "rights-digest"],
    prohibitedActions: ["실제 외부 Storage HTTP write", "HEIC 변환 시도(법무 gate 차단)"],
    requiredStepFields: ["imageReferences", "assetRightsDigest"],
  },
  {
    stepId: "E093-03",
    title: "사실 스냅샷 확인 및 유효성 검증",
    bdd: {
      given: "가게 사실 후보와 유효기간이 설정된 fixture 상태",
      when: "사실 확인 및 스냅샷 조회를 수행할 때",
      then: "동일한 fact snapshot hash 및 출처가 확인되어야 한다",
    },
    lane: "LOCAL_TEST_FIXTURE",
    requiredGate: "LOCAL_TEST_FIXTURE",
    linkedGoldenIds: ["G093-03"],
    requiredEvidence: ["fact-snapshot-hash", "validity-period"],
    prohibitedActions: ["실제 운영 DB 직접 조회", "만료된 사실 임의 활성화"],
    requiredStepFields: ["factSnapshotVersion"],
  },
  {
    stepId: "E093-04",
    title: "원고 인라인 수정 및 기기 동기화",
    bdd: {
      given: "모바일에서 원고를 인라인 수정 및 임시 저장한 상태",
      when: "PC에서 동일 업무를 조회할 때",
      then: "수정된 draft revision 및 첨부 사진 목록이 정확히 일치해야 한다",
    },
    lane: "LOCAL_TEST_FIXTURE",
    requiredGate: "LOCAL_TEST_FIXTURE",
    linkedGoldenIds: ["G093-04"],
    requiredEvidence: ["draft-revision", "photo-references"],
    prohibitedActions: ["실제 유료 생성 API 호출", "비용 결제 없이 임의 정산 완료 처리"],
    requiredStepFields: ["draftRevision", "imageReferences"],
  },
  {
    stepId: "E093-05",
    title: "정확 승인 (CAS 및 지문 일치)",
    bdd: {
      given: "검토 대상 revision과 승인 대기 payload가 주어진 상태",
      when: "승인 버튼을 클릭하여 승인 처리를 수행할 때",
      then: "지문(digest)이 정확히 일치할 때만 승인되고 stale revision은 거부되어야 한다",
    },
    lane: "LOCAL_TEST_FIXTURE",
    requiredGate: "LOCAL_TEST_FIXTURE",
    linkedGoldenIds: ["G093-03", "G093-06"],
    requiredEvidence: ["approved-revision", "approved-digest"],
    prohibitedActions: ["stale revision 강제 승인", "타 테넌트 자산 결속 승인"],
    requiredStepFields: ["approvedRevision", "approvedDigest"],
  },
  {
    stepId: "E093-06",
    title: "게시 또는 수동 전달 분기",
    bdd: {
      given: "승인 완료된 원고 상태",
      when: "게시 또는 보관/수동 전달을 진행할 때",
      then: "ANI-1598 승인 전에는 실게시 0건이며 providerVerified=false로 유지되어야 한다",
    },
    lane: "LOCAL_TEST_FIXTURE",
    requiredGate: "ANI-1598",
    linkedGoldenIds: ["G093-03", "G093-04"],
    requiredEvidence: ["publish-state", "readback-verification-status"],
    prohibitedActions: ["실제 SNS/인스타/블로그 API write", "가짜 게시 URL 검증 완료 처리"],
    requiredStepFields: ["publishState"],
  },
  {
    stepId: "E093-07",
    title: "문의 수신 및 답변 검토",
    bdd: {
      given: "합성 인바운드 문의 메시지 fixture가 유입된 상태",
      when: "답변 초안을 검토하고 확인을 누를 때",
      then: "케이스 ref와 발신 출처가 정확히 결속되어야 한다",
    },
    lane: "LOCAL_TEST_FIXTURE",
    requiredGate: "ANI-1604",
    linkedGoldenIds: ["G093-05"],
    requiredEvidence: ["case-reference", "sender-source"],
    prohibitedActions: ["실제 인스타 DM API 전송", "임의 고객 개인정보 열람"],
    requiredStepFields: ["caseReference", "senderSource"],
  },
  {
    stepId: "E093-08",
    title: "고객 조건 수락 및 불일치 재검토",
    bdd: {
      given: "제안된 조건과 고객 회신 조건이 주어진 상태",
      when: "정확한 일시/조건 수락을 검증할 때",
      then: "조건이 정확히 일치할 때만 결속되고 14시 제안에 15시 요청 등 불일치는 재검토로 분기되어야 한다",
    },
    lane: "LOCAL_TEST_FIXTURE",
    requiredGate: "ANI-1613",
    linkedGoldenIds: ["G093-07"],
    requiredEvidence: ["acceptance-binding", "condition-match-status"],
    prohibitedActions: ["조건 불일치 강제 자동 수락", "실제 고객 장부 임의 변경"],
    requiredStepFields: ["customerAcceptanceBinding"],
  },
  {
    stepId: "E093-09",
    title: "원자적 예약 확정 및 금액 근거",
    bdd: {
      given: "수락된 조건 및 슬롯 경쟁 상황",
      when: "예약 확정 처리를 수행할 때",
      then: "단 1건의 예약만 확정되고 예약 ID, 버전, 금액 출처가 일치해야 한다",
    },
    lane: "LOCAL_TEST_FIXTURE",
    requiredGate: "ANI-1613",
    linkedGoldenIds: ["G093-07", "G093-08"],
    requiredEvidence: ["booking-id", "booking-version", "amount-provenance"],
    prohibitedActions: ["동일 슬롯 중복 예약 승인", "미인가 PG 결제 호출"],
    requiredStepFields: ["bookingId", "bookingVersion", "amountProvenance"],
  },
  {
    stepId: "E093-10",
    title: "성과 보고 및 Same Truth 5-View 일치",
    bdd: {
      given: "홈, CRM, 예약, 성과, 어드민 5개 뷰의 데이터",
      when: "동일 canonical work에 대한 상태를 상호 대조할 때",
      then: "스냅샷 버전 및 금액 근거가 정확히 일치해야 한다",
    },
    lane: "LOCAL_TEST_FIXTURE",
    requiredGate: "LOCAL_TEST_FIXTURE",
    linkedGoldenIds: ["G093-12"],
    requiredEvidence: ["canonical-5view-proof", "same-truth-digest"],
    prohibitedActions: ["미관측/0건을 성공으로 변환", "가짜 매출 데이터 생성"],
    requiredStepFields: ["canonical5ViewCheck"],
  },
  {
    stepId: "E093-11",
    title: "새로고침 및 기기 전환 복원",
    bdd: {
      given: "작업 진행 중 모바일에서 브라우저 새로고침 또는 PC로 전환한 상태",
      when: "동일 업무 화면을 다시 로드할 때",
      then: "동일한 상태가 복원되고 중복 action이 발생하지 않아야 한다",
    },
    lane: "LOCAL_TEST_FIXTURE",
    requiredGate: "LOCAL_TEST_FIXTURE",
    linkedGoldenIds: ["G093-01", "G093-11"],
    requiredEvidence: ["resumed-epoch-state", "zero-duplicate-actions"],
    prohibitedActions: ["새로고침 시 자동 재승인/재결제", "중복 이벤트 발행"],
    requiredStepFields: ["activeStateAtRefresh"],
  },
  {
    stepId: "E093-12",
    title: "교차 사업장 격리 및 보안 예외",
    bdd: {
      given: "테넌트 A 인증 컨텍스트",
      when: "테넌트 B의 자산, 사실, 원고, 예약 접근을 시도할 때",
      then: "403/404 또는 명시적 ACCESS_DENIED로 차단되고 누출 데이터가 0건이어야 한다",
    },
    lane: "LOCAL_TEST_FIXTURE",
    requiredGate: "LOCAL_TEST_FIXTURE",
    linkedGoldenIds: ["G093-12"],
    requiredEvidence: ["isolation-refusal-status", "zero-data-leakage"],
    prohibitedActions: ["200 빈 목록 응답으로 은폐", "타 테넌트 ID 조회 허용"],
    requiredStepFields: ["crossTenantCheck"],
  },
];

export interface ObservationSlot {
  stepId: StepId;
  viewport: ViewportKey;
  status: "NOT_VERIFIED" | "PASS" | "FAIL";
  evidenceRef: string | null;
  observedAt: string | null;
}

/**
 * Creates 24 observation slots (12 steps * 2 viewports).
 * Invariant: 24 observation slots are NOT 24 business task successes!
 */
export function createObservationSlots(): ObservationSlot[] {
  const slots: ObservationSlot[] = [];
  const viewportKeys: ViewportKey[] = ["MOBILE", "PC"];

  for (const step of MANIFEST_STEPS) {
    for (const vp of viewportKeys) {
      slots.push({
        stepId: step.stepId,
        viewport: vp,
        status: "NOT_VERIFIED",
        evidenceRef: null,
        observedAt: null,
      });
    }
  }

  return slots;
}

const CANONICAL_STEP_IDS = new Set<string>(MANIFEST_STEPS.map((s) => s.stepId));

/**
 * Counts steps where contract unit/fixture checks completed for both viewports.
 *
 * Anti-optimism Invariants:
 * 1. Step must be in canonical 12 step whitelist.
 * 2. Exactly one MOBILE slot and one PC slot must exist (no duplicates, no omissions).
 * 3. Both slots must be PASS. Any FAIL or NOT_VERIFIED eliminates the step.
 * 4. Both slots must have non-empty string evidenceRef.
 * 5. Both slots must have valid ISO observedAt timestamp.
 */
export function countContractCompletedSteps(slots: ObservationSlot[]): number {
  const stepSlotMap = new Map<string, ObservationSlot[]>();

  for (const slot of slots) {
    if (!CANONICAL_STEP_IDS.has(slot.stepId)) {
      continue;
    }
    const list = stepSlotMap.get(slot.stepId) ?? [];
    list.push(slot);
    stepSlotMap.set(slot.stepId, list);
  }

  let completedSteps = 0;

  stepSlotMap.forEach((stepSlots) => {
    // Must have exactly 2 slots: 1 MOBILE, 1 PC
    if (stepSlots.length !== 2) {
      return;
    }

    const mobileSlots = stepSlots.filter((s) => s.viewport === "MOBILE");
    const pcSlots = stepSlots.filter((s) => s.viewport === "PC");

    if (mobileSlots.length !== 1 || pcSlots.length !== 1) {
      return;
    }

    const m = mobileSlots[0];
    const p = pcSlots[0];

    // Status must be PASS
    if (m.status !== "PASS" || p.status !== "PASS") {
      return;
    }

    // Evidence ref must be valid non-empty string
    if (!m.evidenceRef || typeof m.evidenceRef !== "string" || m.evidenceRef.trim() === "") {
      return;
    }
    if (!p.evidenceRef || typeof p.evidenceRef !== "string" || p.evidenceRef.trim() === "") {
      return;
    }

    // ObservedAt must be valid timestamp
    if (!m.observedAt || isNaN(Date.parse(m.observedAt))) {
      return;
    }
    if (!p.observedAt || isNaN(Date.parse(p.observedAt))) {
      return;
    }

    completedSteps++;
  });

  return completedSteps;
}

/**
 * Calculates verified business task count from observation slots.
 *
 * Invariant: Real business task verification requires live E2E execution with
 * external provider readback and real server attestation.
 * In this skeleton / PLAN_ONLY / contract testing phase, real verified tasks
 * MUST strictly return 0. Contract passes do not elevate to business successes!
 */
export function countVerifiedBusinessTasks(_slots: ObservationSlot[]): number {
  void _slots;
  // In skeleton phase: Real E2E is unintegrated and deferred -> strictly 0
  return 0;
}
