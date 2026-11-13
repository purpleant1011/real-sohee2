/** Reads shared by the board, the preview sheet and the copy dialog. `fetchFn` is injectable so a static page can serve fixtures. */
export type VaultFetch = typeof fetch

/** Resolved at call time so a test (or the browser) swapping the global fetch is respected. */
export const defaultVaultFetch: VaultFetch = (input, init) => globalThis.fetch(input, init)

export class VaultReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VaultReadError'
  }
}

async function readBody(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await response.json()
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** The API's own Korean message when it sent one; never a status code or raw payload. */
function messageFrom(body: Record<string, unknown> | null, fallback: string): string {
  return typeof body?.error === 'string' && body.error.trim() ? body.error : fallback
}

/** `{ success: true, data }` envelope used by the vault list, summary and detail routes. */
export async function getEnveloped<T>(fetchFn: VaultFetch, url: string, signal: AbortSignal, fallbackMessage = '조회 실패'): Promise<T> {
  const response = await fetchFn(url, { signal, cache: 'no-store' })
  const body = await readBody(response)
  if (!response.ok) throw new VaultReadError(messageFrom(body, fallbackMessage))
  if (body?.success !== true || !body.data) throw new VaultReadError(fallbackMessage)
  return body.data as T
}

/** Routes that answer with the bare object (the copy bundle). */
export async function getBare<T>(fetchFn: VaultFetch, url: string, signal: AbortSignal, fallbackMessage: string): Promise<T> {
  const response = await fetchFn(url, { signal, cache: 'no-store' })
  const body = await readBody(response)
  if (!response.ok) throw new VaultReadError(messageFrom(body, fallbackMessage))
  if (!body) throw new VaultReadError(fallbackMessage)
  return body as T
}

export function vaultBase(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/vault`
}
