export const placeProfileFields = [
  'name', 'category', 'phone', 'address', 'introduction', 'keywords', 'hours', 'holidays',
  'breakTime', 'facilities', 'parking', 'paymentMethods', 'services', 'menus', 'prices',
  'photos', 'website', 'socialLinks', 'news',
] as const

export type PlaceProfileField = typeof placeProfileFields[number]
export type PlaceProfileValue = string | readonly string[] | null

export type PlaceProfileSnapshot = Readonly<{
  targetExternalId: string
  targetLabel: string
  lastVerifiedAt: string | null
} & Readonly<Record<PlaceProfileField, PlaceProfileValue>>>

export type PlaceHealthState = 'good' | 'recommended' | 'missing' | 'needs_verification' | 'restricted'

export type PlaceHealthItem = Readonly<{
  field: PlaceProfileField
  label: string
  state: PlaceHealthState
  value: PlaceProfileValue
  nextAction: string
}>

export type PlaceHealth = Readonly<{
  items: readonly PlaceHealthItem[]
  proposedValues: readonly never[]
}>

export type ApprovedPlaceFact = Readonly<{
  field: PlaceProfileField
  before: string
  after: string
  reason: string
}>

export type PlaceChangeProposal = Readonly<ApprovedPlaceFact & {
  targetExternalId: string
  targetLabel: string
  capability: 'manual_assist_only'
}>

const labels: Readonly<Record<PlaceProfileField, string>> = {
  name: '업체명', category: '업종', phone: '전화번호', address: '주소', introduction: '소개',
  keywords: '핵심어', hours: '영업시간', holidays: '휴무일', breakTime: '휴게시간',
  facilities: '시설', parking: '주차', paymentMethods: '결제 수단', services: '서비스',
  menus: '메뉴', prices: '가격', photos: '사진', website: '웹사이트', socialLinks: '소셜 링크', news: '새소식',
}

function isMissing(value: PlaceProfileValue): boolean {
  return value === null || (Array.isArray(value) && value.length === 0)
}

function nextAction(field: PlaceProfileField, missing: boolean): string {
  if (!missing) return '마지막 확인 시각과 공식 화면을 다시 확인해 주세요.'
  if (field === 'hours' || field === 'services' || field === 'prices') return '확인된 업체 정보가 있으면 변경안으로 추가해 주세요.'
  return '공식 화면 또는 승인된 자료에서 값을 확인해 주세요.'
}

export function calculatePlaceHealth(snapshot: PlaceProfileSnapshot): PlaceHealth {
  const items = placeProfileFields.map((field): PlaceHealthItem => {
    const missing = isMissing(snapshot[field])
    return Object.freeze({
      field,
      label: labels[field],
      state: missing ? 'missing' : 'good',
      value: snapshot[field],
      nextAction: nextAction(field, missing),
    })
  })
  return Object.freeze({ items: Object.freeze(items), proposedValues: Object.freeze([]) })
}

export function proposePlaceChanges(
  snapshot: PlaceProfileSnapshot,
  approvedFacts: readonly ApprovedPlaceFact[],
): readonly PlaceChangeProposal[] {
  return Object.freeze(approvedFacts.flatMap((fact) => {
    const current = snapshot[fact.field]
    if (typeof current !== 'string' || current !== fact.before || fact.after.trim() === '' || fact.after === current) {
      return []
    }
    return [Object.freeze({
      ...fact,
      targetExternalId: snapshot.targetExternalId,
      targetLabel: snapshot.targetLabel,
      capability: 'manual_assist_only' as const,
    })]
  }))
}
