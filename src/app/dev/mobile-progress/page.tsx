import { notFound } from 'next/navigation'
import { MobileProgressPreview } from './preview'

export default async function MobileProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { state } = await searchParams
  return <MobileProgressPreview initialState={state} />
}
