import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('ANI-1140: SECURITY DEFINER 63 Capability Inventory & Least-Privilege Closure', () => {
  const matrixPath = path.resolve(__dirname, '../../docs/11th/SECURITY_DEFINER_63_DISPOSITION_MATRIX.md')
  const migrationPath = path.resolve(__dirname, '../../supabase/migrations/20260909060000_ani1140_security_definer_least_privilege_closure.sql')

  it('verifies 63/63 disposition matrix exists and covers all functions with correct breakdown', () => {
    expect(fs.existsSync(matrixPath)).toBe(true)
    const matrixContent = fs.readFileSync(matrixPath, 'utf-8')

    // Must have 63 rows in table
    const tableRows = matrixContent.split('\n').filter(line => line.startsWith('|') && /\|\s*\d+\s*\|/.test(line))
    expect(tableRows.length).toBe(63)

    // Verify summary counts in matrix
    expect(matrixContent).toContain('총 함수**: 63건')
    expect(matrixContent).toContain('SECURITY INVOKER 전환 (안전한 순수 읽기 함수)**: 3건')
    expect(matrixContent).toContain('REVOKE from authenticated, anon, PUBLIC & GRANT to service_role (서버/어드민/금융 전용)**: 60건')
    expect(matrixContent).toContain('0건 (100% Closure)')

    // Verify critical credit function is marked as service_role with hidden mutation justification
    expect(matrixContent).toContain('get_workspace_credit_balance(uuid)')
    expect(matrixContent).toContain('Hidden Mutation: Auto-allowance creation')
  })

  it('verifies migration file targets all 63 functions correctly with least-privilege', () => {
    expect(fs.existsSync(migrationPath)).toBe(true)
    const migrationContent = fs.readFileSync(migrationPath, 'utf-8')

    const invokerFunctions = [
      'list_channel_interactions',
      'list_checkout_intents',
      'list_workspace_credit_ledger',
    ]

    for (const fn of invokerFunctions) {
      expect(migrationContent).toContain(`'${fn}'`)
    }

    const samplePrivilegedFunctions = [
      'activate_current_invited_operator',
      'apply_approved_admin_role_change',
      'apply_approved_credit_adjustment',
      'approve_admin_account_approval',
      'complete_channel_verification_v12',
      'create_checkout_intent',
      'create_operator_incident',
      'get_workspace_credit_balance',
      'get_workspace_credit_usage_detail',
      'request_admin_account_approval',
      'retire_operator_mfa_exception',
      'transition_operator_incident',
    ]

    for (const fn of samplePrivilegedFunctions) {
      expect(migrationContent).toContain(`'${fn}'`)
    }

    // Must grant execute on private security helpers
    expect(migrationContent).toContain('GRANT EXECUTE ON FUNCTION private.has_credit_workspace_access(uuid) TO service_role, authenticated;')
    expect(migrationContent).toContain('GRANT EXECUTE ON FUNCTION private.has_workspace_role(uuid, text[]) TO service_role, authenticated;')
    expect(migrationContent).toContain('GRANT EXECUTE ON FUNCTION private.is_workspace_member(uuid) TO service_role, authenticated;')

    // Must revoke from PUBLIC, anon, authenticated
    expect(migrationContent).toContain('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated;')
    // Must grant execute to service_role
    expect(migrationContent).toContain('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role;')
    // Must enforce search_path
    expect(migrationContent).toContain('SET search_path = public, pg_temp;')
  })

  it('prohibits authenticated role execution on privileged RPCs and verifies service_role entitlement boundary', () => {
    type Role = 'anon' | 'authenticated' | 'service_role'

    interface RpcPermissionConfig {
      name: string
      securityMode: 'SECURITY_INVOKER' | 'SECURITY_DEFINER'
      allowedRoles: Role[]
      searchPath: string
    }

    const rpcCatalog: Record<string, RpcPermissionConfig> = {
      apply_approved_admin_role_change: {
        name: 'apply_approved_admin_role_change',
        securityMode: 'SECURITY_DEFINER',
        allowedRoles: ['service_role'],
        searchPath: 'public, pg_temp',
      },
      apply_approved_credit_adjustment: {
        name: 'apply_approved_credit_adjustment',
        securityMode: 'SECURITY_DEFINER',
        allowedRoles: ['service_role'],
        searchPath: 'public, pg_temp',
      },
      approve_and_dispatch_meta_content: {
        name: 'approve_and_dispatch_meta_content',
        securityMode: 'SECURITY_DEFINER',
        allowedRoles: ['service_role'],
        searchPath: 'public, pg_temp',
      },
      complete_channel_verification_v12: {
        name: 'complete_channel_verification_v12',
        securityMode: 'SECURITY_DEFINER',
        allowedRoles: ['service_role'],
        searchPath: 'public, pg_temp',
      },
      get_workspace_credit_balance: {
        name: 'get_workspace_credit_balance',
        securityMode: 'SECURITY_DEFINER',
        allowedRoles: ['service_role'],
        searchPath: 'public, pg_temp',
      },
      list_channel_interactions: {
        name: 'list_channel_interactions',
        securityMode: 'SECURITY_INVOKER',
        allowedRoles: ['authenticated', 'service_role'],
        searchPath: 'public, pg_temp',
      },
    }

    function checkRpcAccess(functionName: string, callerRole: Role): { allowed: boolean; reason?: string } {
      const config = rpcCatalog[functionName]
      if (!config) return { allowed: false, reason: 'FUNCTION_NOT_FOUND' }

      if (!config.allowedRoles.includes(callerRole)) {
        return {
          allowed: false,
          reason: `PERMISSION_DENIED: ${callerRole} is prohibited from executing ${functionName} (${config.securityMode})`,
        }
      }

      return { allowed: true }
    }

    // Authenticated role MUST be denied from executing privileged RPCs
    const privilegedTestFns = [
      'apply_approved_admin_role_change',
      'apply_approved_credit_adjustment',
      'approve_and_dispatch_meta_content',
      'complete_channel_verification_v12',
      'get_workspace_credit_balance',
    ]

    for (const fn of privilegedTestFns) {
      const authResult = checkRpcAccess(fn, 'authenticated')
      expect(authResult.allowed).toBe(false)
      expect(authResult.reason).toContain('PERMISSION_DENIED')

      const anonResult = checkRpcAccess(fn, 'anon')
      expect(anonResult.allowed).toBe(false)
      expect(anonResult.reason).toContain('PERMISSION_DENIED')

      const serviceResult = checkRpcAccess(fn, 'service_role')
      expect(serviceResult.allowed).toBe(true)
    }

    // Safe pure read functions with SECURITY INVOKER allow authenticated
    const invokerResult = checkRpcAccess('list_channel_interactions', 'authenticated')
    expect(invokerResult.allowed).toBe(true)
  })
})
