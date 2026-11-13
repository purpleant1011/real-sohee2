/**
 * Post-8th Failure Closure Matrix (ANI-1057)
 *
 * Maps all 7 original Post-8th audit FAIL/WARN findings 1:1 to:
 * - Linear Issue ID
 * - Implementation Source Files / Migrations
 * - Automated Test Suites
 * - Final Closure Verdict (CLOSED)
 */

export interface ClosureMatrixItem {
  id: string
  title: string
  originalFailureRca: string
  linearIssueId: string
  resolutionKind: 'CODE_CHANGE' | 'SCHEMA_MIGRATION' | 'POLICY_GATE' | 'TEST_HARNESS'
  resolutionFiles: readonly string[]
  verificationTestSuites: readonly string[]
  closureVerdict: 'CLOSED' | 'OPEN'
}

export const POST_8TH_CLOSURE_MATRIX: readonly ClosureMatrixItem[] = [
  {
    id: 'P0-1',
    title: 'Migration Drift & external_action_requests Check Constraint 23514',
    originalFailureRca: 'external_action_requests 상태 체크 제약조건 불일치 및 멱등키 미지원으로 인한 DB 오류',
    linearIssueId: 'ANI-1045',
    resolutionKind: 'CODE_CHANGE',
    resolutionFiles: [
      'src/lib/external-actions/canonical-action-ledger.ts',
      'src/lib/publishing/publishing-executor.ts',
      'src/app/api/workspaces/[workspaceId]/publishing/reconcile/route.ts',
    ],
    verificationTestSuites: [
      'tests/unit/external-action-idempotency.test.ts',
      'tests/integration/instagram-threads-supervised-golden-journey.test.ts',
    ],
    closureVerdict: 'CLOSED',
  },
  {
    id: 'P0-2',
    title: 'Durable Memory Zero Write / F5 & Re-login Amnesia',
    originalFailureRca: 'Edge intercept 및 ws-default 하드코딩으로 인해 DB messages에 사용자/어시스턴트 대화가 영속되지 않음',
    linearIssueId: 'ANI-1035, ANI-1036, ANI-1037, ANI-1038',
    resolutionKind: 'CODE_CHANGE',
    resolutionFiles: [
      'src/features/chat/workspace-provider.tsx',
      'src/features/chat/conversation-repository.ts',
      'worker-entry.js',
    ],
    verificationTestSuites: [
      'tests/unit/durable-chat-turn-persistence.test.ts',
      'tests/unit/canonical-read-semantics.test.ts',
    ],
    closureVerdict: 'CLOSED',
  },
  {
    id: 'P0-3',
    title: 'Content Fixture + Fake QC + React-only Approval',
    originalFailureRca: '원고가 메모리/목데이터로 처리되고 승인이 클라이언트 상태에만 머물러 외부 오게시 및 버전 불일치 위험',
    linearIssueId: 'ANI-1041, ANI-1042, ANI-1043',
    resolutionKind: 'CODE_CHANGE',
    resolutionFiles: [
      'src/lib/content-studio/canonical-content-lifecycle.ts',
      'src/lib/agent-os/marketing-work-service.ts',
    ],
    verificationTestSuites: [
      'tests/unit/exact-version-approval.test.ts',
      'tests/unit/chat-panel-version-sync.test.ts',
    ],
    closureVerdict: 'CLOSED',
  },
  {
    id: 'P0-4',
    title: 'provider_webhook_events=0 Webhook False-Green',
    originalFailureRca: '실제 공급자 서명 웹훅 이벤트가 0건인데도 채널 상태를 HEALTHY/LISTENING으로 표시하는 허위 관제',
    linearIssueId: 'ANI-1048',
    resolutionKind: 'POLICY_GATE',
    resolutionFiles: ['src/features/channels/meta-webhook-health.ts'],
    verificationTestSuites: ['tests/unit/real-tool-admission-and-webhook-truth.test.ts'],
    closureVerdict: 'CLOSED',
  },
  {
    id: 'P0-5',
    title: 'Meta DEVELOPMENT Mode vs PUBLIC_CUSTOMER_READY Splitting',
    originalFailureRca: 'Meta App Review 미승인 상태의 테스트 계정 성공을 일반 고객 자율 서비스 가능으로 오인',
    linearIssueId: 'ANI-1049',
    resolutionKind: 'POLICY_GATE',
    resolutionFiles: ['src/features/channels/meta-access-gate.ts'],
    verificationTestSuites: ['tests/unit/real-tool-admission-and-webhook-truth.test.ts'],
    closureVerdict: 'CLOSED',
  },
  {
    id: 'P0-6',
    title: 'Capability Theatre (Fake ROI, CRM Blasts, Reservation Slots)',
    originalFailureRca: '실제 백엔드 핸들러가 없는 가짜 능력(82.4% 점유율, 245만원 ROI 등)을 모델 도구로 노출',
    linearIssueId: 'ANI-1034, ANI-1044',
    resolutionKind: 'POLICY_GATE',
    resolutionFiles: [
      'src/lib/agent-os/real-tool-registry.ts',
      'worker-entry.js',
    ],
    verificationTestSuites: ['tests/unit/real-tool-admission-and-webhook-truth.test.ts'],
    closureVerdict: 'CLOSED',
  },
  {
    id: 'P0-7',
    title: 'Supabase Security Definer Views & Anonymous Executable RPC',
    originalFailureRca: 'agent_runs 뷰의 SECURITY DEFINER 오류 및 complete_channel_verification_v12의 anon 실행 권한',
    linearIssueId: 'ANI-1050',
    resolutionKind: 'SCHEMA_MIGRATION',
    resolutionFiles: [
      'supabase/migrations/20260908010000_security_definer_view_and_rpc_least_privilege_closure.sql',
    ],
    verificationTestSuites: ['tests/unit/admin-p0-invariant-monitor.test.ts'],
    closureVerdict: 'CLOSED',
  },
]

export function getPost8thClosureMatrix(): readonly ClosureMatrixItem[] {
  return POST_8TH_CLOSURE_MATRIX
}

/**
 * 10차 Creative False-Green Closure Matrix (ANI-1060, ANI-1068, ANI-1094)
 *
 * 9차 Production의 가짜 성공(단호박/생무화과 타르트 캡션에 살롱 static 이미지 오게시, media_assets=0인데 성공 처리)을
 * 공식적인 미해결(OPEN) 결함으로 등록하고, 10차의 각 Wave 구현을 통해 검증 후 CLOSED로 전환한다.
 */
export const POST_9TH_CREATIVE_CLOSURE_MATRIX: readonly ClosureMatrixItem[] = [
  {
    id: '10TH-P0-1',
    title: 'Zero Canonical Media Lineage in Production Publishing',
    originalFailureRca: 'target workspace(00000000-0000-4000-8000-0000000000a2)에서 media_assets=0, content_version_media=0인데 게시 성공 처리됨',
    linearIssueId: 'ANI-1060, ANI-1068, ANI-1071',
    resolutionKind: 'SCHEMA_MIGRATION',
    resolutionFiles: [
      'supabase/migrations/20260908120000_creative_media_asset_truth_v10.sql',
      'src/lib/admin-ops/p0-invariant-monitor.ts',
    ],
    verificationTestSuites: [
      'tests/unit/creative-asset-truth-static-url-regression.test.ts',
      'tests/integration/creative-asset-lineage-regression.test.ts',
    ],
    closureVerdict: 'OPEN',
  },
  {
    id: '10TH-P0-2',
    title: 'Static & Unsplash Fallback Image Injection in Production',
    originalFailureRca: '실제 이미지 생성 실패 또는 미생성 시 sohee_insta_post.jpg 및 Unsplash URL이 조용히 fallback으로 주입되어 게시됨',
    linearIssueId: 'ANI-1068, ANI-1083',
    resolutionKind: 'CODE_CHANGE',
    resolutionFiles: [
      'src/lib/publishing/publishing-executor.ts',
      'src/app/app/content/content-view.tsx',
    ],
    verificationTestSuites: [
      'tests/unit/creative-asset-truth-static-url-regression.test.ts',
    ],
    closureVerdict: 'OPEN',
  },
  {
    id: '10TH-P0-3',
    title: 'Text-only Approval Bypassing Media Verification',
    originalFailureRca: '사용자 승인이 텍스트 캡션에만 한정되어 잘못된/미생성 이미지가 포함된 게시물이 승인 상태를 획득함',
    linearIssueId: 'ANI-1081, ANI-1082',
    resolutionKind: 'CODE_CHANGE',
    resolutionFiles: [
      'src/lib/creative/creative-bundle-approval.ts',
      'src/lib/content-studio/canonical-content-lifecycle.ts',
    ],
    verificationTestSuites: [
      'tests/unit/exact-creative-bundle-approval.test.ts',
    ],
    closureVerdict: 'OPEN',
  },
  {
    id: '10TH-P0-4',
    title: 'Provider Readback Visual Verification Absence (Tart Caption vs Salon Image)',
    originalFailureRca: 'Instagram 게시 후 permalink/caption만 회수하고 실제 게시된 이미지 바이트/지각적 정합성을 검증하지 않아 타르트에 미용실 이미지가 게시된 채 PASS 처리됨',
    linearIssueId: 'ANI-1084, ANI-1096',
    resolutionKind: 'CODE_CHANGE',
    resolutionFiles: [
      'src/lib/publishing/provider-visual-verifier.ts',
      'src/lib/external-actions/meta-action-executor.ts',
    ],
    verificationTestSuites: [
      'tests/unit/provider-visual-verification.test.ts',
    ],
    closureVerdict: 'OPEN',
  },
  {
    id: '10TH-P0-5',
    title: 'Supabase Security Advisor Critical ERRORs on SECURITY DEFINER Views',
    originalFailureRca: 'public.agent_runs, public.agent_run_steps가 SECURITY DEFINER view로 남아 Security Advisor ERROR 2건 발생',
    linearIssueId: 'ANI-1090, ANI-1105',
    resolutionKind: 'SCHEMA_MIGRATION',
    resolutionFiles: [
      'supabase/migrations/20260908130000_close_agent_runs_security_definer_views.sql',
    ],
    verificationTestSuites: [
      'tests/unit/admin-p0-invariant-monitor.test.ts',
    ],
    closureVerdict: 'OPEN',
  },
  {
    id: '10TH-P0-6',
    title: 'Meta Internal Test State Misrepresented as Public Customer Ready',
    originalFailureRca: 'Meta 앱이 미게시/개발 모드인데 테스터 계정 성공을 이유로 전체 사용자 자율 서비스 준비 완료로 오표기',
    linearIssueId: 'ANI-1092',
    resolutionKind: 'POLICY_GATE',
    resolutionFiles: [
      'src/features/channels/meta-access-gate.ts',
    ],
    verificationTestSuites: [
      'tests/unit/real-tool-admission-and-webhook-truth.test.ts',
    ],
    closureVerdict: 'OPEN',
  },
]

export function getPost9thCreativeClosureMatrix(): readonly ClosureMatrixItem[] {
  return POST_9TH_CREATIVE_CLOSURE_MATRIX
}

