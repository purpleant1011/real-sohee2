import { notFound } from 'next/navigation'
import { BlogArtifactRailPreview } from './preview'

export default function BlogArtifactRailPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <BlogArtifactRailPreview />
}
