import { notFound } from 'next/navigation'
import { NaverHandoffPreview } from './preview'

export const dynamic = 'force-dynamic'

/** 네이버 수동 포스팅 화면군(글 만들기 폼·생성 중·원샷 카드·단계 목록) 시각 점검용. 운영에서는 404. */
export default function NaverHandoffDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <NaverHandoffPreview />
}
