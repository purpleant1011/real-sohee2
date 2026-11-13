import dotenv from 'dotenv'
import fs from 'fs'

if (fs.existsSync('.env.local')) {
  const envConfig = dotenv.parse(fs.readFileSync('.env.local'))
  for (const k in envConfig) {
    process.env[k] = envConfig[k]
  }
}

async function createMissingLinearIssues() {
  const apiKey = process.env.LINEAR_API_KEY
  if (!apiKey) {
    console.error("LINEAR_API_KEY is not set.")
    process.exit(1)
  }

  const teamId = "fe9ce92a-6944-441c-8c02-6791df6e8061" // Team Ani
  const projectId = "0a78fa08-d11a-4797-8817-b9e4e0f66868" // 소희 V0.8.8

  const missingIssues = [
    {
      title: "[P0] [Cross-Channel Adapter] Instagram ➔ Threads / Naver Blog 플랫폼 문법 번역 어댑터 구현",
      description: `### 목표
PRD v1.1 12절 및 Gap Review F항목에 따라 하나의 Source Harness DNA(문체, 훅, 전개, 톤, CTA)를 대상 플랫폼(Threads, Naver Blog)의 형식과 검색 최적화 문법으로 번역하는 어댑터를 구현합니다.

### 핵심 요구사항
1. **Instagram ➔ Threads 변환**:
   - 이미지 의존도를 낮추고 대화형/토론형 훅과 짧은 문단, 스레드 꼬리 질문 구조로 변환.
2. **Instagram ➔ Naver Blog 변환**:
   - 동일한 콘텐츠 기둥과 전문성/진단 구조를 네이버 C-Rank에 맞춘 H2/H3 소제목, 지역 검색 키워드, 심층 칼럼 본문으로 확장.
3. **PlatformHarness 규칙 준수**:
   - 해시태그 배치, 링크 전략, 이미지 배치 리듬을 플랫폼별 가이드라인에 맞게 자동 조정.`,
      priority: 1
    },
    {
      title: "[P0] [Delta Refresh & Stale Engine] Source Hash 기반 증분(Delta) 분석 및 하네스 수명주기/STALE 감지 구현",
      description: `### 목표
PRD v1.1 13절, 23절 및 Gap Review IC-04에 따라 변경분만 저비용으로 분석하는 Delta Refresh 엔진과 Stale 하네스 수명주기 관리자를 구현합니다.

### 핵심 요구사항
1. **정규화 Source Hash 엔진**:
   - Signed URL이나 임시 파라미터 변화에 영향받지 않는 Normalized Hash (Platform Native IDs + Captions + Timestamps + Media Fingerprints).
2. **Delta Refresh 파이프라인**:
   - Full Rebuild 대비 70% 이상 저렴한 크레딧으로 신규/수정 포스트만 증분 파싱하여 새 Version 생성.
3. **STALE 감지 및 수명주기**:
   - 30일 이상 미갱신 시 \`STALE\` 상태 전환 및 자동화 게시 시 낮은 confidence로 자동 다운그레이드.`,
      priority: 1
    },
    {
      title: "[P0] [Security & Privacy] Third-Party Raw Media 단기 TTL Purge & 개인정보/얼굴 마스킹 파이프라인 구축",
      description: `### 목표
PRD v1.1 21.8절, 26절 및 Gap Review P0-05에 따라 제3자 소스 미디어의 저작권/개인정보 보호를 위한 단기 TTL 파기와 익명화 파이프라인을 구축합니다.

### 핵심 요구사항
1. **단기 TTL 및 자동 파기 (Purge)**:
   - 외부 벤치마크 분석용 원본 이미지/영상은 분석 완료 후 단기 TTL(24시간) 경과 시 원본 파일 자동 삭제.
   - 장기 저장은 구조화된 Feature, Hash, 색상 팔레트, 구도 메타데이터로만 보관.
2. **Privacy Masking**:
   - 고객 얼굴 이미지, Before/After 시술 사진, 댓글 작성자 닉네임/프로필에 대한 익명화 및 Privacy Class 부여.
3. **Export 번들 권리 보호**:
   - 하네스 내보내기(Export) 시 권리가 불명확한 제3자 원본 미디어는 번들에서 100% 제외.`,
      priority: 1
    },
    {
      title: "[P0] [Quality Gate & Fixtures] 7대 Quality Test Harness 픽스처 및 Golden Dataset 평가 체계 구축",
      description: `### 목표
PRD v1.1 25절 및 Gap Review P0-11에 따라 Evaluator의 객관적 캘리브레이션을 위한 Golden Dataset과 7대 픽스처 검증 스위트를 구축합니다.

### 핵심 요구사항
1. **7대 Fixture 데이터셋**:
   - \`known-good\`, \`known-bad\`, \`source-leakage\`(원문 유출), \`stale-fact\`(만료 사실), \`platform-invalid\`(플랫폼 제약 위반), \`over-promising\`(과장 광고), \`near-copy\`(유사 복제) 픽스처.
2. **Deterministic Blocker vs LLM Judge**:
   - 상호/가격 유출 및 금지 표현은 확정적(Deterministic) 정규식/룰로 0ms 즉시 차단.
   - 톤 적합도 및 자연스러움은 LLM Judge Score로 분리 평가.
3. **Threshold Calibration**:
   - Golden Dataset 테스트 통과율 100% 검증.`,
      priority: 1
    },
    {
      title: "[P0] [Mobile UX] Owner Companion 모바일 하네스 상태, 24h 예상 SC 위젯 및 원클릭 승인 바텀시트 구현",
      description: `### 목표
PRD v1.1 28절 및 모바일 Owner Companion 철학에 따라 대표님이 이동 중에도 20초 만에 하네스 상태와 소비 예산을 파악하고 의사결정할 수 있는 모바일 UX를 완성합니다.

### 핵심 요구사항
1. **Mobile Today 하네스 위젯**:
   - 현재 활성화된 채널별 Active Harness 카드, 상태(READY/PARTIAL), 다음 24시간 예상 소모 SC.
2. **20초 원클릭 승인 바텀시트**:
   - 하네스 자동 생성 제안, 위험 모듈 활성화 요청, 대규모 크레딧 갱신 시 모바일 바텀시트로 [승인 / 반려 / 수정] 지원.
3. **반응형 햅틱 및 Spring Physics**:
   - \`motion/react\` 기반 부드러운 인터랙션과 직관적인 한국어 UI.`,
      priority: 1
    },
    {
      title: "[P0] [Global Cache & Multi-Workspace] Global Acquisition Cache 및 워크스페이스 간 Seed Import/Copy 격리 엔진 구현",
      description: `### 목표
PRD v1.1 21.5절, 29절 및 Registry Admin View에 따라 비용 절감용 Global Acquisition Cache와 워크스페이스 간 Seed Import 격리 시스템을 구현합니다.

### 핵심 요구사항
1. **Global Acquisition Cache**:
   - 동일 공개 벤치마크 URL에 대한 외부 수집 결과(Normalized Feature)는 캐싱하여 불필요한 중복 크롤링 방지.
   - ⚠️ User Override, Brand Knowledge, Performance Policy는 절대 Global Cache에 공유되지 않도록 엄격 분리.
2. **Seed Reference Import / Copy**:
   - \`studio_by.reum\`, \`noor.brow\` 등 시스템 Seed를 회원이 [내 워크스페이스로 가져오기] 시 독립적인 Private HarnessAsset으로 복제 승격.
3. **Multi-Business 전환 지원**:
   - 한 사용자가 여러 매장/사업장 Workspace를 소유할 때 워크스페이스 스위처와 완벽한 자산 분리 보장.`,
      priority: 1
    }
  ]

  console.log(`Creating ${missingIssues.length} additional Linear issues...`)
  for (const item of missingIssues) {
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

createMissingLinearIssues().catch(console.error)
