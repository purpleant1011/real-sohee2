export interface McpToolResult {
  success: boolean
  toolName: string
  statusMessage: string
  actionData?: Record<string, unknown>
  feedPreview?: {
    channel: 'INSTAGRAM' | 'THREADS' | 'NAVER_BLOG' | 'DAANGN'
    profileName: string
    accountHandle: string
    images: string[]
    caption: string
    hashtags: string[]
  }
  navigationMenu?: string
  autonomyState?: boolean
  killswitchState?: boolean
}

// 6대 비법 하네스 시드 데이터
export const HARNESS_CATALOG: Record<string, { name: string; handle: string; dna: string[]; tone: string; sampleImages: string[] }> = {
  harness_byreum_001: {
    name: '소희 퍼스널 뷰티 진단 하네스',
    handle: '@sohee_beauty',
    dna: ['1:1 골격&모류 맞춤 진단', '당일 일상복귀 자연결 기법', '화/수 유휴시간 15% 한정 오퍼'],
    tone: '신뢰감 있는 진단형, 1:1 맞춤 제안 어조 (정중하고 전문적)',
    sampleImages: []
  },
  harness_noorbrow_002: {
    name: '누르브로우(noor.brow) 메이크업 전공 1:1 디자인 하네스',
    handle: '@noor.brow',
    dna: ['11년 MAC 아티스트 권위', '비대칭/골격 교정 메이크업', '모던 입체 아치 디자인'],
    tone: '메이크업 아티스트의 전문성과 뷰티 철학 중심 어조',
    sampleImages: []
  },
  harness_modeun_003: {
    name: '모든결브로우(modeun.brow) 맨즈 전문 굵은 결 브로우 하네스',
    handle: '@modeun.brow',
    dna: ['남성 전용 옴므 결', '티 나지 않고 또렷한 인상', '19시 직장인 야간 슬롯'],
    tone: '단정하고 직관적인 남성 맞춤형 어조',
    sampleImages: []
  },
  harness_salonde_004: {
    name: '살롱드브로우(salonde_brow) 콤보 & 섀도우 무통 그라데이션 하네스',
    handle: '@salonde_brow',
    dna: ['화장한 듯 부드러운 섀도우 그라데이션', '지성피부 롱래스팅', '무통 듀얼 케어'],
    tone: '우아하고 포근한 벨벳 감성 어조',
    sampleImages: []
  },
  harness_cheongna_005: {
    name: '청라아인브로우(cheongna_ein) 속눈썹 펌 & 결 브로우 토탈 케어 하네스',
    handle: '@cheongna_ein',
    dna: ['블랙 틴팅 펌 콤보', '쌩얼 메이크업 세트', '맘카페 추천 오퍼'],
    tone: '친근한 동네 언니 감성, 쌩얼 꿀팁 어조',
    sampleImages: []
  },
  harness_laura_006: {
    name: '로라브로우(laura_brow) 붉은 잔흔 커버 & 흉터 복원 하네스',
    handle: '@laura_brow',
    dna: ['옛날 붉은/푸른 잔흔 중화 커버', '흉터 부위 모류 재현', '레이저 없는 안심 솔루션'],
    tone: '전문적이고 안정감 있는 문제 해결형 솔루션 어조',
    sampleImages: []
  }
};

// 18대 Master MCP Tool Specifications for OpenAI Function Calling
export const SOHEE_MASTER_MCP_TOOLS = [
  // 1. 홈 / 사령부 자율 제어 & 킬스위치
  {
    type: 'function' as const,
    function: {
      name: 'mcp_control_autonomy',
      description: '소희의 풀에이전트 24시간 자동화 근무 상태를 가동(start)하거나 일시 정지(pause)합니다.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['start', 'pause'],
            description: '가동 시작은 start, 일시 정지는 pause'
          }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'mcp_emergency_killswitch',
      description: '모든 자율 마케팅 루틴, 외부 채널 자동 발행, 예약 슬롯 발행을 즉시 강제 중단(kill)하거나 해제(resume)하는 긴급 킬스위치를 작동합니다.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['kill', 'resume'],
            description: '즉시 정지는 kill, 정상 복구는 resume'
          },
          reason: {
            type: 'string',
            description: '킬스위치 작동 사유'
          }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'mcp_approve_promotion',
      description: '소희가 제안한 주간 프로모션(예: 봄맞이 1:1 결 브로우 15% 한정 오퍼)을 사장님 명의로 승인(approve)하고 6단계 파이프라인을 자동 실행합니다.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['approve', 'reject', 'hold'],
            description: '승인은 approve, 반려 reject, 보류 hold'
          }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'mcp_get_command_status',
      description: 'AI 사령부의 실시간 자율 가동률(100%), 주간 목표 달성도(6/8건), 4채널 상권 감시 상태, 오늘 실행할 데일리 루틴 목록을 종합 브리핑합니다.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },

  // 2. 비주얼 이미지 생성 & 멀티채널 콘텐츠 스튜디오
  {
    type: 'function' as const,
    function: {
      name: 'mcp_generate_visual_image',
      description: 'GPT-Image-2 최신 이미지 엔진을 사용하여 사용자가 요구한 모든 비주얼 이미지(토끼, 고양이, 뷰티 시술 룩북, 비포애프터, 매장 전경, 일러스트 등)를 1024x1024 초고화질로 즉시 생성하여 채팅창에 보여줍니다.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '생성할 이미지의 구체적인 내용 및 피사체 묘사 (예: "귀여운 하얀 토끼가 풀밭에서 풀을 뜯는 모습", "매장 대표 시술 및 상품의 자연광 클로즈업 샷")'
          },
          style: {
            type: 'string',
            description: '이미지 스타일 (예: 실사 사진, 자연광 감성, 초근접 결, 일러스트, 3D 렌더 등)'
          }
        },
        required: ['prompt']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'mcp_generate_content',
      description: '지정된 채널(인스타그램, 스레드, 네이버 블로그, 당근 비즈프로필)에 최적화된 마케팅 원고와 고화질 이미지를 6대 하네스 DNA에 맞추어 전문 제작합니다.',
      parameters: {
        type: 'object',
        properties: {
          channel: {
            type: 'string',
            enum: ['INSTAGRAM', 'THREADS', 'NAVER_BLOG', 'DAANGN'],
            description: '발행할 소셜 미디어 채널'
          },
          topic: {
            type: 'string',
            description: '포스팅할 주제 또는 키워드'
          },
          harness_id: {
            type: 'string',
            description: '적용할 비법 하네스 ID (기본: harness_byreum_001)'
          },
          image_style: {
            type: 'string',
            description: '함께 생성할 이미지 스타일'
          }
        },
        required: ['channel', 'topic']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'mcp_publish_live',
      description: '사장님이 승인한 마케팅 원고와 이미지를 실제 공식 SNS(인스타그램, 스레드, 네이버블로그, 당근)에 실시간으로 즉시 발행하고 외부 라이브 URL을 검증합니다.',
      parameters: {
        type: 'object',
        properties: {
          channel: {
            type: 'string',
            enum: ['INSTAGRAM', 'THREADS', 'NAVER_BLOG', 'DAANGN'],
            description: '발행할 채널'
          },
          caption: {
            type: 'string',
            description: '발행할 원고 본문'
          },
          hashtags: {
            type: 'array',
            items: { type: 'string' },
            description: '해시태그 목록'
          },
          image_url: {
            type: 'string',
            description: '함께 첨부할 이미지 URL'
          }
        },
        required: ['channel', 'caption']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'mcp_create_ab_test',
      description: '동일한 시술 오퍼에 대해 2가지 상이한 톤앤매너(A안: 전문의학적 진단형 vs B안: 친근한 동네언니 감성)의 카피와 이미지를 동시 생성하여 전환율 실험을 세팅합니다.',
      parameters: {
        type: 'object',
        properties: {
          offer_topic: {
            type: 'string',
            description: '실험 대상 프로모션 또는 시술 주제'
          }
        },
        required: ['offer_topic']
      }
    }
  },

  // 3. 고객 소통 & 5대 채널 실시간 예약 장부
  {
    type: 'function' as const,
    function: {
      name: 'mcp_query_customers',
      description: '인스타 DM, 네이버 톡톡, 당근채팅, 스레드, 카톡 5대 채널의 고객 상담 대화 내역 및 확정 예약 장부를 브리핑합니다.',
      parameters: {
        type: 'object',
        properties: {
          channel: {
            type: 'string',
            description: '특정 채널 필터 (전체는 all)'
          }
        }
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'mcp_manage_reservation',
      description: '특정 고객의 방문 예약 일정 및 예약금(₩20,000) 완납 상태를 기록/조회합니다.',
      parameters: {
        type: 'object',
        properties: {
          customer_name: { type: 'string', description: '고객명' },
          date_slot: { type: 'string', description: '예약 일시' },
          deposit_status: { type: 'string', enum: ['paid', 'pending'], description: '예약금 수납 여부' },
          treatment: { type: 'string', description: '시술 항목' }
        },
        required: ['customer_name']
      }
    }
  },

  // 4. 성과 & ROI 비즈니스 분석 (ANI-306 Runtime Truth 준수)
  {
    type: 'function' as const,
    function: {
      name: 'mcp_get_roi_analytics',
      description: '연결된 채널과 예약 원장 데이터를 기반으로 실측 확정 예약 매출, 마케팅 기여도, 퍼널별 전환 성과를 조회합니다.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'mcp_get_slot_occupancy',
      description: '주중 매장 슬롯 가동률, 요일/시간대 공실 현황, 예약 방어 지표를 조회합니다.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'mcp_get_labor_savings',
      description: '소희가 이번 주 자동 수행한 마케팅 업무(원고 제작, 발행, 실시간 고객 응대) 횟수 및 작업 절감 통계를 브리핑합니다.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },

  // 5. 나의 소희 (하네스 비법 & 주간 평가표)
  {
    type: 'function' as const,
    function: {
      name: 'mcp_inspect_harness',
      description: '등록된 6대 하네스의 3대 핵심 DNA, 4차원 톤 벡터, 실행 규칙, 룩북 사진을 심층 열람합니다.',
      parameters: {
        type: 'object',
        properties: {
          harness_id: {
            type: 'string',
            description: '조회할 하네스 ID 또는 이름 키워드'
          }
        },
        required: ['harness_id']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'mcp_update_harness',
      description: '매장의 새로운 시술 노하우, 브랜드 DNA, 금지어, 선호 톤앤매너를 하네스 지식 베이스에 추가/수정합니다.',
      parameters: {
        type: 'object',
        properties: {
          harness_id: { type: 'string', description: '수정할 하네스 ID' },
          new_dna: { type: 'string', description: '추가할 시술 비법 또는 핵심 원칙' },
          tone: { type: 'string', description: '조정할 톤앤매너' }
        },
        required: ['harness_id']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'mcp_export_marketing_report',
      description: '주간/월간 마케팅 활동 및 예약 전환 성과 보고서를 생성 및 요약합니다.',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['weekly', 'monthly'],
            description: '보고서 기간'
          }
        },
        required: ['period']
      }
    }
  },

  // 6. 시스템 (크레딧 & 채널 연동 & 화면 네비게이션)
  {
    type: 'function' as const,
    function: {
      name: 'mcp_check_system',
      description: '소희 크레딧 잔여량, 충전 상태, 5대 마케팅 채널 연동 정상 여부를 점검합니다.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'mcp_navigate_console',
      description: '사장님이 원하는 특정 대시보드 화면(홈, 콘텐츠, 고객, 성과, 나의 소희, 시스템 등)으로 실시간 화면을 전환/이동합니다.',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            enum: ['home', 'content', 'customers', 'results', 'sohee', 'system', 'channels'],
            description: '이동할 대상 화면'
          }
        },
        required: ['target']
      }
    }
  }
];
