import { notFound } from 'next/navigation'
import { TabReadWiringHarness } from './harness'

export const dynamic = 'force-dynamic'

/** 실제 고객·성과·더보기 조회 배선 검증. 개발 전용이며 운영 인증 경계를 대신하지 않는다. */
export default async function TabReadWiringPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { tab } = await searchParams
  if (tab !== 'customers' && tab !== 'results' && tab !== 'more') notFound()
  return <TabReadWiringHarness tab={tab} />
}
