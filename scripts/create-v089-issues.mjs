import { readFileSync } from 'node:fs';

async function createV089LinearIssues() {
  const apiKey = process.env.LINEAR_API_KEY;
  const teamId = "fe9ce92a-6944-441c-8c02-6791df6e8061";
  const projectId = "0a78fa08-d11a-4797-8817-b9e4e0f66868";

  const issues = [
    {
      title: "[P0] [Credit Economy] 주간 지속충전 Token Bucket 및 Provider 원가 연동 카탈로그 구현",
      description: "07_Credit Economy 명세에 따라 CreditAccount(주간 지속충전 bucket), ProviderPriceCatalog(OpenAI/Anthropic/Google 등 실제 API 단가 버전 관리), AIUsageEvent(토큰/이미지/도구 사용량 원천 수집) 백엔드 엔진을 구현.",
      priority: 1
    },
    {
      title: "[P0] [Credit Economy] 70% 목표 Gross Margin Guard & Estimate-Reserve-Settle 정산 엔진 구현",
      description: "FullyLoadedCOGS 계산기, 70% Target / 60% Hard Floor 마진 가드(60% 미만 시 자동 Reroute/Block), 사전 견적(Estimate) -> 예약(Reserve) -> 사후 정산(Settle) 및 Verification Reserve 안전 잠금 프로토콜 구현.",
      priority: 1
    },
    {
      title: "[P0] [Credit Economy] 4대 운전 모드(HEALTHY/CONSERVE/CRITICAL/DEPLETED) 및 Burn Governor 구현",
      description: "잔액 비율에 따른 4대 자율 운전 모드(HEALTHY >30%, CONSERVE 10~30%, CRITICAL 0~10%, DEPLETED 0% 신규유료작업 중단 및 WAITING_CREDIT 자동 재개) 및 시간당/미션당 과소비 방지 Burn Governor 구현.",
      priority: 1
    },
    {
      title: "[P0] [Credit Economy] Daily Operating Plan & 24시간 롤링 크레딧 예측 및 6대 마케팅 활동 포트폴리오 엔진 구현",
      description: "DailyOperatingPlan 서버 정본, 24시간 롤링 크레딧 예측(Low/Expected/High), 6대 마케팅 활동(STRATEGY, CONTENT, CRM, REPUTATION, EXPERIMENT, ANALYTICS) 포트폴리오 예산 배분 및 자동 재예측 트리거 엔진 구현.",
      priority: 1
    },
    {
      title: "[P0] [Automation] API 없는 사이트(네이버 블로그/당근마켓) Cloud Browser & Site Skill 자동화 엔진 구현",
      description: "API가 없는 네이버 블로그(스마트에디터 ONE/댓글/통계), 당근마켓(비즈프로필 소식/쿠폰/채팅)에 대한 Cloud Browser Runtime 및 Site Skill 레시피/UI drift recovery/원가 계량 연동 백엔드 구축.",
      priority: 1
    },
    {
      title: "[P0] [IA & UX] 지휘센터 Daily Routine 타임테이블, 24h 크레딧 예측 및 마케팅 활동 믹스 UI 구축",
      description: "01_IA Spec에 따라 지휘센터(Command Center) 메인 화면에 오늘 소희 루틴 타임테이블(Scheduled vs Event-Driven), 24시간 크레딧 예측 게이지, 6대 마케팅 활동 믹스 바 컴포넌트를 반응형으로 구축.",
      priority: 1
    },
    {
      title: "[P0] [IA & UX] Agent Studio '크레딧 & 지능(Credits & Intelligence)' 설정 및 Advanced Usage 드릴다운 뷰 구현",
      description: "Agent Studio 내 요금제별 주간 캐파시티(무료/15만/30만/50만원), Refill 속도, 절약 모드, 미션별/실험별 예산 한도 설정 및 모델별/작업별 실제 원가 투명 드릴다운 뷰 구현.",
      priority: 1
    },
    {
      title: "[P0] [IA & UX] 모바일 Owner Companion (24h 루틴 요약 및 원클릭 의사결정 패킷) 반응형 UX 완성",
      description: "모바일 Today 탭에서 24시간 루틴 요약 카드, 다음 루틴 블록 3개, 실시간 의사결정 패킷(Decision Packet) 20초 승인/반려/수정 바텀시트 UX 구축.",
      priority: 1
    },
    {
      title: "[P0] [E2E & Release Gate] 100% 크레딧 소비 마진 시뮬레이션 및 전수 자동화 E2E 테스트 검증",
      description: "유료 플랜 100% 크레딧 소비 시 70% Gross Margin 유지 검증, 마진 하한 60% 차단 테스트, Estimate-Reserve-Settle 트랜잭션 무결성, API 없는 네이버/당근 실발행 E2E 검증 통과.",
      priority: 1
    }
  ];

  console.log(`Creating ${issues.length} Linear issues...`);
  for (const item of issues) {
    const res = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": apiKey },
      body: JSON.stringify({
        query: `mutation CreateIssue($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue { id identifier title priority }
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
    });
    const data = await res.json();
    console.log("Created Linear Issue:", data?.data?.issueCreate?.issue);
  }
}

createV089LinearIssues();
