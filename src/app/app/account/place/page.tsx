import { redirect } from 'next/navigation'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { ProfileHealthCard } from '@/features/profile-management/profile-health-card'
import type { PlaceProfileSnapshot } from '@/features/profile-management/profile-health'

const unverifiedPlaceSnapshot: PlaceProfileSnapshot = {
  targetExternalId: 'unverified', targetLabel: '네이버 플레이스 연결 필요', lastVerifiedAt: null,
  name: null, category: null, phone: null, address: null, introduction: null, keywords: [], hours: null,
  holidays: null, breakTime: null, facilities: [], parking: null, paymentMethods: [], services: [], menus: [],
  prices: [], photos: [], website: null, socialLinks: [], news: [],
}

export default async function PlaceAccountPage() {
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace) redirect('/app/onboarding')
  return <ProfileHealthCard snapshot={unverifiedPlaceSnapshot} />
}
