import { notFound } from 'next/navigation'
import { ChatStreamHarness } from './harness'

export const dynamic = 'force-dynamic'

export default function ChatStreamDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <ChatStreamHarness />
}
