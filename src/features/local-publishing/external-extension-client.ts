import { z } from 'zod'

import { SOHEE_EXTENSION_ID } from './extension-id'

export { SOHEE_EXTENSION_ID }

const inputSchema = z.object({
  pairingCode: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
  displayName: z.string().trim().min(1).max(120),
  requestId: z.string().uuid(),
  targetExternalId: z.string().regex(/^[A-Za-z0-9_.-]{2,80}$/),
  environment: z.enum(['test', 'production']),
}).strict()

const prepareInputSchema = inputSchema.pick({ targetExternalId: true, requestId: true, environment: true })

const responseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    state: z.enum([
      'ready',
      'approved_job_started',
      'native_connector_required',
      'channel_confirmation_required',
      'cdp_unreachable',
    ]),
  }).strict(),
  z.object({
    ok: z.literal(false),
    state: z.enum(['forbidden', 'invalid_request', 'pairing_failed']),
  }).strict(),
])

export type OneClickSetupState = 'extension_missing' | 'ready' | 'approved_job_started'
  | 'native_connector_required' | 'channel_confirmation_required' | 'cdp_unreachable'
  | 'forbidden' | 'invalid_request' | 'pairing_failed' | 'failed'

type RuntimeBoundary = Readonly<{
  sendMessage(extensionId: string, message: unknown): Promise<unknown>
}>

type BrowserBoundary = Readonly<{ runtime?: RuntimeBoundary }>

function browserBoundary(): BrowserBoundary {
  const value = globalThis as typeof globalThis & { chrome?: { runtime?: RuntimeBoundary } }
  return { runtime: value.chrome?.runtime }
}

export async function sendPairCurrentBrowser(
  input: unknown,
  boundary: BrowserBoundary = browserBoundary(),
): Promise<Readonly<{ state: OneClickSetupState }>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return { state: 'failed' }
  if (!boundary.runtime?.sendMessage) return { state: 'extension_missing' }
  try {
    const response = await boundary.runtime.sendMessage(SOHEE_EXTENSION_ID, {
      type: 'PAIR_CURRENT_BROWSER',
      pairingCode: parsed.data.pairingCode,
      displayName: parsed.data.displayName,
      requestedChannel: 'naver_blog',
      requestId: parsed.data.requestId,
      targetExternalId: parsed.data.targetExternalId,
      environment: parsed.data.environment,
    })
    const safeResponse = responseSchema.safeParse(response)
    return safeResponse.success ? { state: safeResponse.data.state } : { state: 'failed' }
  } catch {
    return { state: 'extension_missing' }
  }
}

export async function sendPrepareCurrentBrowser(
  input: unknown,
  boundary: BrowserBoundary = browserBoundary(),
): Promise<Readonly<{ state: OneClickSetupState }>> {
  const parsed = prepareInputSchema.safeParse(input)
  if (!parsed.success) return { state: 'failed' }
  if (!boundary.runtime?.sendMessage) return { state: 'extension_missing' }
  try {
    const response = await boundary.runtime.sendMessage(SOHEE_EXTENSION_ID, {
      type: 'PREPARE_NAVER_CONNECTION',
      targetExternalId: parsed.data.targetExternalId,
      environment: parsed.data.environment,
      requestId: parsed.data.requestId,
    })
    const safeResponse = responseSchema.safeParse(response)
    return safeResponse.success ? { state: safeResponse.data.state } : { state: 'failed' }
  } catch {
    return { state: 'extension_missing' }
  }
}
