import { notFound } from 'next/navigation'
import { PostApprovalHarness } from './harness'

export const dynamic = 'force-dynamic'

export default function PostApprovalDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <PostApprovalHarness />
}
