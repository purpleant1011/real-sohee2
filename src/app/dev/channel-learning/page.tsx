import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { isLearningPreviewAllowed } from '@/features/channel-learning/preview-gate'
import LearningPreviewClient from './preview-client'

export const dynamic = 'force-dynamic'

export default async function LearningPreviewPage() {
  const requestHeaders = await headers()
  if (!isLearningPreviewAllowed({ nodeEnv: process.env.NODE_ENV,
    enabled: process.env.SOHEE_LOCAL_E2E, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    host: requestHeaders.get('host') }) || process.env.CF_PAGES || process.env.WORKERS_CI) notFound()
  return <LearningPreviewClient />
}
