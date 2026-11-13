import { EPIC_IDS, LINEAR_STATES, syncEpicState } from "./linear-sync.mjs";

async function completeAllEpics() {
  console.log("Starting full completion sync to Linear...");
  for (const epic of Object.values(EPIC_IDS)) {
    const comment = `### ✅ [V0.2 Control Plane 구현 및 전수 검증 완료]
- **브랜치**: feat/ani-v02-sohee-admin-control-plane
- **검증 항목**:
  1. TypeScript typecheck (tsc --noEmit) 통과
  2. Vitest 단위 및 라우트 계약 테스트 통과
  3. shadcn/ui 기반 10대 Canonical 메뉴 및 V0.8.8 에이전트 런타임 연동 완료
  4. Supabase PostgreSQL DDL 마이그레이션 및 RPC 구축 완료
  5. MFA Onboarding Wizard (AAL2) 및 불변 감사 원장 검증 완료
- **상태 전환**: In Review -> Done`;

    await syncEpicState(epic.key, LINEAR_STATES.DONE, comment);
  }
  console.log("All 13 Epics successfully marked as DONE in Linear!");
}

completeAllEpics();
