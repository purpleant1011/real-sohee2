import { PublicHomeEntry } from './home-entry'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** M01 소개(`/`). R2 랜딩 플래그는 공개 레이아웃이 계산해 내려준다(기본 OFF → 기존 V0.85 랜딩). */
export default function PublicHomePage() {
  return <PublicHomeEntry />
}
