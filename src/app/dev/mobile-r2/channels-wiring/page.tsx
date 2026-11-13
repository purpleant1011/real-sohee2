import { notFound } from 'next/navigation'
import { ChannelsEntry } from '@/app/app/channels/channels-entry'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'

export const dynamic = 'force-dynamic'

/** 채널 R2 배선 ON/OFF 비교 하네스(ANI-1707). 개발 전용(운영 404). /dev/mobile-r2/channels-wiring?r2=1 */
export default async function ChannelsWiringPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  if (process.env.NODE_ENV === 'production') notFound()
  const params = await searchParams
  return <MobileR2Provider enabled={params.r2 === '1'}><ChannelsEntry /></MobileR2Provider>
}
