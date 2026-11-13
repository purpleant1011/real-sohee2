import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { ContentHubFixture } from './fixture'

export const dynamic = 'force-dynamic'

export default function ContentHubStabilityPreview() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <Suspense fallback={null}><NuqsAdapter><ContentHubFixture /></NuqsAdapter></Suspense>
}
