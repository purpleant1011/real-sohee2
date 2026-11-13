/**
 * Supabase Fail-Closed Mutation Helper (ANI-990)
 *
 * Prevents false-success when Supabase JS resolves with `{ error }`.
 * Any persistence error immediately throws SupabasePersistenceError,
 * preventing downstream external tool or provider execution.
 */

export interface SupabaseErrorShape {
  message: string
  code?: string
  details?: string | null
  hint?: string | null
}

export class SupabasePersistenceError extends Error {
  public readonly code: string
  public readonly details: string | null
  public readonly hint: string | null
  public readonly context?: string

  constructor(error: SupabaseErrorShape, context?: string) {
    const prefix = context ? `[${context}] ` : ''
    const msg = `${prefix}${error.message || 'Database mutation failed'}${
      error.code ? ` (code: ${error.code})` : ''
    }`
    super(msg)
    this.name = 'SupabasePersistenceError'
    this.code = error.code || 'PERSISTENCE_FAILED'
    this.details = error.details ?? null
    this.hint = error.hint ?? null
    this.context = context
  }
}

/**
 * Validates a Supabase response object and throws if an error exists.
 * Returns non-null data.
 */
export function assertSupabaseSuccess<T>(
  response: { data: T | null; error: any | null } | null | undefined,
  context?: string
): T {
  if (!response) {
    throw new SupabasePersistenceError(
      { message: 'Empty or null response from Supabase operation', code: 'EMPTY_RESPONSE' },
      context
    )
  }

  if (response.error) {
    throw new SupabasePersistenceError(
      {
        message: response.error.message || String(response.error),
        code: response.error.code,
        details: response.error.details,
        hint: response.error.hint,
      },
      context
    )
  }

  return response.data as T
}

/**
 * Awaits a Supabase thenable/promise and asserts success.
 */
export async function requireSuccess<T>(
  promise: PromiseLike<{ data: T | null; error: any | null }>,
  context?: string
): Promise<T> {
  const response = await promise
  return assertSupabaseSuccess(response, context)
}

/**
 * Enforces fail-closed mutation order:
 * 1. Executes DB mutation
 * 2. Asserts DB mutation success (throws on failure)
 * 3. Only if DB mutation succeeded, executes downstream side-effect (API call, external publish, credit burn)
 */
export async function failClosedMutationGuard<T, R>(
  mutationFn: () => PromiseLike<{ data: T | null; error: any | null }>,
  downstreamAction: (persistedData: T) => PromiseLike<R>,
  context?: string
): Promise<{ data: T; result: R }> {
  const mutationResponse = await mutationFn()
  const persistedData = assertSupabaseSuccess(mutationResponse, context)

  const result = await downstreamAction(persistedData)
  return { data: persistedData, result }
}
