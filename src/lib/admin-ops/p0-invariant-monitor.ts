/**
 * Admin P0 Invariant Monitor & Anti-False-Green Engine (ANI-1051)
 *
 * Enforces zero false-green observability:
 * 1. Evaluates all 11 critical P0 invariants.
 * 2. An 'allClear = true' verdict requires every invariant to be strictly zero.
 * 3. Bridges runtime truth, DB persistence, capability registry, and security grants.
 */

export const ALL_P0_INVARIANT_CODES = [
  'EDGE_AGENT_BYPASS',
  'DURABLE_CHAT_ZERO_WRITE',
  'WORKSPACE_CONTEXT_SPLIT_BRAIN',
  'FAKE_CAPABILITY_EXPOSED',
  'CONTENT_WITHOUT_DURABLE_VERSION',
  'APPROVAL_WITHOUT_DB_ROW',
  'EXTERNAL_ACTION_WITHOUT_LEDGER',
  'AGED_RESULT_UNKNOWN',
  'WEBHOOK_FALSE_GREEN',
  'UNEXPECTED_SECURITY_DEFINER_GRANT',
  'RELEASE_IDENTITY_MISMATCH',
  // 10차 Creative Asset Truth Invariants
  'STATIC_OR_STOCK_MEDIA_IN_PRODUCTION',
  'MEDIA_ASSET_LINEAGE_MISSING',
  'CREATIVE_BUNDLE_NOT_APPROVED',
  'PROVIDER_VISUAL_MISMATCH',
  'SUPABASE_SECURITY_ADVISOR_ERROR',
  'META_PUBLIC_NOT_READY_MISREPRESENTED',
] as const

export type P0InvariantCode = (typeof ALL_P0_INVARIANT_CODES)[number]

export interface SystemTelemetrySnapshot {
  edgeAgentInterceptActive: boolean
  conversationThreadsCount: number
  durableMessagesCount: number
  workspaceContextMatch: boolean
  exposedToolNames: readonly string[]
  contentItemsCount: number
  contentVersionsCount: number
  unpersistedApprovalCount: number
  unledgeredActionCount: number
  agedUnknownResultCount: number
  webhookProviderEventsCount: number
  webhookStatus: string
  anonSecurityDefinerExecutables: readonly string[]
  releaseIdentityMatches: boolean

  // 10차 Creative Asset Truth Telemetry Fields
  publishedWithCanonicalMediaOnly?: boolean
  mediaAssetsCount?: number
  contentVersionMediaCount?: number
  staticOrStockPublishAttempts?: number
  unapprovedCreativeBundlePublishes?: number
  providerVisualMismatches?: number
  securityAdvisorErrorsCount?: number
  metaPublicReadinessAccurate?: boolean
}

export interface P0Violation {
  code: P0InvariantCode
  severity: 'P0'
  title: string
  description: string
  detectedAt: string
}

export interface InvariantEvaluationResult {
  allClear: boolean
  hasP0Violation: boolean
  violations: P0Violation[]
  evaluatedAt: string
  snapshotProvenance: {
    threads: number
    messages: number
    contents: number
    versions: number
  }
}

const PROHIBITED_FAKE_TOOLS = new Set([
  'reserve_seat_slot',
  'predict_marketing_roi',
  'occupancy_rate_query',
  'crm_customer_blast',
  'run_meta_ad_campaign',
  'harness_override_mutation',
])

export function evaluateP0Invariants(snapshot: SystemTelemetrySnapshot): InvariantEvaluationResult {
  const evaluatedAt = new Date().toISOString()
  const violations: P0Violation[] = []

  // 1. EDGE_AGENT_BYPASS
  if (snapshot.edgeAgentInterceptActive) {
    violations.push({
      code: 'EDGE_AGENT_BYPASS',
      severity: 'P0',
      title: 'Cloudflare Edge Agent Chat Intercept Detected',
      description: 'worker-entry.js 또는 Edge 계층에서 Next.js를 우회하여 대화를 응답하고 있습니다.',
      detectedAt: evaluatedAt,
    })
  }

  // 2. DURABLE_CHAT_ZERO_WRITE
  if (snapshot.conversationThreadsCount > 0 && snapshot.durableMessagesCount === 0) {
    violations.push({
      code: 'DURABLE_CHAT_ZERO_WRITE',
      severity: 'P0',
      title: 'Durable Chat Zero Write Invariant Breached',
      description: `대화 스레드가 ${snapshot.conversationThreadsCount}개 존재하나 DB messages가 0개입니다 (F5/새로고침 기억상실 위험).`,
      detectedAt: evaluatedAt,
    })
  }

  // 3. WORKSPACE_CONTEXT_SPLIT_BRAIN
  if (!snapshot.workspaceContextMatch) {
    violations.push({
      code: 'WORKSPACE_CONTEXT_SPLIT_BRAIN',
      severity: 'P0',
      title: 'Workspace Context Split-Brain Detected',
      description: 'DB의 비즈니스 설정값과 UI/Agent 런타임 맥락 간의 불일치가 감지되었습니다.',
      detectedAt: evaluatedAt,
    })
  }

  // 4. FAKE_CAPABILITY_EXPOSED
  const fakeToolsFound = snapshot.exposedToolNames.filter((t) => PROHIBITED_FAKE_TOOLS.has(t))
  if (fakeToolsFound.length > 0) {
    violations.push({
      code: 'FAKE_CAPABILITY_EXPOSED',
      severity: 'P0',
      title: 'Prohibited Capability Theatre Exposed to Model',
      description: `실제 백엔드가 없는 허위 도구(${fakeToolsFound.join(', ')})가 모델에 노출되었습니다.`,
      detectedAt: evaluatedAt,
    })
  }

  // 5. CONTENT_WITHOUT_DURABLE_VERSION
  if (snapshot.contentItemsCount > 0 && snapshot.contentVersionsCount === 0) {
    violations.push({
      code: 'CONTENT_WITHOUT_DURABLE_VERSION',
      severity: 'P0',
      title: 'ContentItem Exists Without Durable Version',
      description: 'content_items 원장은 존재하나 연결된 content_versions가 0건입니다.',
      detectedAt: evaluatedAt,
    })
  }

  // 6. APPROVAL_WITHOUT_DB_ROW
  if (snapshot.unpersistedApprovalCount > 0) {
    violations.push({
      code: 'APPROVAL_WITHOUT_DB_ROW',
      severity: 'P0',
      title: 'Ephemeral UI Approval Without DB Row',
      description: `DB approvals 행 없이 UI 승인 상태만 존재하는 건이 ${snapshot.unpersistedApprovalCount}건 감지되었습니다.`,
      detectedAt: evaluatedAt,
    })
  }

  // 7. EXTERNAL_ACTION_WITHOUT_LEDGER
  if (snapshot.unledgeredActionCount > 0) {
    violations.push({
      code: 'EXTERNAL_ACTION_WITHOUT_LEDGER',
      severity: 'P0',
      title: 'Unledgered External Action Attempt Detected',
      description: `external_action_requests 원장 없이 외부 API 호출이 시도된 건이 ${snapshot.unledgeredActionCount}건 있습니다.`,
      detectedAt: evaluatedAt,
    })
  }

  // 8. AGED_RESULT_UNKNOWN
  if (snapshot.agedUnknownResultCount > 0) {
    violations.push({
      code: 'AGED_RESULT_UNKNOWN',
      severity: 'P0',
      title: 'Aged RESULT_UNKNOWN Recovery Pending',
      description: `임계 시간을 초과하여 회복되지 않은 RESULT_UNKNOWN 건이 ${snapshot.agedUnknownResultCount}건 있습니다.`,
      detectedAt: evaluatedAt,
    })
  }

  // 9. WEBHOOK_FALSE_GREEN
  if (snapshot.webhookProviderEventsCount === 0 && (snapshot.webhookStatus === 'HEALTHY' || snapshot.webhookStatus === 'LISTENING')) {
    violations.push({
      code: 'WEBHOOK_FALSE_GREEN',
      severity: 'P0',
      title: 'Webhook False-Green Health Status Detected',
      description: '수신된 공급자 서명 웹훅 이벤트가 0건인데 웹훅 상태가 HEALTHY/LISTENING으로 표시되고 있습니다.',
      detectedAt: evaluatedAt,
    })
  }

  // 10. UNEXPECTED_SECURITY_DEFINER_GRANT
  if (snapshot.anonSecurityDefinerExecutables.length > 0) {
    violations.push({
      code: 'UNEXPECTED_SECURITY_DEFINER_GRANT',
      severity: 'P0',
      title: 'Anonymous Privilege on SECURITY DEFINER RPC',
      description: `anon 역할에 실행 권한이 부여된 SECURITY DEFINER 함수(${snapshot.anonSecurityDefinerExecutables.join(', ')})가 존재합니다.`,
      detectedAt: evaluatedAt,
    })
  }

  // 11. RELEASE_IDENTITY_MISMATCH
  if (!snapshot.releaseIdentityMatches) {
    violations.push({
      code: 'RELEASE_IDENTITY_MISMATCH',
      severity: 'P0',
      title: 'Release Identity Mismatch Detected',
      description: '배포된 서비스 번들의 릴리스 식별자가 Canonical 소스 코드 정본과 일치하지 않습니다.',
      detectedAt: evaluatedAt,
    })
  }

  // 12. STATIC_OR_STOCK_MEDIA_IN_PRODUCTION (10차)
  if (snapshot.staticOrStockPublishAttempts && snapshot.staticOrStockPublishAttempts > 0) {
    violations.push({
      code: 'STATIC_OR_STOCK_MEDIA_IN_PRODUCTION',
      severity: 'P0',
      title: 'Static or Stock Media In Production Publish Attempt',
      description: `Production 게시 경로에서 허용되지 않은 정적/스톡 이미지(sohee_insta_post.jpg, Unsplash 등) 사용 시도가 ${snapshot.staticOrStockPublishAttempts}건 감지되었습니다.`,
      detectedAt: evaluatedAt,
    })
  }

  // 13. MEDIA_ASSET_LINEAGE_MISSING (10차)
  if (
    snapshot.publishedWithCanonicalMediaOnly === false ||
    (snapshot.contentVersionsCount > 0 &&
      (snapshot.mediaAssetsCount === 0 || snapshot.contentVersionMediaCount === 0))
  ) {
    violations.push({
      code: 'MEDIA_ASSET_LINEAGE_MISSING',
      severity: 'P0',
      title: 'Canonical MediaAsset Lineage Missing',
      description: `콘텐츠 버전이 존재하지만 canonical MediaAsset(수: ${snapshot.mediaAssetsCount ?? 0}) 또는 ContentVersionMedia 바인딩(수: ${snapshot.contentVersionMediaCount ?? 0})이 누락되었습니다.`,
      detectedAt: evaluatedAt,
    })
  }

  // 14. CREATIVE_BUNDLE_NOT_APPROVED (10차)
  if (snapshot.unapprovedCreativeBundlePublishes && snapshot.unapprovedCreativeBundlePublishes > 0) {
    violations.push({
      code: 'CREATIVE_BUNDLE_NOT_APPROVED',
      severity: 'P0',
      title: 'Unapproved CreativeBundle Publish Attempt',
      description: `미디어 번들 승인(Exact CreativeBundle Approval) 없이 외부 게시가 시도된 건이 ${snapshot.unapprovedCreativeBundlePublishes}건 있습니다.`,
      detectedAt: evaluatedAt,
    })
  }

  // 15. PROVIDER_VISUAL_MISMATCH (10차)
  if (snapshot.providerVisualMismatches && snapshot.providerVisualMismatches > 0) {
    violations.push({
      code: 'PROVIDER_VISUAL_MISMATCH',
      severity: 'P0',
      title: 'Provider Visual / Semantic Mismatch Detected',
      description: `외부 Provider 게시 결과의 시각적/의미적 검증(Visual QC/Readback)에서 ${snapshot.providerVisualMismatches}건의 불일치가 감지되었습니다.`,
      detectedAt: evaluatedAt,
    })
  }

  // 16. SUPABASE_SECURITY_ADVISOR_ERROR (10차)
  if (snapshot.securityAdvisorErrorsCount && snapshot.securityAdvisorErrorsCount > 0) {
    violations.push({
      code: 'SUPABASE_SECURITY_ADVISOR_ERROR',
      severity: 'P0',
      title: 'Supabase Security Advisor Critical Errors Present',
      description: `Supabase Security Advisor에서 ${snapshot.securityAdvisorErrorsCount}건의 미해결 ERROR가 검출되었습니다 (agent_runs SECURITY DEFINER 등).`,
      detectedAt: evaluatedAt,
    })
  }

  // 17. META_PUBLIC_NOT_READY_MISREPRESENTED (10차)
  if (snapshot.metaPublicReadinessAccurate === false) {
    violations.push({
      code: 'META_PUBLIC_NOT_READY_MISREPRESENTED',
      severity: 'P0',
      title: 'Meta Public Readiness Misrepresented',
      description: 'Meta 앱이 내부 테스트/개발 상태인데 PUBLIC_CUSTOMER_READY로 부정확하게 표기되었습니다.',
      detectedAt: evaluatedAt,
    })
  }

  const allClear = violations.length === 0

  return {
    allClear,
    hasP0Violation: !allClear,
    violations,
    evaluatedAt,
    snapshotProvenance: {
      threads: snapshot.conversationThreadsCount,
      messages: snapshot.durableMessagesCount,
      contents: snapshot.contentItemsCount,
      versions: snapshot.contentVersionsCount,
    },
  }
}
