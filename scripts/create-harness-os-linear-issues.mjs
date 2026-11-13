import dotenv from 'dotenv'
import fs from 'fs'

if (fs.existsSync('.env.local')) {
  const envConfig = dotenv.parse(fs.readFileSync('.env.local'))
  for (const k in envConfig) {
    process.env[k] = envConfig[k]
  }
}

async function createHarnessOSLinearIssues() {
  const apiKey = process.env.LINEAR_API_KEY
  if (!apiKey) {
    console.error("LINEAR_API_KEY is not set.")
    process.exit(1)
  }

  const teamId = "fe9ce92a-6944-441c-8c02-6791df6e8061" // Team Ani
  const projectId = "0a78fa08-d11a-4797-8817-b9e4e0f66868" // 소희 V0.8.8

  const issues = [
    {
      title: "[P0] [Harness OS Kernel] Workspace 멀티테넌트 RLS 및 HarnessAsset / Version 데이터 모델 구축",
      description: `### 목표
SOHEE Harness Knowledge OS PRD v1.1 9절 및 27절에 따라 Workspace 기반 멀티테넌트 데이터 모델과 RLS 정책을 구축합니다.

### 핵심 요구사항
1. **테이블 생성**:
   - \`harness_assets\`: (id, workspace_id, asset_type, source_entity_id, title, visibility, overall_status, active_version_id, created_by_user_id, created_at, archived_at)
   - \`harness_versions\`: (id, harness_asset_id, version_no, schema_version, compiler_version, analyzer_version, created_from_snapshot_id, module_json, module_readiness, confidence_summary, immutable)
   - \`harness_rules\`: (id, harness_version_id, module, rule_key, rule_value, evidence_state, confidence, confidence_basis, supporting_sample_count, contradictory_sample_count)
   - \`harness_rule_evidence\`: (rule_id, source_item_id, source_url, evidence_type, observation_summary, captured_at)
   - \`harness_override_versions\`: (id, harness_asset_id, workspace_id, base_harness_version_id, version_no, override_json)
   - \`harness_channel_assignments\`: (id, workspace_id, channel_connection_id, harness_asset_id, assignment_mode, pinned_version_id, desired_autonomy_mode, actual_autonomy_mode, enabled)
2. **엄격한 RLS 정책**:
   - 모든 조회, 삽입, 수정 시 \`workspace_id\`를 강제하여 타 Workspace와의 데이터 격리를 100% 보장.
3. **불변성 보장**:
   - \`harness_versions\`는 생성 후 immutable이며 수정 시 새로운 version_no로 기록.`,
      priority: 1
    },
    {
      title: "[P0] [Harness OS Kernel] Source Entity 안정적 식별자(Entity Key/Aliases/Handle History) 엔진 구현",
      description: `### 목표
PRD v1.1 P0-01 및 21.4절에 따라 canonical_url 변경, redirect, handle 변경 시에도 안정적인 Harness identity를 유지하는 Source Entity Resolver를 구현합니다.

### 핵심 요구사항
1. **Source Entity 모델**:
   - \`harness_source_entities\`: (id, workspace_id, platform, source_type, source_entity_key, platform_native_entity_id, canonical_url_current, source_url_aliases[], source_handle_current, source_handle_history[], resolved_at)
2. **Source Type 분리**:
   - \`PROFILE\`, \`POST\`, \`THREAD\`, \`BLOG_ARTICLE\`, \`FEED\`, \`MANUAL\`
   - PROFILE URL과 개별 POST URL이 같은 도메인이더라도 자동 병합하지 않고 독립 관리.
3. **Handle 변경 추적 및 Alias Migration**:
   - 인스타그램/스레드 handle이 변경되어도 platform_native_entity_id 또는 entity_key 일치 시 기존 Harness identity 유지 및 alias 기록.`,
      priority: 1
    },
    {
      title: "[P0] [Harness Compiler] 5대 모듈 분리 추출 및 Rule-level Provenance(5대 Evidence State) 엔진 구현",
      description: `### 목표
PRD v1.1 6~7절 및 21.7절에 따라 URL 분석 시 5대 실행 규칙 모듈을 분리 컴파일하고, 각 규칙마다 5대 Evidence State를 부여하는 컴파일러를 구현합니다.

### 핵심 요구사항
1. **5대 모듈 독립 컴파일**:
   - \`TextHarness\`: content_pillars, hook_patterns, caption_archetypes, paragraph_rhythm, tone_vector, authority/proof_patterns, cta_patterns
   - \`VisualHarness\`: subject_types, scene_types, framing, lighting_profile, palette_profile, background_profile, texture_realism, before_after_layout, feed_rhythm
   - \`OperationsHarness\`: content_mix_ratios, funnel_stage_mix, trust_building_sequence, promo_rhythm
   - \`CommunityReplyHarness\`: question_taxonomy, reply_tone, public_vs_dm_rule, booking_transition, price_question_rule
   - \`PlatformHarness\`: compatible_targets, format_constraints, hashtag/link/carousel strategies
2. **5대 Evidence State 부여**:
   - \`OBSERVED\`: 실제 source sample에서 직접 반복 관찰된 규칙
   - \`INFERRED\`: 제한된 자료에서 합리적으로 도출된 추론 규칙
   - \`RECOMMENDED_DEFAULT\`: 소희가 제안한 기본값 (절대 OBSERVED로 표시 금지)
   - \`USER_OVERRIDE\`: 사용자가 명시적으로 수정한 규칙
   - \`PERFORMANCE_LEARNED\`: 실제 계정 성과에서 학습된 최적화 규칙
3. **Synthetic Example 격리**: 소희가 생성한 예시 훅/캡션은 \`SYNTHETIC_EXAMPLE\`로 태깅.`,
      priority: 1
    },
    {
      title: "[P0] [Platform Capability] Channel Capability Registry 및 권한/세션 기반 런타임 검증 엔진 구현",
      description: `### 목표
PRD v1.1 21.10절 및 Gap Review P0-06/07에 따라 Harness(어떻게 일할지)와 Channel Capability(현재 무엇을 실제로 실행할 수 있는지)를 분리하고 런타임 권한을 검증합니다.

### 핵심 요구사항
1. **Capability Registry 스키마**:
   - platform, connector_type (\`OFFICIAL_API\`, \`OFFICIAL_PUBLIC_DISCOVERY\`, \`USER_CONNECTED_ACCOUNT\`, \`BROWSER_AUTOMATION\`), capability 목록
   - analyze_public_profile, read_own_posts, reply_comment, receive_dm, send_dm, publish_text/image/carousel/reel/story, read_insights
2. **권한 만료 및 세션 감지**:
   - OAuth 만료, Session 만료, App Permission 변경 시 Capability 캐시 즉시 다운그레이드.
   - 네이버 블로그는 \`BROWSER_AUTOMATION\` (비공식 쓰기 경로) 및 위험도(\`SESSION_EXPIRY\`, \`UI_CHANGE\`)를 명시.
3. **Capability 부족 시 액션 비활성화**:
   - 권한이 없는 채널 행동(예: Cold DM, 비즈니스 미지원 계정)은 UI와 Runtime 모두에서 자동 실행 차단.`,
      priority: 1
    },
    {
      title: "[P0] [Runtime Safety] Fact Freshness & Anti-Copy Gate & Industry Policy Pack 구현",
      description: `### 목표
PRD v1.1 24~26절에 따라 Brand Knowledge 사실 신선도 검증, 소스 복제 방지(Anti-copy), 업종별 컴플라이언스 Policy Pack을 구축합니다.

### 핵심 요구사항
1. **Fact Freshness Gate**:
   - \`HARD_LIVE_FACT\` (예약 가능 시간, 잔여 슬롯): 게시 직전 live source 확인 실패 시 발행 BLOCK.
   - \`HARD_EXPIRING_FACT\` (가격, 프로모션 기간): 만료 여부 및 verified_at 검증.
   - \`STABLE_FACT\` (주소, 경력, 상호) vs \`SOFT_PREFERENCE\` (톤앤매너).
2. **Anti-Copy & Brand Safety Gate**:
   - Source 벤치마크 원문의 상호, 가격, 전화번호, 고객사례, verbatim 캡션의 사용자 출력 누출 100% 차단.
   - Third-party 원본 이미지 재사용 금지 및 추상적 패턴/리듬으로만 VisualHarness 컴파일.
   - N-gram 및 Semantic Near-Copy 검사 실패 시 게시 BLOCK.
3. **Industry Policy Pack**:
   - 뷰티/미용: 의료법상 허위과장 시술 표현 및 부작용 0% 주장 필터링.
   - 고위험 업종별 \`forbidden_claims[]\`, \`required_disclosures[]\` 강제.`,
      priority: 1
    },
    {
      title: "[P0] [Job & Credit Reliability] 멱등성 보장 비동기 컴파일 Job 및 Credit Reserve-Settle 정산 연동",
      description: `### 목표
PRD v1.1 13절 및 22절에 따라 하네스 생성/분석 작업의 멱등성, 크레딧 사전 견적-예약-사후 정산 및 장애 복구 메커니즘을 구현합니다.

### 핵심 요구사항
1. **Harness Job 멱등성 및 상태 머신**:
   - \`idempotency_key\`를 통해 동일 URL 중복 클릭/네트워크 재전송 시 중복 과금 및 중복 버전 생성 100% 방지.
   - 상태 머신: \`DRAFT\` -> \`ANALYZING\` -> \`PARTIAL\` / \`READY\` -> \`STALE\` / \`FAILED\`.
   - \`heartbeat_at\`, \`lease_until\`, \`resumable_stage\` 기반 장애 발생 시 자동 복구/재개.
2. **Credit Economy 정산 파이프라인**:
   - 분석 시작 전 예상 SC 제시 (\`HARNESS_ANALYZE\`, \`HARNESS_REFRESH\`, \`HARNESS_PREVIEW\`).
   - \`Estimate\` -> \`Reserve\` -> 작업 실행 -> \`Settle\` (실제 사용량 정산 및 잔여분 반환).
   - 시스템 오류로 인한 재시도 시 사용자 크레딧 중복 차감 절대 금지.
3. **Verification Reserve 잠금**:
   - 외부 발행 시 사용 가능 잔액이 0이 되더라도 예약된 SC로 read-back 검증 완결.`,
      priority: 1
    },
    {
      title: "[P0] [Agent Studio UX] 지식 관리 내 하네스 라이브러리, 생성 플로우, 상세 8대 탭 및 오버라이드 UI 구축",
      description: `### 목표
PRD v1.1 10절 및 28절에 따라 Agent Studio -> Knowledge -> Harnesses 메뉴에 하네스 라이브러리 및 8대 상세 탭 UI를 구축합니다.

### 핵심 요구사항
1. **Harness Library (목록 뷰)**:
   - 검색/필터: 플랫폼(Instagram/Threads/Naver), 상태(READY/PARTIAL), 적용 채널.
   - Harness Card: 소스 URL, 플랫폼, 핵심 DNA 3개, module readiness 배지, active version, 24시간 예상 SC.
   - [링크로 하네스 만들기] 원클릭 생성 모달 (URL 감지 -> 접근성 판정 -> SC 견적 -> 진행 프로그레스).
2. **Harness Detail 8대 탭**:
   - \`개요\`: 핵심 DNA 요약, 채널 적용 상태, 종합 confidence.
   - \`규칙\`: 5대 모듈별 룰 트리 및 OBSERVED / INFERRED / RECOMMENDED_DEFAULT 시각적 배지.
   - \`근거 (Evidence)\`: 실제 추출된 스냅샷, 샘플 횟수, 신뢰도 근거.
   - \`채널·자동화\`: 채널 연결 매핑 (Desired vs Actual Autonomy).
   - \`성과 학습\`: 실제 계정 전환 결과에서 도출된 Performance Policy.
   - \`버전\`: Immutable Version 이력, 변경 Diff 및 [이전 버전으로 롤백].
   - \`내 규칙 (Override)\`: 사용자가 추가한 커스텀 규칙 및 [소희 분석값으로 되돌리기].
   - \`크레딧·사용량\`: 분석/운영/일일 소비 SC 드릴다운.
3. **인터랙션 액션**:
   - [이 하네스로 미리보기 생성], [채널에 즉시 적용], [새 버전으로 재분석].`,
      priority: 1
    },
    {
      title: "[P0] [Generation Integration] 재현 가능한 완전한 런타임 Provenance 및 Calibrated Evaluator Gate 구현",
      description: `### 목표
PRD v1.1 14절, 27절 및 Gap Review P0-09/11에 따라 모든 콘텐츠 생성 실행 시 완전한 Provenance를 기록하고 품질 게이트를 통과시키는 파이프라인을 구축합니다.

### 핵심 요구사항
1. **GenerationRun Provenance 스냅샷**:
   - \`harness_generation_runs\`: workspace_id, output_id, mission_id, harness_assignment_id, harness_version_id, override_snapshot_id, brand_knowledge_snapshot_id, platform_adapter_version, evaluator_version, text_model_version, compiled_prompt_hash, publish_proof_ref.
   - 과거 어떤 생성물이든 정확한 프롬프트/하네스 버전/브랜드 사실 스냅샷으로 100% 재현 가능하도록 보장.
2. **Calibrated Evaluator Gate**:
   - 브랜드 사실 정확도, 하네스 룰 적합도, 오리지널리티(원문 유사도 검사), 플랫폼 적합도, CTA 및 안전성 측정.
   - Threshold 미달 시 자동 재생성 트리거.
3. **Publish Proof & Live Evidence**:
   - 실제 게시 완료 시 Provider 응답 ID 및 live fetch URL 검증 증거를 함께 영구 보존.`,
      priority: 1
    },
    {
      title: "[P0] [Seed & E2E Validation] Seed Reference 인프라 및 다중 테넌트 격리 전수 E2E 검증",
      description: `### 목표
PRD v1.1 29~30절에 따라 studio_by.reum 및 noor.brow Reference Seed 인프라를 구축하고, 복수 Workspace 간 100% 데이터 격리 E2E 테스트를 통과합니다.

### 핵심 요구사항
1. **Seed Reference 시스템**:
   - \`studio_by.reum\` (경력/신뢰 자산, 퍼스널 진단, 첫인상 변화, 15% 프로모션 구조)
   - \`noor.brow\` (11년 메이크업/MAC 아티스트 권위, 골격/모류 1:1 맞춤 진단, 문제해결형 콘텐츠)
   - 두 Seed를 \`SYSTEM_SEED_REFERENCE\`로 등록하고, 사용자가 자신의 Workspace로 IMPORT/COPY 시 private asset으로 승격.
2. **멀티테넌트 격리 E2E 검증 (AC-45)**:
   - 두 개의 독립된 Test Workspace에서 동일한 소스 URL을 분석하여도 각자의 HarnessAsset, Override, CreditAccount, Generation History가 완전히 격리됨을 증명하는 자동화 테스트 작성 및 통과.
3. **전수 검증 증거 확보**:
   - \`npm test\`, \`npm run typecheck\`, \`npm run lint\` 100% 통과 증거 수집.`,
      priority: 1
    }
  ]

  console.log(`Creating ${issues.length} Linear issues for Harness Knowledge OS v1.1...`)
  for (const item of issues) {
    const res = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": apiKey },
      body: JSON.stringify({
        query: `mutation CreateIssue($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue { id identifier title priority state { name } }
          }
        }`,
        variables: {
          input: {
            teamId,
            projectId,
            title: item.title,
            description: item.description,
            priority: item.priority
          }
        }
      })
    })

    const data = await res.json()
    const issue = data?.data?.issueCreate?.issue
    if (issue) {
      console.log(`✅ [${issue.identifier}] ${issue.title}`)
    } else {
      console.error("Failed to create issue:", data?.errors || data)
    }
  }
}

createHarnessOSLinearIssues().catch(console.error)
