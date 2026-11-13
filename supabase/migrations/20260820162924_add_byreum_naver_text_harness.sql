insert into public.harness_rules (
  workspace_id,
  rule_key,
  rule_type,
  title,
  description,
  structured_rule,
  applies_to_channels,
  status,
  version,
  approved_by_user_id,
  approved_at,
  review_reason,
  created_by_user_id
) select
  'fdd5ef41-ab5c-406c-8965-8a2e473d8a2e',
  'byreum-naver-blog-text-v1',
  'text_generation',
  '바이름 네이버 블로그 텍스트 하네스 V1.0',
  '바이름 눈썹 문신과 눈썹 반영구 상담을 위한 네이버 블로그 글 생성 규칙. 바이름 소유 블로그의 반복적인 글 구조를 참고하되 원문을 복제하지 않고, 확인된 사실과 승인된 채널 정보만 사용합니다.',
  $json$
  {
    "harnessId": "BYREUM_NAVER_BLOG_TEXT_V1_0",
    "version": "1.0.0",
    "sourcePattern": {
      "ownedBlog": "https://blog.naver.com/larlds",
      "analysisMode": "STRUCTURE_AND_TONE_ONLY",
      "copyingForbidden": true
    },
    "brand": {
      "name": "바이름",
      "serviceCategory": "눈썹 문신 및 눈썹 반영구 상담과 맞춤 디자인",
      "primaryLocation": "인천 청라 및 인근 생활권",
      "primaryGoal": "부담 없는 상담 문의",
      "primaryAudience": [
        "매일 아침 눈썹 대칭과 빈 곳 때문에 불편한 성인",
        "과하게 진하거나 인위적인 결과를 걱정하는 성인",
        "자신의 얼굴형과 눈매에 맞는 자연스러운 디자인을 찾는 성인"
      ]
    },
    "voice": {
      "language": "ko-KR",
      "register": "따뜻하고 차분한 존댓말",
      "stance": "독자의 걱정을 먼저 이해하고 선택 기준을 설명한 뒤 상담을 권하는 전문가",
      "paragraphStyle": "모바일에서 읽기 쉬운 짧은 문단과 충분한 여백",
      "avoid": [
        "소희 소프트웨어 소개",
        "일반 마케팅 운영 설명",
        "과도한 감탄과 자극적인 공포",
        "근거 없는 최고, 완벽, 무통, 안전 보장, 효과 보장",
        "같은 검색어의 부자연스러운 반복"
      ]
    },
    "articleFlow": [
      {
        "step": 1,
        "purpose": "검색 의도와 일상 고민을 바로 연결",
        "content": "눈썹 대칭, 빈 곳, 아침 메이크업 시간, 인상이 흐릿해 보이는 고민 중 하나로 시작"
      },
      {
        "step": 2,
        "purpose": "방문 전 망설임을 구체화",
        "content": "너무 진해질까, 아플까, 티가 날까, 나에게 어울릴까 같은 질문을 독자 관점에서 제시"
      },
      {
        "step": 3,
        "purpose": "바이름의 상담과 디자인 기준 설명",
        "content": "얼굴형, 눈매, 골격, 표정, 기존 눈썹 결, 평소 메이크업을 함께 보는 맞춤 상담 흐름"
      },
      {
        "step": 4,
        "purpose": "정보 가치 제공",
        "content": "디자인 선택 기준, 방문 전 준비, 과정 중 확인, 사후 관리 질문을 주제에 맞게 설명"
      },
      {
        "step": 5,
        "purpose": "자주 묻는 질문 해소",
        "content": "통증, 자연스러움, 일상 복귀, 유지와 관리에 관한 질문을 개인차와 확인 필요성을 포함해 답변"
      },
      {
        "step": 6,
        "purpose": "확인된 차별점 제시",
        "content": "하네스 또는 지식 근거에 등록된 바이름의 경력, 위생, 재료, 1대1 운영 정보만 사용"
      },
      {
        "step": 7,
        "purpose": "부담 없는 상담 안내",
        "content": "결정을 재촉하지 않고 본인에게 맞는 방향을 상담에서 확인하도록 안내"
      },
      {
        "step": 8,
        "purpose": "지역 검색 맥락 정리",
        "content": "글 주제와 실제 서비스 지역에 맞는 네이버 검색 키워드만 자연스럽게 배치"
      }
    ],
    "seo": {
      "titlePattern": "지역 또는 독자 고민 + 눈썹 핵심 키워드 + 글에서 얻는 선택 기준",
      "primaryKeywords": [
        "인천눈썹문신",
        "청라눈썹문신",
        "인천눈썹반영구",
        "청라눈썹반영구",
        "가정동눈썹",
        "자연스러운눈썹",
        "눈썹상담"
      ],
      "keywordRule": "글의 실제 주제와 지역에 맞는 키워드만 제목, 도입, 본문, 태그에 분산하고 문장마다 반복하지 않음"
    },
    "claims": {
      "customerCaseRequiresEvidence": true,
      "reviewQuoteRequiresEvidence": true,
      "careerYearsRequiresEvidence": true,
      "materialSafetyRequiresEvidence": true,
      "painLevelRequiresEvidence": true,
      "retentionPeriodRequiresEvidence": true,
      "benefitOrDiscountRequiresEvidence": true,
      "fallback": "근거가 없으면 사실 단정 대신 상담에서 확인할 일반 기준과 개인차로 표현"
    },
    "textImageContract": {
      "required": true,
      "imageSlotsFollowArticleFlow": true,
      "eachSlotRequiresNearbySectionContext": true,
      "cover": "제목과 핵심 고민을 한눈에 연결하는 자연스러운 눈썹 인물 이미지",
      "detail": "해당 문단의 디자인 기준이나 자연스러운 결을 보여주는 장면",
      "action": "상담과 편안한 마무리를 연상시키는 장면",
      "visibleTextForbidden": true,
      "logoForbidden": true,
      "beforeAfterClaimForbiddenWithoutEvidence": true
    },
    "output": {
      "minimumReadableCharacters": 2800,
      "publicCandidate": true,
      "exactVersionApprovalRequired": true,
      "requiredSections": [
        "독자 고민",
        "맞춤 디자인 기준",
        "상담 또는 관리 정보",
        "자주 묻는 질문",
        "상담 안내"
      ]
    }
  }
  $json$::jsonb,
  array['naver_blog']::text[],
  'active',
  1,
  '9b60a784-e92d-48a4-b2a8-dec346bb4d39',
  now(),
  '바이름 소유 블로그의 글 구조와 사용자 승인에 따라 네이버 텍스트 생성 하네스로 활성화',
  '9b60a784-e92d-48a4-b2a8-dec346bb4d39'
where exists (
  select 1 from public.workspaces
  where id = 'fdd5ef41-ab5c-406c-8965-8a2e473d8a2e'
)
and exists (
  select 1 from auth.users
  where id = '9b60a784-e92d-48a4-b2a8-dec346bb4d39'
)
on conflict (workspace_id, rule_key, version) do update set
  title = excluded.title,
  description = excluded.description,
  structured_rule = excluded.structured_rule,
  applies_to_channels = excluded.applies_to_channels,
  status = excluded.status,
  approved_by_user_id = excluded.approved_by_user_id,
  approved_at = excluded.approved_at,
  review_reason = excluded.review_reason,
  updated_at = now();
