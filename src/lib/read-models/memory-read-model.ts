export type MemoryCategory = 
  | 'persona_tone' 
  | 'pricing_treatment' 
  | 'prohibited_claims' 
  | 'faq' 
  | 'proven_hooks' 
  | 'learned_pattern';

export interface MemoryItem {
  id: string;
  category: MemoryCategory;
  type: 'fact' | 'inference';
  title: string;
  content: string;
  source: string;
  confidence: number;
  lastVerifiedAt: string;
  decayDays?: number;
  usageCount: number;
  isEditable: boolean;
}

export interface MarketingMemoryReadModel {
  workspaceId: string;
  totalCount: number;
  items: MemoryItem[];
}

export interface GetMemoryParams {
  workspaceId: string;
}

export function getMarketingMemoryReadModel(params: GetMemoryParams): MarketingMemoryReadModel {
  const items: MemoryItem[] = [
    {
      id: 'mem-001',
      category: 'pricing_treatment',
      type: 'fact',
      title: '정식 시술 가격표 및 소요시간',
      content: '블랙틴팅 속눈썹펌: 60,000원 (50분) / 노글루 수분펌: 70,000원 (60분) / 스킨플래닝: 100,000원 (60분) / 스킨플래닝+수분진정 패키지: 120,000원 (70분, 첫방문 20% 할인 96,000원)',
      source: '바이름 원장님 공식 등록 가격표',
      confidence: 1.0,
      lastVerifiedAt: '2026-08-20',
      usageCount: 42,
      isEditable: true,
    },
    {
      id: 'mem-002',
      category: 'persona_tone',
      type: 'fact',
      title: '브랜드 보이스 & 응대 페르소나',
      content: '전문적이면서도 다정하고 정중한 말투. 과도한 이모지 남발 지양 (문단당 1~2개). 시술 후 주의사항과 유지 팁을 먼저 챙겨주는 든든한 뷰티 파트너 톤앤매너.',
      source: '바이름 브랜드 가이드북 V0.2',
      confidence: 1.0,
      lastVerifiedAt: '2026-08-25',
      usageCount: 88,
      isEditable: true,
    },
    {
      id: 'mem-003',
      category: 'prohibited_claims',
      type: 'fact',
      title: '의료법/표시광고법 금지 표현',
      content: '“완벽한 치료”, “100% 부작용 없음”, “모든 트러블 박멸”, “의학적 시술 대체” 등 단정적/과장/의료 오인 표현 절대 사용 금지.',
      source: '의료/뷰티 광고 자율준수 가이드라인',
      confidence: 1.0,
      lastVerifiedAt: '2026-08-15',
      usageCount: 120,
      isEditable: false,
    },
    {
      id: 'mem-004',
      category: 'faq',
      type: 'fact',
      title: '임산부 및 민감성 피부 시술 안내 가이드',
      content: '임산부 고객은 안정기(16주 이후)에 한하여 노글루/저자극 펌제로 시술 진행 권장. 피부 트러블성 고객은 스킨플래닝 전 염증 여부 원장님 사전 진단 필수.',
      source: '시술 안전 프로토콜',
      confidence: 1.0,
      lastVerifiedAt: '2026-08-22',
      usageCount: 15,
      isEditable: true,
    },
    {
      id: 'mem-005',
      category: 'proven_hooks',
      type: 'inference',
      title: '목요일 오후 슬롯 리커버리 전환 훅',
      content: '“목요일 오후 2시/4시 30분 한정 잔여 슬롯” 형태로 특정 시간을 명시하고, 이전 문의 이력을 언급할 때 전환율 35% 이상으로 가장 높음.',
      source: '과거 4주간 카카오톡 상담 전환 분석 결과',
      confidence: 0.88,
      lastVerifiedAt: '2026-08-29',
      decayDays: 30,
      usageCount: 6,
      isEditable: true,
    },
    {
      id: 'mem-006',
      category: 'learned_pattern',
      type: 'inference',
      title: '환절기 스킨플래닝 문의 집중 요일/시간대',
      content: '일요일 저녁 20시~23시 사이에 인스타그램 DM으로 다음 주 스킨플래닝 문의가 집중되는 경향 발견.',
      source: '인스타그램 인박스 타임스탬프 클러스터링',
      confidence: 0.82,
      lastVerifiedAt: '2026-08-28',
      decayDays: 45,
      usageCount: 3,
      isEditable: true,
    },
  ];

  return {
    workspaceId: params.workspaceId,
    totalCount: items.length,
    items,
  };
}
