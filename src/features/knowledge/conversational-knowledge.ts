export interface ConversationalBusinessKnowledgeDraft {
  workspaceId?: string
  businessType?: string
  location?: string
  operatingHours?: string
  reservationPolicy?: string
  primaryServices?: string
  pricing?: string
  targetAudience?: string
  faq?: string
  cautions?: string
}

export interface ConfirmedFactEntry {
  field: string
  label: string
  value: string
}

export interface ImmutableBusinessKnowledgeSnapshot {
  id: string
  workspaceId: string
  versionNumber: number
  isImmutable: true
  confirmedBy: string
  confirmedAt: string
  facts: ConfirmedFactEntry[]
}

const FIELD_LABELS: Record<keyof Omit<ConversationalBusinessKnowledgeDraft, 'workspaceId'>, string> = {
  businessType: '사업 유형',
  location: '매장 위치',
  reservationPolicy: '예약 방식',
  primaryServices: '대표 서비스/메뉴',
  pricing: '가격대',
  operatingHours: '영업시간/휴무',
  targetAudience: '주요 타깃',
  faq: '자주 묻는 질문',
  cautions: '이용 주의사항',
}

export function extractBusinessKnowledgeDraft(
  utterance: string,
  existingDraft: Partial<ConversationalBusinessKnowledgeDraft> = {}
): ConversationalBusinessKnowledgeDraft {
  const text = utterance.trim()
  const draft: ConversationalBusinessKnowledgeDraft = { ...existingDraft }

  // 1. Business Type
  const typeMatch = text.match(/(1인\s*미용실|헤어스튜디오|헤어샵|미용실|헤어살롱|네일샵|네일아트|피부과|에스테틱|카페|베이커리|디저트샵|필라테스|요가원|식당|공방)/)
  if (typeMatch) draft.businessType = typeMatch[1]

  // 2. Location
  const locMatch = text.match(/(청라|강남|서초|홍대|송도|분당|일산|마포|[가-힣]+구\s*[가-힣]+동|[가-힣]+역\s*[0-9]+번출구|[가-힣]+호수공원(?:\s*근처)?)/)
  if (locMatch) {
    draft.location = locMatch[1].trim()
  }

  // 3. Operating hours / closed days
  const hoursMatch = text.match(/(?:화-일|월-토|월-금|매일|화~일|월~토)?\s*(?:[0-9]{1,2}시.*?[0-9]{1,2}시|[0-9]{1,2}:[0-9]{2}\s*-\s*[0-9]{1,2}:[0-9]{2}|매주\s*[가-힣]+요일은?\s*쉬어|정기휴무[^\n,.]*)/)
  if (hoursMatch) draft.operatingHours = hoursMatch[0].trim()

  // 4. Reservation Policy
  if (text.includes('예약제') || text.includes('네이버 예약') || text.includes('100% 예약')) {
    const resMatch = text.match(/(100%\s*네이버\s*예약제|네이버\s*예약제|100%\s*예약제|당일\s*예약\s*가능|예약제)/)
    draft.reservationPolicy = resMatch ? resMatch[1] : '예약제'
  }

  // 5. Primary Services
  const serviceMatch = text.match(/(?:대표\s*서비스는?|시그니처|대표\s*메뉴는?)\s*([^\n,.]+)|(레이어드컷[^\n,.]*|퍼스널컬러[^\n,.]*|디자인펌[^\n,.]*|사워도우[^\n,.]*)/)
  if (serviceMatch) {
    draft.primaryServices = (serviceMatch[1] || serviceMatch[2] || serviceMatch[0]).trim()
  }

  // 6. Pricing
  const priceMatch = text.match(/(?:컷은?\s*[0-9,]+(?:만?원)?|염색은?\s*[0-9,]+(?:만?원)?|[0-9,]+원(?:부터|~)?)/)
  if (priceMatch) {
    const fullPriceSection = text.match(/([^\n.]*[0-9,]+(?:만?원)[^\n.]*)/)
    draft.pricing = fullPriceSection ? fullPriceSection[1].trim() : priceMatch[0].trim()
  }

  // 7. Target Audience
  const targetMatch = text.match(/(2030[^\n,.]*고객|직장인[^\n,.]*고객|인근\s*주민[^\n,.]*|여성\s*고객)/)
  if (targetMatch) draft.targetAudience = targetMatch[1].trim()

  // 8. FAQ / Parking
  const faqMatch = text.match(/(주차[^\n,.]*|와이파이[^\n,.]*|반려동물\s*동반[^\n,.]*)/)
  if (faqMatch) draft.faq = faqMatch[1].trim()

  // 9. Cautions
  const cautionMatch = text.match(/(전화[^\n,.]*받지\s*못하니[^\n,.]*|지각\s*시[^\n,.]*취소|노쇼[^\n,.]*)/)
  if (cautionMatch) draft.cautions = cautionMatch[1].trim()

  return draft
}

export function getNextMissingKnowledgeQuestion(
  draft: ConversationalBusinessKnowledgeDraft
): { field: keyof ConversationalBusinessKnowledgeDraft; question: string } | null {
  const priorityOrder: Array<{
    field: keyof Omit<ConversationalBusinessKnowledgeDraft, 'workspaceId'>
    question: string
  }> = [
    {
      field: 'businessType',
      question: '어떤 업종의 매장을 운영하고 계신가요? (예: 1인 헤어샵, 네일살롱, 카페 등)',
    },
    {
      field: 'location',
      question: '매장은 어느 지역에 위치해 있나요? (예: 청라 호수공원 인근, 강남역 3번 출구 등)',
    },
    {
      field: 'reservationPolicy',
      question: '고객 예약이나 방문은 어떻게 운영하시나요? (예: 100% 네이버 예약제, 당일 워크인 가능 등)',
    },
    {
      field: 'primaryServices',
      question: '가장 자신 있는 대표 메뉴나 시그니처 시술/서비스는 무엇인가요?',
    },
    {
      field: 'pricing',
      question: '대표 메뉴나 기본 시술의 대략적인 가격대를 알려주세요. (예: 컷 3만원부터, 사워도우 8천원 등)',
    },
    {
      field: 'operatingHours',
      question: '영업시간과 정기 휴무일은 언제인가요?',
    },
    {
      field: 'targetAudience',
      question: '주로 어떤 고객층이 많이 찾아오시나요? (예: 2030 직장인 여성, 동네 단골 가족 등)',
    },
    {
      field: 'faq',
      question: '주차 지원이나 편의시설 등 고객분들이 자주 묻는 안내 사항이 있나요?',
    },
    {
      field: 'cautions',
      question: '시술 중 통화 제한이나 예약 취소 규정 등 꼭 미리 안내해야 할 주의사항이 있을까요?',
    },
  ]

  for (const item of priorityOrder) {
    if (!draft[item.field] || draft[item.field]?.trim() === '') {
      return item
    }
  }

  return null
}

export function createImmutableKnowledgeSnapshot(
  draft: ConversationalBusinessKnowledgeDraft,
  userId: string,
  versionNumber: number = 1
): ImmutableBusinessKnowledgeSnapshot {
  const facts: ConfirmedFactEntry[] = []

  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    const val = draft[key as keyof Omit<ConversationalBusinessKnowledgeDraft, 'workspaceId'>]
    if (val && val.trim() !== '') {
      facts.push({
        field: key,
        label,
        value: val.trim(),
      })
    }
  }

  if (facts.length === 0) {
    throw new Error('최소 1개 이상의 지식 항목이 입력되어야 불변 버전을 생성할 수 있습니다.')
  }

  const frozenFacts = facts.map((f) => Object.freeze({ ...f }))
  Object.freeze(frozenFacts)

  const snapshot: ImmutableBusinessKnowledgeSnapshot = {
    id: `bkv_${Date.now()}`,
    workspaceId: draft.workspaceId || 'current-workspace',
    versionNumber,
    isImmutable: true,
    confirmedBy: userId,
    confirmedAt: new Date().toISOString(),
    facts: frozenFacts,
  }

  return Object.freeze(snapshot)
}
