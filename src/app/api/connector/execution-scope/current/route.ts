import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateConnectorRequest } from '@/features/local-publishing/device-auth'
import { readDeviceExecutionScope } from '@/features/local-publishing/execution-scope.server'

export const dynamic = 'force-dynamic'
const headers = { 'cache-control': 'no-store' }
export async function POST(request: Request) {
  const device = await authenticateConnectorRequest(request)
  if (!device) return NextResponse.json({ code: 'DEVICE_AUTH_REQUIRED' }, { status: 401, headers })
  const input = request.body === null ? {} : await request.json().catch(() => null)
  if (!z.object({}).strict().safeParse(input).success) return NextResponse.json({ code: 'SCOPE_REQUEST_INVALID' }, { status: 400, headers })
  const result = await readDeviceExecutionScope(device)
  return 'data' in result
    ? NextResponse.json(result.data, { headers })
    : NextResponse.json(result.error, { status: 503, headers })
}
