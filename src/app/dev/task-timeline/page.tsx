import { notFound } from 'next/navigation'
import { TaskTimelinePreview } from './preview'

export default function TaskTimelinePage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <TaskTimelinePreview />
}
