import { notFound } from 'next/navigation'
import { BlogStrategyReviewPreview } from './preview'

export const dynamic = 'force-dynamic'

export default function BlogStrategyReviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <BlogStrategyReviewPreview />
}
