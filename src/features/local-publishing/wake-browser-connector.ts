import { z } from 'zod'

import { SOHEE_EXTENSION_ID } from './extension-id'
import { executionScopeAuthorizationSchema, executionScopeSelectionSchema } from './execution-scope'

export { SOHEE_EXTENSION_ID }

const requestSchema = executionScopeSelectionSchema.extend({ workspaceId: z.string().uuid() }).strict()
export type ExactNaverWakeInput = Readonly<z.infer<typeof requestSchema>>
const responseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    state: z.enum(['ready', 'approved_job_started', 'native_connector_required', 'cdp_unreachable']),
  }).strict(),
  z.object({
    ok: z.literal(false),
    state: z.enum(['forbidden', 'invalid_request', 'wake_failed']),
  }).strict(),
])

export type ConnectorWakeState = 'extension_missing' | 'ready' | 'approved_job_started'
  | 'native_connector_required' | 'cdp_unreachable' | 'forbidden' | 'invalid_request' | 'wake_failed' | 'failed'

type RuntimeBoundary = Readonly<{
  sendMessage(extensionId: string, message: unknown): Promise<unknown>
}>

type BrowserBoundary = Readonly<{ runtime?: RuntimeBoundary; fetch?: typeof globalThis.fetch }>

function browserBoundary(): BrowserBoundary {
  const value = globalThis as typeof globalThis & { chrome?: { runtime?: RuntimeBoundary } }
  return { runtime: value.chrome?.runtime }
}

export async function wakeBrowserConnector(
  input: ExactNaverWakeInput,
  boundary: BrowserBoundary = browserBoundary(),
): Promise<Readonly<{ state: ConnectorWakeState }>> {
  const parsed = requestSchema.safeParse(input)
  if (!parsed.success) return { state: 'failed' }
  const value = parsed.data
  let authorization: z.infer<typeof executionScopeAuthorizationSchema>
  try {
    const fetchScope = boundary.fetch ?? globalThis.fetch.bind(globalThis)
    const response = await fetchScope(`/api/workspaces/${encodeURIComponent(value.workspaceId)}/naver-connector/execution-scope`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actionId: value.actionId, connectionId: value.connectionId, requestId: value.requestId, fingerprint: value.fingerprint }),
    })
    if (!response.ok) return { state: 'failed' }
    const json = await response.json()
    const scope = executionScopeAuthorizationSchema.safeParse(json?.data)
    if (!scope.success || scope.data.actionId !== value.actionId) return { state: 'failed' }
    authorization = scope.data
  } catch {
    return { state: 'failed' }
  }

  if (!boundary.runtime?.sendMessage) return { state: 'extension_missing' }
  try {
    const response = await boundary.runtime.sendMessage(SOHEE_EXTENSION_ID, {
      type: 'WAKE_APPROVED_NAVER_JOB', requestId: value.requestId,
      executionScope: { scopeId: authorization.scopeId, actionId: authorization.actionId },
    })
    const safeResponse = responseSchema.safeParse(response)
    return safeResponse.success ? { state: safeResponse.data.state } : { state: 'failed' }
  } catch {
    return { state: 'extension_missing' }
  }
}
