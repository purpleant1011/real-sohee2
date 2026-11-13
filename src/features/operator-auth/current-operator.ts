import 'server-only'

import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  currentOperatorContextSchema,
  normalizeOperatorContext,
  operatorContextWireSchema,
  type CurrentOperatorContext,
  workspaceIdSchema,
} from './schemas'

export type OperatorAuthGateway = Readonly<{
  getClaims(): Promise<{ data: { claims?: unknown } | null; error: unknown }>
  getAal(): Promise<{ data: { currentLevel?: unknown; nextLevel?: unknown } | null; error: unknown }>
  getOperatorContext(): Promise<{ data: unknown; error: unknown }>
}>

export type OperatorAccessErrorCode =
  | 'AUTH_REQUIRED'
  | 'PLATFORM_ADMIN_REQUIRED'
  | 'OPERATOR_DISABLED'
  | 'MFA_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'WORKSPACE_SCOPE_DENIED'

const errorMessages: Record<OperatorAccessErrorCode, string> = {
  AUTH_REQUIRED: '로그인 후 다시 시도해 주세요.',
  PLATFORM_ADMIN_REQUIRED: '운영사 관리자 계정으로 로그인해 주세요.',
  OPERATOR_DISABLED: '현재 운영사 관리자 계정은 사용할 수 없습니다.',
  MFA_REQUIRED: '운영사 관리자 접근에는 추가 인증이 필요합니다.',
  PERMISSION_DENIED: '이 운영사 기능에 접근할 권한이 없습니다.',
  WORKSPACE_SCOPE_DENIED: '이 작업공간에는 접근할 권한이 없습니다.',
}

export class OperatorAccessError extends Error {
  readonly code: OperatorAccessErrorCode

  constructor(code: OperatorAccessErrorCode) {
    super(errorMessages[code])
    this.name = 'OperatorAccessError'
    this.code = code
  }
}

function accessError(code: OperatorAccessErrorCode): OperatorAccessError {
  return new OperatorAccessError(code)
}

async function createProductionGateway(): Promise<OperatorAuthGateway> {
  const supabase = await createServerSupabaseClient()

  return {
    async getClaims() {
      const result = await supabase.auth.getClaims()
      return { data: result.data ? { claims: result.data.claims } : null, error: result.error }
    },
    async getAal() {
      const result = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      return { data: result.data, error: result.error }
    },
    async getOperatorContext() {
      const result = await supabase.rpc('get_current_operator_context')
      return { data: result.data, error: result.error }
    },
  }
}

export type LoadedOperator =
  | { context: CurrentOperatorContext; error: null }
  | { context: null; error: OperatorAccessErrorCode }

export async function loadCurrentOperator(gateway: OperatorAuthGateway): Promise<LoadedOperator> {
  let claimsResult: Awaited<ReturnType<OperatorAuthGateway['getClaims']>>
  try {
    claimsResult = await gateway.getClaims()
  } catch {
    return { context: null, error: 'AUTH_REQUIRED' }
  }

  const subject = claimsResult.data?.claims && typeof claimsResult.data.claims === 'object'
    && 'sub' in claimsResult.data.claims
    ? claimsResult.data.claims.sub
    : undefined
  if (claimsResult.error || typeof subject !== 'string' || subject.length === 0) {
    return { context: null, error: 'AUTH_REQUIRED' }
  }

  let contextResult: Awaited<ReturnType<OperatorAuthGateway['getOperatorContext']>>
  try {
    contextResult = await gateway.getOperatorContext()
  } catch {
    return { context: null, error: 'PLATFORM_ADMIN_REQUIRED' }
  }
  if (contextResult.error || contextResult.data === null || contextResult.data === undefined) {
    return { context: null, error: 'PLATFORM_ADMIN_REQUIRED' }
  }

  const wire = operatorContextWireSchema.safeParse(contextResult.data)
  if (!wire.success || wire.data.user_id !== subject) {
    return { context: null, error: 'PLATFORM_ADMIN_REQUIRED' }
  }

  let context: CurrentOperatorContext
  try {
    context = normalizeOperatorContext(wire.data)
  } catch {
    return { context: null, error: 'PLATFORM_ADMIN_REQUIRED' }
  }
  if (context.status !== 'active') {
    return { context: null, error: 'OPERATOR_DISABLED' }
  }

  // mfaRequired comes only from the database's effective MFA policy.
  if (!context.mfaRequired) {
    return { context, error: null }
  }

  let aalResult: Awaited<ReturnType<OperatorAuthGateway['getAal']>>
  try {
    aalResult = await gateway.getAal()
  } catch {
    return { context: null, error: 'MFA_REQUIRED' }
  }
  if (aalResult.error || aalResult.data?.currentLevel !== 'aal2') {
    return { context: null, error: 'MFA_REQUIRED' }
  }

  return { context, error: null }
}

export async function getCurrentOperator(
  injectedGateway?: OperatorAuthGateway,
): Promise<CurrentOperatorContext | null> {
  try {
    const gateway = injectedGateway ?? await createProductionGateway()
    const loaded = await loadCurrentOperator(gateway)
    return loaded.error === null ? loaded.context : null
  } catch {
    return null
  }
}

/** Identity and effective MFA only; permissions remain the dedicated guards' responsibility. */
export async function requireOperatorIdentity(
  injectedGateway?: OperatorAuthGateway,
): Promise<CurrentOperatorContext> {
  let gateway: OperatorAuthGateway
  try {
    gateway = injectedGateway ?? await createProductionGateway()
  } catch {
    throw accessError('AUTH_REQUIRED')
  }
  const loaded = await loadCurrentOperator(gateway)
  if (loaded.error !== null) {
    throw accessError(loaded.error)
  }
  return loaded.context
}

export { currentOperatorContextSchema, normalizeOperatorContext, workspaceIdSchema }
export type { CurrentOperatorContext }

// Keep the pre-handoff import path working while guards live in their own module.
export { requireOperator, requireOperatorAnyScope } from './require-operator'
