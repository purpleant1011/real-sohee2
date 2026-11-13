import { NextResponse } from 'next/server'

import { authenticateConnectorRequest } from '@/features/local-publishing/device-auth'
import { registerBrowserChannelConnection } from '@/features/local-publishing/repository'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const device = await authenticateConnectorRequest(request)
  if (!device) return NextResponse.json({ code: 'DEVICE_AUTH_REQUIRED' }, { status: 401 })
  const body: unknown = await request.json().catch(() => null)
  const result = await registerBrowserChannelConnection(device, body)
  return 'error' in result
    ? NextResponse.json(result.error, { status: 400 })
    : NextResponse.json(result.data, { headers: { 'cache-control': 'no-store' } })
}
