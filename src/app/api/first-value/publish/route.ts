export const dynamic = 'force-dynamic'
export const maxDuration = 120

import { handleFirstValuePublish } from '@/features/first-value/publish-route'

export async function POST(request: Request) {
  return handleFirstValuePublish(request)
}
