import 'server-only'

import { createHash } from 'node:crypto'
import { z } from 'zod'

const bearerPattern = /^[A-Za-z0-9_-]{43,128}$/

const deviceSchema = z.object({
  deviceId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  platform: z.enum(['windows', 'macos']),
  clientVersion: z.string().min(1).max(40),
  status: z.literal('active'),
}).strict()

export type ConnectorDevice = Readonly<z.infer<typeof deviceSchema> & { tokenDigest: string }>

export type DeviceAuthGateway = Readonly<{
  authenticate(tokenDigest: string): Promise<{ data: unknown; error: unknown }>
}>

async function productionGateway(): Promise<DeviceAuthGateway> {
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  const admin = createAdminSupabaseClient() as unknown as {
    rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
  }
  return {
    authenticate: (tokenDigest) => admin.rpc('authenticate_connector_device', {
      p_token_digest: tokenDigest,
    }),
  }
}

export async function digestDeviceToken(token: string): Promise<string> {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export async function authenticateConnectorRequest(
  request: Request,
  providedGateway?: DeviceAuthGateway,
): Promise<ConnectorDevice | null> {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return null
  const token = authorization.slice(7)
  if (!bearerPattern.test(token)) return null
  const gateway = providedGateway ?? await productionGateway()
  const result = await gateway.authenticate(await digestDeviceToken(token))
  if (result.error) return null
  const parsed = deviceSchema.safeParse(result.data)
  return parsed.success ? Object.freeze({ ...parsed.data, tokenDigest: await digestDeviceToken(token) }) : null
}
