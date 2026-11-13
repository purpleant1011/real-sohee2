import { NextResponse } from 'next/server'
import { z } from 'zod'

import { authenticateConnectorRequest } from '@/features/local-publishing/device-auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const heartbeatSchema = z.object({
  clientVersion: z.string().trim().min(1).max(40).regex(/^[0-9A-Za-z._-]+$/).optional(),
}).strict()

export async function POST(request: Request) {
  const device = await authenticateConnectorRequest(request)
  if (!device) return NextResponse.json({ code: 'DEVICE_AUTH_REQUIRED' }, { status: 401 })
  const body = heartbeatSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ code: 'HEARTBEAT_INVALID' }, { status: 400 })
  const admin = createAdminSupabaseClient() as unknown as {
    rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
    from(name: string): {
      update(value: Record<string, unknown>): {
        eq(column: string, value: string): Promise<{ error: unknown }>
      }
    }
  }
  const result = await admin.rpc('heartbeat_connector_device', {
    p_device_id: device.deviceId,
    p_token_digest: device.tokenDigest,
  })
  if (result.error || result.data !== true) return NextResponse.json({ code: 'HEARTBEAT_REJECTED' }, { status: 409 })
  if (body.data.clientVersion) {
    const version = await admin.from('connector_devices')
      .update({ client_version: body.data.clientVersion })
      .eq('id', device.deviceId)
    if (version.error) return NextResponse.json({ code: 'HEARTBEAT_VERSION_REJECTED' }, { status: 409 })
  }
  return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } })
}
