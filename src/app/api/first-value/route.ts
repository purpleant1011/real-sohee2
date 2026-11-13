export const dynamic = 'force-dynamic'
export const maxDuration = 120

import { handleFirstValue } from '@/features/first-value/first-value-route'

export async function GET(request: Request) {
  return handleFirstValue(request)
}
