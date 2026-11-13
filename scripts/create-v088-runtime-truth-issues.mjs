import dotenv from 'dotenv'
import fs from 'fs'

if (fs.existsSync('.env.local')) {
  const envConfig = dotenv.parse(fs.readFileSync('.env.local'))
  for (const k in envConfig) {
    process.env[k] = envConfig[k]
  }
}

async function createV088RuntimeTruthIssues() {
  const apiKey = process.env.LINEAR_API_KEY
  if (!apiKey) {
    console.error("LINEAR_API_KEY is not set.")
    process.exit(1)
  }

  const teamId = "fe9ce92a-6944-441c-8c02-6791df6e8061" // Team Ani
  const projectId = "0a78fa08-d11a-4797-8817-b9e4e0f66868" // 소희 V0.8.8

  const issues = [
    {
      title: "[P0] [Harness Gate] Development Harness V1.1 CI 기계적 강제 검사기 구현 (No LocalStorage, No Fake Success, No Hardcoded Workspace)",
      description: `### 목표\n감사 보고서 11절 및 P0-10 요구사항에 따라, 기계적으로 코드베이스의 가짜 성공(false success), 로컬 스토리지 크레딧, 하드코딩된 테넌트 ID, 임의 mock 데이터를 감지하고 빌드를 차단하는 CI 린트 검사기(\`scripts/verify-runtime-truth.mjs\`)를 구축합니다.\n\n### 핵심 수용 기준\n1. \`localStorage\`가 Agent/Credit/Run/Policy 정본에 사용될 시 검사 실패.\n2. \`ws-byreum\` 등 하드코딩된 테넌트 ID가 프로덕션 컴포넌트/라우트에 잔존 시 검사 실패.\n3. 외부 발행 액션이 read-after-write 증거 없이 VERIFIED 처리 시 검사 실패.\n4. \`package.json\` 검증 스크립트(\`npm run verify:truth\`) 등록 및 CI 빌드 연동.`,
      priority: 1
    },
    {
      title: "[P0] [Multi-Tenant] Workspace 동적 컨텍스트 정합성 확보 및 ws-byreum 하드코딩 전면 제거",
      description: `### 목표\n감사 보고서 14절 및 P0-12 요구사항에 따라, 모든 V0.8.8 프론트엔드/백엔드 라우트에서 \`ws-byreum\` 정적 하드코딩을 제거하고 Supabase Auth 세션 및 URL/헤더 기반 동적 Workspace Context로 전환합니다.\n\n### 핵심 수용 기준\n1. \`/app\`, \`/app/sohee\`, \`/app/work\`, \`/app/customers\`, \`/app/content\`, \`/app/results\` 전 라우트의 workspaceId 동적 해석.\n2. 사용자 소속 Workspace가 없는 경우 온보딩으로 정상 리다이렉트.\n3. 테넌트 간 데이터 누출(Tenant isolation leakage) 원천 차단.`,
      priority: 1
    },
    {
      title: "[P0] [Credit Ledger] localStorage 기반 use-credit-balance 제거 및 서버 Ledger / Reserve-Settle 연동",
      description: `### 목표\n감사 보고서 2절에 따라 브라우저 localStorage 기반 크레딧(15000/11580 등) 코드를 완전 삭제하고, 서버 기반 Credit Repository / Ledger 및 Estimate-Reserve-Execute-Settle 정본과 연동합니다.\n\n### 핵심 수용 기준\n1. \`use-credit-balance.ts\`에서 localStorage, setBalance, recharge 등 브라우저 상태 조작 로직 완전 제거.\n2. 서버 Workspace Credit Account(\`available\`, \`reserved\`, \`spent\`, \`refillAt\`, \`verification reserve\`)를 조회하는 서버 연동 훅 구현.\n3. 미션 실행 시 사전 Reserve 및 사후 Settle 트랜잭션 정상 연결.`,
      priority: 1
    },
    {
      title: "[P0] [Work & Mission] Work / Mission / ActionRun 서버 상태머신 구축 및 False-Success 제거",
      description: `### 목표\n감사 보고서 3절에 따라 Work 화면의 고정 객체와 가짜 네이버 블로그 URL fallback을 제거하고, 서버 상태 머신(\`QUEUED -> RUNNING -> PROVIDER_ACCEPTED -> VERIFICATION_PENDING -> VERIFIED\`) 및 read-after-write 검증을 구축합니다.\n\n### 핵심 수용 기준\n1. 외부 발행 시 임의 URL fallback 제거, 실제 Provider 응답(Post ID, Permalink) 수신 전까지 VERIFIED 전환 금지.\n2. \`UNKNOWN_AFTER_SUBMIT\` 상태 및 재시도 전 확인(query-first) 프로토콜 적용.\n3. MissionConsole 및 Work 라우트가 서버 ActionRun 정본 데이터를 실시간 반영.`,
      priority: 1
    },
    {
      title: "[P0] [Harness User Feature] 사용자 하네스 Real Pipeline (수집 -> Evidence -> Pattern -> Adapted Rule -> Version)",
      description: `### 목표\n감사 보고서 4절에 따라 Canned sample(눈썹 캡션 3개/댓글 2개 하드코딩) 및 In-Memory store를 제거하고, 실제 URL 분석 -> Evidence Snapshot -> Pattern Extraction -> Anti-Copy -> Brand Adaptation 파이프라인과 영구 저장소를 구축합니다.\n\n### 핵심 수용 기준\n1. In-Memory Local Harness Store 제거 및 영구 저장소/서버 모델 바인딩.\n2. 하드코딩된 canned sample 제거 및 실제 수집/스냅샷 기반 패턴 추출 엔진 가동.\n3. 벤치마크 원문 상호/가격/전화번호 누출 방지(Anti-copy gate) 및 Brand Adaptation 룰 컴파일.`,
      priority: 1
    },
    {
      title: "[P0] [Core IA & Shell] V0.8.8 6대 Desktop Core IA (Command, Work, Customers, Content, Results, Sohee) 정비",
      description: `### 목표\n감사 보고서 10절에 따라 V0.8.8 Shell 네비게이션을 6대 핵심 축(Command, Work, Customers, Content, Results, My Sohee)으로 정렬하고 미구현 catch-all 라우트를 정리합니다.\n\n### 핵심 수용 기준\n1. V088AppShell 네비게이션에 6대 메뉴 명확히 노출 및 활성 탭 라우팅.\n2. \`/app/work\`, \`/app/customers\`, \`/app/content\`, \`/app/results\`, \`/app/sohee\` 라우트 정합성 100% 확보.\n3. 모바일/데스크톱 네비게이션 동기화 및 0.8.8 버전 배지 유지.`,
      priority: 1
    },
    {
      title: "[P0] [Command Center] 사장님 아침 업무 브리핑 흐름 (목표 -> 상황 -> 판단 -> 결정필요 -> 결과 -> 이상징후) 재편",
      description: `### 목표\n감사 보고서 5절 및 13절에 따라 Command Center를 단순 대시보드가 아닌 '소희의 아침 업무 브리핑' 경험으로 재설계합니다.\n\n### 핵심 수용 기준\n1. 정적 2건 승인 카드/하드코딩 KPI 제거.\n2. 오늘 목표 -> 현재 상황 -> 소희 판단 -> 진행 중 업무 -> 사장님 결정 필요(승인/거절 시 실제 ActionRun 전이) -> 이상징후 흐름 반영.\n3. 사장님이 5~10초 내에 오늘 소희의 행동과 필요한 결정을 즉시 파악 가능.`,
      priority: 1
    },
    {
      title: "[P0] [Customers Engine] 통합 고객 인텐트 그래프 (Channel Inbox -> Customer Thread / Intent / Slot Verification)",
      description: `### 목표\n감사 보고서 6절에 따라 Customers 화면을 채널별 단순 목록이 아닌 '통합 고객 인텐트 그래프 및 소희 응대/예약 판단' 엔진으로 개편합니다.\n\n### 핵심 수용 기준\n1. 정적 mock 고객/예약 데이터 제거.\n2. 고객별 인텐트(예약 확률, 가격/일정 문의), 소희 판단 근거, 다음 제안 행동, 슬롯 검증 상태 표시.\n3. Instagram DM, 네이버 문의, 당근 등 다채널 고객 상호작용의 단일 타임라인 결합.`,
      priority: 1
    },
    {
      title: "[P0] [Content Engine] Opportunity / Goal 기반 Mission 실행기로 개편",
      description: `### 목표\n감사 보고서 7절에 따라 단순 AI 글쓰기 툴에서 벗어나 '영업 기회(예약 공백 등) -> Mission -> 다채널 변형 -> Gate -> 검증 게시 -> 성과' 파이프라인으로 개편합니다.\n\n### 핵심 수용 기준\n1. 정적 샘플 포스트/Unsplash 고정 데이터 제거.\n2. 공백 슬롯/프로모션 목표 기반 콘텐츠 생성 및 인스타그램/스레드/블로그 변형 생성.\n3. Brand Safety / Fact Freshness 게이트 통과 후 실제 발행 큐 연결.`,
      priority: 1
    },
    {
      title: "[P0] [Results & Attribution] 가짜 KPI 제거 및 실제 Attribution Truth / Credit ROI 시각화",
      description: `### 목표\n감사 보고서 8절에 따라 하드코딩된 성장률/가짜 KPI를 제거하고, Direct / Assisted / Unclear 귀속 모델 및 Credit ROI를 표시합니다.\n\n### 핵심 수용 기준\n1. 실데이터 없는 하드코딩 지표(+18.4% 등) 전면 제거.\n2. 소희의 기여도(직접 기여, 보조 기여, 불명확) 분리 표시.\n3. 투입된 소희 크레딧(SC) 대비 창출된 예약 문의/매출 ROI 정합성 연결.`,
      priority: 1
    },
    {
      title: "[P0] [My Sohee] 인사기록 / 업무규정 / 교육 / 권한 / 평가표 중심 직원 관리 UX 개편",
      description: `### 목표\n감사 보고서 9절에 따라 \`/app/sohee\`를 단순 설정 화면이 아닌 '소희의 사원 인사기록, 업무규정, 권한, 교육 및 평가표'로 전면 재설계합니다.\n\n### 핵심 수용 기준\n1. 소희 역량(할 수 있는 일), 자율성 한도, 사규/가이드라인, 학습 기록, 예산 한도 시각화.\n2. 실제 런타임 Connector Capability 및 Autonomy 권한 정책과 바인딩.\n3. 테넌트별 독립 설정 및 격리 보장.`,
      priority: 1
    },
    {
      title: "[P0] [Universal Web Runtime] 4단계 Fallback 및 런타임 Capability / Session 검증",
      description: `### 목표\n감사 보고서 14절 및 P0-11에 따라 Native API -> Cloud Browser -> Home Mac -> Manual의 4단계 실행 런타임 및 세션/권한 검증을 구축합니다.\n\n### 핵심 수용 기준\n1. 네이버 블로그 등 브라우저 기반 채널의 세션 만료 및 UI 변경 감지.\n2. 권한/세션 미충족 시 UNKNOWN_AFTER_SUBMIT 또는 BLOCKED 전환 및 사장님 알림.\n3. 중복 게시 방지 및 멱등성 키 검증.`,
      priority: 1
    }
  ]

  console.log(`Creating ${issues.length} Linear issues for V0.8.8 Runtime Truth Overhaul...`)
  const created = []
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
      created.push(issue)
    } else {
      console.error("Failed to create issue:", data?.errors || data)
    }
  }

  fs.writeFileSync('scripts/v088-created-issues.json', JSON.stringify(created, null, 2))
  console.log(`\nSuccessfully created ${created.length} Linear issues and saved to scripts/v088-created-issues.json`)
}

createV088RuntimeTruthIssues().catch(console.error)
